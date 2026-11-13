/**
 * The advertising consent record.
 *
 * One key, one choice, one event. The banner writes it, and the two places that
 * would otherwise act without it — the ad frames and the ad-block gate — read
 * it. A banner whose answer nothing reads is worse than no banner: it asks a
 * question and then ignores the reply.
 */

export const CONSENT_STORAGE_KEY = "openmi-cookie-consent";

/** Fired on `window` after a choice is stored, so open frames react at once. */
export const CONSENT_EVENT = "openmi:consent";

export type ConsentChoice = "accepted" | "declined";

/** Anything that is not one of the two choices is "no choice yet". */
export function parseConsent(
  value: string | null | undefined
): ConsentChoice | null {
  if (value === "accepted" || value === "declined") return value;
  return null;
}

/** The stored choice, or null when nothing was stored or storage is blocked. */
export function readConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;

  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    // Private mode or a blocked storage partition: treat it as no choice.
    return null;
  }
}

/**
 * Records a choice and tells the page.
 *
 * The event matters because the alternative is a reload: a reader who presses
 * Accept should see the banner go and the ad frames arrive in the same view.
 */
export function writeConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // The choice still applies to this page through the event below.
  }

  window.dispatchEvent(
    new CustomEvent<ConsentChoice>(CONSENT_EVENT, { detail: choice })
  );
}

/** True only when the reader has explicitly accepted advertising. */
export function adsAllowed(choice: ConsentChoice | null): boolean {
  return choice === "accepted";
}
