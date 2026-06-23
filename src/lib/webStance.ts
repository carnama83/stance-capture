// src/lib/webStance.ts
//
// Channel-B (web link) helpers for the public question page. Lets an anonymous
// visitor who arrived via a ref-tagged link record a stance, get their own share
// ref back, and see the live distribution. Designed for the WhatsApp/Facebook
// in-app browser: no auth, no cookies required (localStorage is best-effort).
import { supabase } from "@/integrations/supabase/client";

const DEVICE_KEY = "sc_device_id";

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
    return ""; // in-app webview with isolated/blocked storage — RPC handles null
  }
}

/** Reads ?ref= out of the HashRouter URL, e.g. "#/q/<id>?ref=abc" -> "abc". */
export function getRefFromUrl(): string | null {
  const hash = window.location.hash || "";
  const qi = hash.indexOf("?");
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get("ref");
}

export type WebStanceResult = {
  my_ref: string;
  distribution: {
    responses: number;
    pct_high: number;   // agree (+1/+2)
    pct_middle: number; // neutral (0)
    pct_low: number;    // disagree (-1/-2)
  };
};

/**
 * Record an anonymous web stance. The RPC mints THIS visitor's own ref (for their
 * share link), dedups by device, writes the stance, and returns the live result.
 */
export async function recordWebStance(questionId: string, score: number): Promise<WebStanceResult> {
  const deviceId = getDeviceId();
  const { data, error } = await supabase.rpc("record_web_stance", {
    p_ref: getRefFromUrl(),
    p_question_id: questionId,
    p_score: score,
    p_device_id: deviceId || null,
  });
  if (error) throw error;
  return data as WebStanceResult;
}

/** Build the share link the visitor forwards onward — carries THEIR ref. */
export function buildShareLink(questionId: string, myRef: string): string {
  return `${window.location.origin}/#/q/${questionId}?ref=${myRef}`;
}

/** Convenience: a wa.me share URL with the question + link prefilled. */
export function buildWhatsAppShare(questionText: string, shareLink: string): string {
  const text = `📊 ${questionText}\nWhere do you stand? 👇\n${shareLink}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Is this visit a forwarded web visit (arrived with a ref and not signed in)?
 * Use this in QuestionDetailPage to route anonymous answers through recordWebStance
 * instead of the logged-in set_question_stance path.
 */
export function isAnonymousWebVisit(): boolean {
  return getRefFromUrl() !== null;
}
