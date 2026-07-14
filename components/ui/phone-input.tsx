"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

const CC_OPTIONS = [
  { code: "62",  label: "+62  Indonesia" },
  { code: "60",  label: "+60  Malaysia" },
  { code: "65",  label: "+65  Singapore" },
  { code: "66",  label: "+66  Thailand" },
  { code: "81",  label: "+81  Japan" },
  { code: "82",  label: "+82  South Korea" },
  { code: "84",  label: "+84  Vietnam" },
  { code: "86",  label: "+86  China" },
  { code: "91",  label: "+91  India" },
  { code: "92",  label: "+92  Pakistan" },
  { code: "880", label: "+880 Bangladesh" },
  { code: "61",  label: "+61  Australia" },
  { code: "64",  label: "+64  New Zealand" },
  { code: "44",  label: "+44  UK" },
  { code: "49",  label: "+49  Germany" },
  { code: "33",  label: "+33  France" },
  { code: "1",   label: "+1   US / Canada" },
];

// Same order as parseFonnteTarget in lib/fonnte.ts
const ORDERED_CCS = [
  "880","852","853","855","856","886","960","966","971","972",
  "62","60","61","63","64","65","66","81","82","84","86",
  "91","92","94","95","44","33","39","49","1",
];

function splitPhone(combined: string): { cc: string; national: string } {
  const digits = combined.replace(/\D/g, "");
  if (!digits) return { cc: "62", national: "" };
  if (digits.startsWith("0")) return { cc: "62", national: digits.slice(1) };
  for (const cc of ORDERED_CCS) {
    if (digits.startsWith(cc)) {
      return { cc, national: digits.slice(cc.length).replace(/^0/, "") };
    }
  }
  return { cc: "62", national: digits };
}

export function PhoneInput({
  value,
  onChange,
  placeholder = "812 3456 7890",
  id,
}: {
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  id?: string;
}) {
  // `value` is the single source of truth, so the field always reflects the
  // parent (including an external reset) without an effect syncing it back.
  // The one thing it can't carry is the dialling code chosen while the number
  // is still empty — there'd be nothing to parse it out of — so that alone is
  // remembered locally.
  const parsed = splitPhone(value);
  const hasNumber = parsed.national.length > 0;
  const [pendingCc, setPendingCc] = useState(parsed.cc);

  const cc = hasNumber ? parsed.cc : pendingCc;
  const national = parsed.national;

  function handleCc(newCc: string) {
    setPendingCc(newCc);
    onChange(national ? newCc + national : "");
  }

  function handleNational(raw: string) {
    const digits = raw.replace(/\D/g, "");
    onChange(digits ? cc + digits : "");
  }

  return (
    <div className="flex gap-2">
      <select
        value={cc}
        onChange={(e) => handleCc(e.target.value)}
        className="h-9 shrink-0 rounded-md border border-input bg-background px-2 py-1 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {CC_OPTIONS.map((o) => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
      <Input
        id={id}
        type="tel"
        value={national}
        onChange={(e) => handleNational(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1"
      />
    </div>
  );
}