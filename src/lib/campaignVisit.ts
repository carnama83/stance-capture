// src/lib/campaignVisit.ts
// Facebook Campaign Manager (PDD v1.2) + Epic Y: campaign link visits.
//
// A campaign link (/c/<code>, or a legacy paid-ad URL carrying
// ?ref=campaign&campaign_id=<uuid>) is recorded server-side by
// record_campaign_visit, which returns an unguessable visit id. That id is kept
// here per question for 7 days and sent with the stance as p_campaign_visit_id.
// The server decides whether it counts (first stance on that question, visit
// for that question, under 7 days old); nothing here is trusted.
//
// Most recent visit wins (PDD §13). Replaces src/lib/campaignAttribution.ts,
// whose capture was never wired up.

import { supabase } from "@/integrations/supabase/client";

const KEY = "sc_campaign_visits_v1";
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// A refresh or re-open of the same link soon after is the same visit.
const REUSE_MS = 30 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|facebot|meta-externalagent|headless|lighthouse|preview|scanner|python|curl|wget/i;

interface Entry {
  visit_id: string;
  ts: number;
  src: string; // "c:<code>" or "paid:<campaign_id>"
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
    const now = Date.now();
    for (const k of Object.keys(store)) {
      if (now - store[k].ts > WINDOW_MS) delete store[k];
    }
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: attribution is best-effort */
  }
}

function looksAutomated(): boolean {
  if (typeof navigator === "undefined") return true;
  if ((navigator as any).webdriver) return true;
  return BOT_UA.test(navigator.userAgent || "");
}

const inFlight = new Set<string>();

/** Record a landing from a campaign link. Best-effort; never throws. */
export async function recordCampaignVisit(src: { code?: string | null; paidCampaignId?: string | null }): Promise<void> {
  const code = src.code && /^[a-z0-9]{8,12}$/i.test(src.code) ? src.code.toLowerCase() : null;
  const paid = !code && src.paidCampaignId && UUID_RE.test(src.paidCampaignId) ? src.paidCampaignId : null;
  if (!code && !paid) return;
  if (looksAutomated()) return;

  const key = code ? `c:${code}` : `paid:${paid}`;
  const store = read();
  if (Object.values(store).some((e) => e.src === key && Date.now() - e.ts < REUSE_MS)) return;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  try {
    const { data, error } = await (supabase as any).rpc("record_campaign_visit", {
      p_code: code,
      p_paid_campaign_id: paid,
    });
    if (error) {
      console.warn("[campaignVisit] record failed:", error.message);
      return;
    }
    const row = data as { visit_id?: string; question_id?: string } | null;
    if (!row?.visit_id || !row?.question_id) return;
    const next = read();
    next[row.question_id] = { visit_id: row.visit_id, ts: Date.now(), src: key };
    write(next);
  } catch (err) {
    console.warn("[campaignVisit] record failed:", err);
  } finally {
    inFlight.delete(key);
  }
}

/** The visit id to send with a stance on this question, or null. */
export function getCampaignVisit(questionId: string | null | undefined): string | null {
  if (!questionId) return null;
  const entry = read()[questionId];
  if (!entry) return null;
  if (Date.now() - entry.ts > WINDOW_MS) return null;
  return entry.visit_id;
}
