// src/lib/campaignAttribution.ts
// Epic Y — Step 3: first-click campaign attribution.
//
// When a user arrives on a question via a paid ad, the campaign destination URL
// carries `?ref=campaign&campaign_id=<uuid>`. We record that click (per question,
// first-click wins) for a 7-day window in localStorage, then read it back when a
// stance is submitted so the stance can be tagged with its originating campaign.
//
// Storage is a per-question map so a campaign that targets question A never
// bleeds attribution onto an unrelated stance on question B.

const KEY = "sc_campaign_attr_v1";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Entry {
  campaign_id: string;
  ts: number;
}
type Store = Record<string, Entry>; // keyed by question_id

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable — attribution is best-effort */
  }
}

function prune(store: Store): void {
  const now = Date.now();
  for (const k of Object.keys(store)) {
    if (now - store[k].ts > WINDOW_MS) delete store[k];
  }
}

/**
 * Read `ref` / `campaign_id` from the current URL and, if this is a campaign
 * landing, record a first-click attribution for the given question. Safe to call
 * on every QDP mount — first-click wins, so an existing valid entry is preserved.
 * Handles HashRouter URLs (query lives after `?` inside the hash).
 */
export function captureCampaignFromUrl(questionId: string): void {
  if (!questionId || typeof window === "undefined") return;

  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  const search = qIndex >= 0 ? hash.slice(qIndex + 1) : (window.location.search || "").replace(/^\?/, "");
  if (!search) return;

  const params = new URLSearchParams(search);
  const campaignId = params.get("campaign_id");
  const ref = params.get("ref");
  if (!campaignId || ref !== "campaign") return;

  const store = read();
  const existing = store[questionId];
  // First-click: keep an existing, still-valid attribution.
  if (existing && Date.now() - existing.ts < WINDOW_MS) return;

  store[questionId] = { campaign_id: campaignId, ts: Date.now() };
  prune(store);
  write(store);
}

/**
 * Return the attributed campaign_id for a question if a click was recorded
 * within the 7-day window, else null. Expired entries are cleaned up.
 */
export function getCampaignAttribution(questionId: string): string | null {
  if (!questionId) return null;
  const store = read();
  const entry = store[questionId];
  if (!entry) return null;
  if (Date.now() - entry.ts > WINDOW_MS) {
    delete store[questionId];
    write(store);
    return null;
  }
  return entry.campaign_id;
}
