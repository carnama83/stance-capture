// src/lib/webStance.ts
//
// Channel-B (web link) helpers for the public question page. An anonymous visitor
// who arrived via a ref-tagged link can record a stance, gets their OWN minted ref
// back (stored locally so the Share button can extend the chain), and sees the live
// distribution. Built for the WhatsApp/Facebook in-app browser: no auth, no cookies
// required (localStorage is best-effort).
import { supabase } from "@/integrations/supabase/client";
import { getCampaignVisit } from "@/lib/campaignVisit";

const DEVICE_KEY = "sc_device_id";
const FWD_PREFIX = "sc_fwd_"; // sc_fwd_<questionId> -> this visitor's own forward ref

/** Stable-ish anonymous browser id for dedup. Returns "" if storage is blocked. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      const rnd =
        (crypto as Crypto)?.randomUUID?.().replace(/-/g, "").slice(0, 16) ??
        Math.random().toString(36).slice(2, 18);
      id = "dev_" + rnd;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

// Sep 2026, FIX: a stance recorded before sign-in is staged against THIS
// browser's device id. On launch night people answered inside WhatsApp's
// in-app browser, then opened the email link in Gmail/Chrome: a different
// browser, a different device id, so nothing was committed. The email link now
// carries the device id. It goes in the real query string BEFORE the '#':
// Supabase appends '#access_token=...' after the whole URL, and
// OAuthCallbackPage's parser expects "#/auth/callback#...", so a query inside
// the hash route would corrupt the token parse.
const STAGED_DEVICE_PARAM = "sd";

/** Email-link redirect target that also carries this browser's device id. */
export function authCallbackUrl(): string {
  const origin = window.location.origin;
  const deviceId = getDeviceId();
  return deviceId
    ? `${origin}/?${STAGED_DEVICE_PARAM}=${encodeURIComponent(deviceId)}#/auth/callback`
    : `${origin}/#/auth/callback`;
}

/**
 * The device id carried in by an email link (if any), removed from the address
 * bar once read. Only ids in our own format are accepted.
 */
export function takeStagedDeviceFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(STAGED_DEVICE_PARAM);
    if (raw === null) return null;
    url.searchParams.delete(STAGED_DEVICE_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
    return /^dev_[A-Za-z0-9]{6,40}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Reads ?ref= out of the HashRouter URL, e.g. "#/q/<id>?ref=abc" -> "abc". */
export function getRefFromUrl(): string | null {
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get("ref");
}

/** This visitor's OWN minted forward ref for a question (set after they answer). */
export function getMyForwardRef(questionId: string): string | null {
  try {
    return localStorage.getItem(FWD_PREFIX + questionId);
  } catch {
    return null;
  }
}

export type WebStanceResult = {
  my_ref: string;
  distribution: { responses: number; pct_high: number; pct_middle: number; pct_low: number };
};

/** Coarse IP-derived location, best-effort. Used only to resolve a location_id. */
export type WebStanceGeo = {
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
};

/**
 * Record an anonymous web stance. The RPC mints THIS visitor's own ref (parented to
 * the ref they arrived on), dedups by device, writes the stance, and returns the live
 * result. The minted ref is stashed locally so ShareButton can extend the chain.
 *
 * `renditionId` is the rendition whose wording the visitor actually read. It is
 * staged alongside the score so that, if they later sign in, the commit path has
 * honest provenance to promote. Staging without one is allowed but the row will
 * be SKIPPED at commit time rather than committed against inferred wording — so
 * pass it whenever the caller knows it.
 *
 * `geo` was previously accepted by callers but silently dropped: this function
 * declared two parameters while Index.tsx passed three, so p_country_code /
 * p_state_name / p_city_name were never sent and homepage staged stances never
 * resolved a location. It is now threaded through properly.
 */
export async function recordWebStance(
  questionId: string,
  score: number,
  renditionId?: string | null,
  geo?: WebStanceGeo | null,
): Promise<WebStanceResult> {
  const { data, error } = await supabase.rpc("record_web_stance", {
    p_ref: getRefFromUrl(),
    p_question_id: questionId,
    p_score: score,
    p_device_id: getDeviceId() || null,
    p_country_code: geo?.countryCode ?? null,
    p_state_name: geo?.region ?? null,
    p_city_name: geo?.city ?? null,
    p_rendition_id: renditionId ?? null,
    // Campaign link visit, if any; the server credits it only on this device's first answer.
    p_campaign_visit_id: getCampaignVisit(questionId),
  });
  if (error) throw error;
  const result = data as WebStanceResult;
  try {
    if (result?.my_ref) localStorage.setItem(FWD_PREFIX + questionId, result.my_ref);
  } catch { /* storage blocked — chain still attributes via parent ref */ }
  return result;
}

/** Is this visit a forwarded web visit (arrived with a ref)? */
export function isAnonymousWebVisit(): boolean {
  return getRefFromUrl() !== null;
}
