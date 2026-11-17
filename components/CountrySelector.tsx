"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { COUNTRY_COOKIE, COUNTRY_OPTIONS } from "@/lib/billing/currency";

/**
 * Lets the reader choose the country the estimate is shown in, instead of
 * relying on a guessed geo header. The choice is remembered in the same cookie
 * the server already reads, so picking a country refreshes the page with the
 * matching currency.
 */
export function CountrySelector({
  country,
  className = "",
}: {
  country: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(country ?? "");

  useEffect(() => {
    setValue(country ?? "");
  }, [country]);

  function onChange(next: string) {
    setValue(next);
    if (next) {
      document.cookie = `${COUNTRY_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    } else {
      document.cookie = `${COUNTRY_COOKIE}=; path=/; max-age=0; samesite=lax`;
    }
    router.refresh();
  }

  return (
    <label className={`block ${className}`}>
      <span className="eyebrow block px-1 pb-1.5">Your country</span>
      <select
        name="country"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field py-2 text-[12px]"
        aria-label="Choose your country for the price estimate"
      >
        <option value="">Choose your country</option>
        {COUNTRY_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name} ({option.currency})
          </option>
        ))}
      </select>
      <span className="mt-1 block px-1 text-[10px] text-low">
        Used only to show an estimated amount in your currency. Payment is
        charged in Malaysian ringgit.
      </span>
    </label>
  );
}