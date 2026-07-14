"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { calculateDistribution } from "@/lib/distribution";
import { nightsBetween } from "@/lib/format";
import { MIN_RATING_TO_LIST } from "@/lib/sanitation";

export type BookingType = "stay" | "experience" | "bundle";

type HomestayWithVillage = {
  id: string;
  village_id: string;
  price_per_night: number;
  max_guests: number | null;
  villages: { sanitation_rating: number | null } | null;
};

type ExperienceWithVillage = {
  id: string;
  village_id: string;
  price_per_pax: number;
  villages: { sanitation_rating: number | null } | null;
};

export type CreateBookingInput = {
  bookingType: BookingType;
  homestayId: string | null;
  experienceIds: string[];
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  guestPhone: string;
};

export type CreateBookingResult =
  | { ok: true; bookingId: string }
  | { ok: false; error: string };

export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const guestName = input.guestName?.trim();
  if (!guestName) return { ok: false, error: "Please tell us who's travelling." };

  const guests = Math.max(1, Math.floor(input.guests || 1));
  const supabase = createAdminClient();
  const experienceIds = [...new Set(input.experienceIds ?? [])];

  let lodging = 0;
  let villageId: string | null = null;
  let homestayId: string | null = null;

  // ── Stays & bundles: validate the homestay ──────────────────────────────
  if (input.bookingType === "stay" || input.bookingType === "bundle") {
    if (!input.homestayId) {
      return { ok: false, error: "Choose a homestay for an overnight stay." };
    }
    const nights = nightsBetween(input.checkIn, input.checkOut);
    if (nights < 1) {
      return { ok: false, error: "Check-out must be after check-in." };
    }

    const { data: homestay, error: hErr } = await supabase
      .from("homestays")
      .select("id, village_id, price_per_night, max_guests, villages(sanitation_rating)")
      .eq("id", input.homestayId)
      .single<HomestayWithVillage>();

    if (hErr || !homestay) {
      return { ok: false, error: "That homestay is no longer available." };
    }
    if (homestay.max_guests && guests > homestay.max_guests) {
      return { ok: false, error: `This homestay sleeps up to ${homestay.max_guests} guests.` };
    }
    // The listing pages already filter on this, but a Server Action is reachable
    // by direct POST — so an uncertified village must be refused here too.
    if ((homestay.villages?.sanitation_rating ?? 0) < MIN_RATING_TO_LIST) {
      return { ok: false, error: "That village isn't certified for booking yet." };
    }

    // Availability. The bookings_no_overlap exclusion constraint is the real
    // authority (this read is racy); we check first only to return a friendly
    // error instead of a constraint violation in the common case.
    const { data: clashes, error: cErr } = await supabase
      .from("bookings")
      .select("id")
      .eq("homestay_id", input.homestayId)
      .neq("status", "cancelled")
      .lt("check_in", input.checkOut)
      .gt("check_out", input.checkIn)
      .limit(1);

    if (cErr) return { ok: false, error: "Could not check availability." };
    if (clashes && clashes.length > 0) {
      return { ok: false, error: "Those dates are already booked. Try different nights." };
    }

    lodging = Number(homestay.price_per_night) * nights;
    villageId = homestay.village_id;
    homestayId = homestay.id;
  }

  // ── Experiences: require at least one for experience/bundle types ────────
  if (input.bookingType === "experience" || input.bookingType === "bundle") {
    if (experienceIds.length === 0) {
      return { ok: false, error: "Choose at least one experience." };
    }
  }

  // ── Price experiences (re-read from DB, never trust client) ─────────────
  let experiencesTotal = 0;
  if (experienceIds.length > 0) {
    let expQuery = supabase
      .from("experiences")
      .select("id, price_per_pax, village_id, villages(sanitation_rating)")
      .in("id", experienceIds);

    // For stays/bundles, experiences must belong to the same village.
    if (villageId) expQuery = expQuery.eq("village_id", villageId);

    const { data, error: eErr } = await expQuery.returns<ExperienceWithVillage[]>();
    if (eErr) return { ok: false, error: "Could not price the experiences." };

    const experiences = data ?? [];
    if (experiences.length !== experienceIds.length) {
      return { ok: false, error: "One or more experiences are unavailable." };
    }
    if (
      experiences.some(
        (e) => (e.villages?.sanitation_rating ?? 0) < MIN_RATING_TO_LIST,
      )
    ) {
      return { ok: false, error: "That village isn't certified for booking yet." };
    }

    // For standalone experience bookings, lock in the village from the first exp.
    if (!villageId && experiences.length) {
      villageId = experiences[0].village_id;
    }

    experiencesTotal = experiences.reduce(
      (sum, e) => sum + Number(e.price_per_pax) * guests,
      0,
    );
  }

  const total = lodging + experiencesTotal;
  if (total <= 0) return { ok: false, error: "Total amount must be greater than zero." };

  const split = calculateDistribution(total);

  // For experience-only bookings check_in = check_out (same day).
  const checkIn = input.checkIn;
  const checkOut =
    input.bookingType === "experience" ? input.checkIn : input.checkOut;

  const { data: booking, error: bErr } = await supabase
    .from("bookings")
    .insert({
      tourist_id: null,
      guest_name: guestName,
      guest_phone: input.guestPhone?.trim() || null,
      homestay_id: homestayId,
      experience_ids: experienceIds,
      check_in: checkIn,
      check_out: checkOut,
      total_amount: total,
      booking_type: input.bookingType,
      status: "pending",
    })
    .select("id")
    .single();

  if (bErr || !booking) {
    // 23P01 = exclusion_violation: someone took these nights between our
    // availability check above and this insert.
    if (bErr?.code === "23P01") {
      return { ok: false, error: "Those dates were just booked. Try different nights." };
    }
    return { ok: false, error: bErr?.message ?? "Could not create the booking." };
  }

  const { error: dErr } = await supabase.from("distributions").insert({
    booking_id: booking.id,
    host_amount: split.host,
    guide_amount: split.guide,
    bumdes_amount: split.bumdes,
    status: "pending",
  });

  if (dErr) {
    return { ok: false, error: `Booking saved, but split failed: ${dErr.message}` };
  }

  return { ok: true, bookingId: booking.id };
}