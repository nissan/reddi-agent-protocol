export const CONSENT_KEY = "rap.consent";
// Raise the version whenever the meaning of a category changes: every saved choice is then ignored and asked again.
export const CONSENT_VERSION = 1;
// Fired on `window` with the new ConsentPreference as `detail` whenever the visitor saves a choice, so the analytics
// controller reacts at once and also when storage is blocked (the choice then lives only for this visit).
export const CONSENT_EVENT = "rap:consent";

export type ConsentPreference = {
  version: typeof CONSENT_VERSION;
  acquisition: boolean;
  product: boolean;
};

export type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export function preference(acquisition = false, product = false): ConsentPreference {
  return { version: CONSENT_VERSION, acquisition, product };
}

export function parseConsent(raw: string | null): ConsentPreference | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== CONSENT_VERSION || typeof record.acquisition !== "boolean" || typeof record.product !== "boolean") return null;
    // Persist only these fields, never arbitrary data from a stored record.
    return preference(record.acquisition, record.product);
  } catch {
    return null;
  }
}

export function readConsent(storage: ConsentStorage): ConsentPreference | null {
  try {
    return parseConsent(storage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function writeConsent(storage: ConsentStorage, value: ConsentPreference): boolean {
  try {
    storage.setItem(CONSENT_KEY, JSON.stringify(preference(value.acquisition, value.product)));
    return true;
  } catch {
    return false;
  }
}

// The app's copy of apps/marketing/lib/consent.ts. The two sites are separate origins, so each keeps its own choice.
// PostHog is wired behind these categories in lib/analytics/ (components/analytics/Analytics.tsx mounts it). Never
// include emails, wallet data, keys or credentials. Session replay, autocapture and cross-domain linkage stay disabled.
