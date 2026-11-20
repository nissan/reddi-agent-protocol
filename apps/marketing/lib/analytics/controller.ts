// WEB-17: the analytics controller. It sits between the consent choice and PostHog and owns every rule about
// when anything may be loaded, sent or kept. The browser pieces (the dynamic import, storage clearing) are
// injected, so the whole behaviour, including withdrawal, runs in node tests with a fake PostHog.
//
//   consent ─ apply() ─ no category on: nothing is loaded; anything loaded is reset and its storage cleared
//                     └ a category on:  import posthog-js once, init with options for that consent
//   navigate()/track() ─ prepare() against the taxonomy and the LIVE consent ─ PostHog ─ before_send re-checks
//
// WEB-46, what withdrawal can and cannot reach: anything held on our side (the in-memory queue, an
// import still in flight) is dropped or refused by the live consent check at the moment of sending. Owner decision A8
// removed the "remembered" moments, so a moment before acceptance holds nothing at all. A request the browser has already been handed (request_batching is off, so there is no PostHog batch queue)
// or a retry of a failed request inside posthog-js cannot be recalled from here; before_send is the last gate for
// every event that has not yet been built.
//
// Withdrawal is synchronous at the gate: `consent` changes first, so the next event is refused before any
// asynchronous work. PostHog's own opt-out flag is deliberately not used, because it would itself be a stored key.
import { isEventName, prepare, PAGE_VIEW_EVENT, type Consented, type EventName } from "./taxonomy.ts";
import { initOptions, persistenceFor, type AnalyticsConfig } from "./config.ts";
import { parseCampaign, isTokenRoute, safePath, referrerHost, type Campaign } from "./campaign.ts";

// The slice of the PostHog API the controller uses.
export interface PostHogLike {
  init(key: string, options: Record<string, unknown>): unknown;
  capture(name: string, properties: Record<string, unknown>): void;
  reset(): void;
  set_config(options: Record<string, unknown>): void;
}

export type Dependencies = {
  config: AnalyticsConfig;
  load: () => Promise<PostHogLike>;
  clearStorage: () => void;
  origin: string; // e.g. https://agent-protocol.reddi.tech, used to build the recorded URL from a path
  ownHost: string;
};

// PostHog's own technical fields that identify nothing beyond an anonymous browser; everything else it adds is dropped.
const SYSTEM_KEYS = ["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$lib", "$lib_version", "$is_identified", "$process_person_profile", "$browser", "$browser_version", "$os", "$os_version", "$device_type", "$screen_width", "$screen_height", "$viewport_width", "$viewport_height"];

const none: Consented = { product: false, acquisition: false };

export function createController(deps: Dependencies) {
  let consent: Consented = none;
  let ph: PostHogLike | null = null;
  let loading: Promise<void> | null = null;
  let generation = 0; // bumped on every apply(): a late import never initialises under an older choice
  let path: string | null = null;
  let navigations = 0;
  let sentFor = 0;
  let campaign: Campaign = {};
  let landingReferrer: string | undefined;
  // WEB-40: an interaction event that happens AFTER acceptance but while the library is still loading (it is a dynamic
  // import behind consent) waits here, in memory only, and is sent once it is ready. It is queued only under product
  // consent that is live at that moment, and is dropped by any withdrawal, so nothing outlives the choice that allowed
  // it. An event before acceptance is never queued (track() refuses it), and nothing else replays it on acceptance.
  let queued: { name: EventName; props: Record<string, unknown> }[] = [];
  const QUEUE_LIMIT = 8;
  const active = () => consent.product || consent.acquisition;

  // PostHog's last line of defence: runs on every event it is about to send.
  function beforeSend(event: unknown): unknown {
    const e = event as { event?: unknown; properties?: Record<string, unknown> } | null;
    if (!e || !active() || typeof e.event !== "string") return null;
    const name = e.event === PAGE_VIEW_EVENT ? "page_view" : e.event;
    if (!isEventName(name)) return null; // posthog-internal events never leave
    const src = e.properties ?? {};
    const out: Record<string, unknown> = {};
    for (const key of SYSTEM_KEYS) if (key in src) out[key] = src[key];
    // Our own properties were checked by prepare(); re-check them against the taxonomy for this consent.
    const again = prepare(name, src, consent, true);
    if (!again) return null;
    Object.assign(out, again.properties);
    const clean = safePath(typeof src.path === "string" ? src.path : "/unknown");
    out.$current_url = `${deps.origin}${clean}`; // never the query string
    out.$pathname = clean;
    out.$host = deps.ownHost;
    return { ...e, properties: out };
  }

  async function ensureLoaded() {
    if (ph) return;
    loading ??= deps.load().then((instance) => {
      instance.init(deps.config.key, initOptions(deps.config, persistenceFor(consent), beforeSend));
      ph = instance;
    });
    await loading;
  }

  function send(name: EventName, props: Record<string, unknown>, landing: boolean): boolean {
    if (!ph) return false;
    const prepared = prepare(name, props, consent, landing);
    if (!prepared) return false;
    try { ph.capture(name === "page_view" ? PAGE_VIEW_EVENT : name, prepared.properties); } catch { return false; } // WEB-46: a failing library never reaches the caller
    return true;
  }

  function sendPageView() {
    if (!ph || path === null || sentFor === navigations) return;
    const landing = navigations === 1;
    const props: Record<string, unknown> = { path };
    if (!isTokenRoute(path)) { Object.assign(props, campaign); if (landing && landingReferrer) props.referrer_host = landingReferrer; }
    if (send("page_view", props, landing)) sentFor = navigations;
  }

  function withdraw() {
    queued = [];
    if (ph) {
      try { ph.reset(); ph.set_config({ persistence: "memory", disable_persistence: true }); } catch { /* storage is cleared below regardless */ }
    }
    deps.clearStorage();
  }

  return {
    // Called with the visitor's current choice (null = none made) at start and on every change.
    async apply(next: Consented | null) {
      const previous = consent;
      consent = next ? { product: next.product, acquisition: next.acquisition } : none; // the gate moves first, synchronously
      const token = ++generation;
      const narrowed = (previous.product && !consent.product) || (previous.acquisition && !consent.acquisition);
      if (!active() || narrowed) withdraw();
      if (!active()) { sentFor = 0; return; } // a later acceptance on this page sends its page view afresh
      try { await ensureLoaded(); } catch { loading = null; return; } // WEB-46: a blocked or failing import leaves analytics off; a later choice may retry
      if (token !== generation || !ph) return;
      try { ph.set_config({ persistence: persistenceFor(consent), disable_persistence: false }); } catch { return; }
      sendPageView();
      const waiting = queued; queued = [];
      for (const item of waiting) send(item.name, item.props, false); // send() re-checks the live consent
    },
    // The current route, held in memory until a category allows it to be sent.
    navigate(pathname: string, search: string, referrer: string) {
      navigations++;
      path = safePath(pathname);
      if (!isTokenRoute(path) && navigations === 1) { campaign = parseCampaign(search); landingReferrer = referrerHost(referrer, deps.ownHost); }
      sendPageView();
    },
    // Returns true when the event was sent or is waiting for the library to finish loading under live product consent.
    track(name: EventName, props: Record<string, unknown>) {
      const full = { path: path ?? undefined, ...props };
      if (ph) return send(name, full, false);
      if (!consent.product || prepare(name, full, consent, false) === null || queued.length >= QUEUE_LIMIT) return false;
      queued.push({ name, props: full });
      return true;
    },
    state: () => ({ consent: { ...consent }, loaded: ph !== null, campaign: { ...campaign } }),
  };
}

export type Controller = ReturnType<typeof createController>;
