// src/lib/stanceReasons.ts
//
// Epic Report R3 — client side of "why did you choose this?".
//
// Both calls go through edge functions via supabase.functions.invoke, which
// sends the user's JWT when signed in and the anon key otherwise; the
// functions pick the signed-in or anonymous path from that.

import { getSupabase } from "@/lib/supabaseClient";
import { getDeviceId } from "@/lib/webStance";

export type ReasonSide = "low" | "neutral" | "high";

export interface ReasonOption {
  side: ReasonSide;
  key: string;
  label: string;
  position: number;
  language_code: string;
}

export function sideOf(score: number): ReasonSide {
  return score < 0 ? "low" : score > 0 ? "high" : "neutral";
}

export async function fetchReasonOptions(questionId: string, languageCode: string): Promise<ReasonOption[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.functions.invoke("generate-reason-options", {
    body: { question_id: questionId, language_code: languageCode },
  });
  if (error) throw error;
  return ((data as { options?: ReasonOption[] })?.options ?? []) as ReasonOption[];
}

export type SubmitReasonError = "no_stance" | "empty_reason" | "invalid_device" | "save_failed";

export async function submitStanceReason(args: {
  questionId: string;
  optionKeys: string[];
  text: string;
  languageCode: string;
  isAuthed: boolean;
}): Promise<{ moderationStatus: string }> {
  const sb = getSupabase();
  if (!sb) throw new Error("save_failed");
  const { data, error } = await sb.functions.invoke("submit-stance-reason", {
    body: {
      question_id: args.questionId,
      option_keys: args.optionKeys,
      text: args.text.trim() || null,
      language_code: args.languageCode,
      device_id: args.isAuthed ? null : getDeviceId() || null,
    },
  });
  if (error) {
    // FunctionsHttpError carries the response; surface the function's own code.
    let code: SubmitReasonError = "save_failed";
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) code = body.error;
    } catch {
      /* keep save_failed */
    }
    throw new Error(code);
  }
  return { moderationStatus: (data as { moderation_status?: string })?.moderation_status ?? "none" };
}
