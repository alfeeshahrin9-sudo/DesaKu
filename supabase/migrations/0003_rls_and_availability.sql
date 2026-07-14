-- Migration 0003 — lock down the database + prevent double-booking
-- Run in the Supabase SQL editor after 0002.
--
-- Until now RLS was disabled on every table. The anon key ships to the browser
-- by design, so with RLS off anyone holding it could read and write every row
-- via the REST API: guest names and phone numbers in `bookings`, host and guide
-- WhatsApp numbers, the whole `whatsapp_logs` audit trail. This migration
-- closes that.
--
-- The posture after this migration:
--   * anon / authenticated  → SELECT only, and only the public catalog
--                             (villages, homestays, experiences, reviews),
--                             with contact numbers withheld at column level.
--   * service_role          → full access; bypasses RLS by definition. All
--                             writes go through Server Actions using it.
--
-- Consequence for app code: anything reading `bookings`, `distributions` or
-- `whatsapp_logs` must use createAdminClient(), never the cookie/anon client.

-- =============================================================================
-- 1. Table privileges — start from zero, then hand back exactly what's public
-- =============================================================================
revoke all on villages      from anon, authenticated;
revoke all on homestays     from anon, authenticated;
revoke all on experiences   from anon, authenticated;
revoke all on reviews       from anon, authenticated;
revoke all on bookings      from anon, authenticated;
revoke all on distributions from anon, authenticated;
revoke all on whatsapp_logs from anon, authenticated;
revoke all on profiles      from anon, authenticated;

-- Reviews are public in full.
grant select on reviews to anon, authenticated;

-- Everything else carries a detail the public has no business reading:
-- villages.bumdes_bank_account, homestays.host_whatsapp_number and
-- experiences.guide_whatsapp_number. Postgres has no column-level RLS, so the
-- column list on GRANT is what withholds them — note their absence below.
grant select (id, name, region, sanitation_rating, description, hero_image_url, created_at)
  on villages to anon, authenticated;

grant select (id, village_id, price_per_night, max_guests, amenities, created_at)
  on homestays to anon, authenticated;

grant select (id, village_id, title, description, category, price_per_pax, created_at)
  on experiences to anon, authenticated;

-- bookings / distributions / whatsapp_logs / profiles: no grant at all.
-- They are reachable only via the service role.

-- =============================================================================
-- 2. Row Level Security
-- =============================================================================
alter table villages      enable row level security;
alter table homestays     enable row level security;
alter table experiences   enable row level security;
alter table reviews       enable row level security;
alter table bookings      enable row level security;
alter table distributions enable row level security;
alter table whatsapp_logs enable row level security;
alter table profiles      enable row level security;

-- Only certified villages (sanitation >= 4) are visible to the public — the
-- same threshold MIN_RATING_TO_LIST enforces in the UI, now enforced in the DB.
drop policy if exists villages_public_read on villages;
create policy villages_public_read on villages
  for select to anon, authenticated
  using (sanitation_rating >= 4);

drop policy if exists homestays_public_read on homestays;
create policy homestays_public_read on homestays
  for select to anon, authenticated
  using (
    exists (
      select 1 from villages v
      where v.id = homestays.village_id and v.sanitation_rating >= 4
    )
  );

drop policy if exists experiences_public_read on experiences;
create policy experiences_public_read on experiences
  for select to anon, authenticated
  using (
    exists (
      select 1 from villages v
      where v.id = experiences.village_id and v.sanitation_rating >= 4
    )
  );

drop policy if exists reviews_public_read on reviews;
create policy reviews_public_read on reviews
  for select to anon, authenticated
  using (true);

-- bookings, distributions, whatsapp_logs, profiles get NO policy. With RLS on
-- and no policy, every anon/authenticated row access is denied by default.

-- =============================================================================
-- 3. No double-booking
-- =============================================================================
-- The application also pre-checks availability so it can show a friendly error,
-- but that check is racy on its own. This constraint is the authority: two
-- live bookings can never hold overlapping nights in the same homestay.
create extension if not exists btree_gist;

alter table bookings drop constraint if exists bookings_no_overlap;

alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (
    homestay_id  with =,
    daterange(check_in, check_out, '[)') with &&
  )
  where (
    homestay_id is not null
    and status <> 'cancelled'
    and check_out > check_in   -- experience-only bookings are same-day: no nights to hold
  );

-- Grants changed, so tell PostgREST to rebuild its schema cache.
notify pgrst, 'reload schema';