/**
 * Probe results, and the one rule that turns an HTTP status into a sentence.
 *
 * Pure on purpose: the setup page's live probes are hard to test end to end,
 * but the classification is not. A 401 is a rejected key, a 429 is an accepted
 * key behind a limiter, and anything else is reported with its own status
 * instead of a generic "error".
 */

export type ProbeState = "ok" | "failed" | "skipped" | "unconfigured";

export type Probe = {
  id: string;
  label: string;
  state: ProbeState;
  detail: string;
  fix?: string;
};

export type ProbeClassification = {
  state: ProbeState;
  detail: string;
  fix?: string;
};

export function classifyProviderStatus(status: number): ProbeClassification {
  if (status >= 200 && status < 300) {
    return {
      state: "ok",
      detail: "The provider accepted this key.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      state: "failed",
      detail: "The provider rejected this key.",
      fix: "Replace the key in the environment and redeploy.",
    };
  }

  if (status === 429) {
    return {
      state: "ok",
      detail:
        "The key was accepted; the provider is rate limiting requests right now.",
    };
  }

  return {
    state: "failed",
    detail: `The provider answered ${status} to a model-list request.`,
    fix: "Check the provider's status page and the key's permissions.",
  };
}
