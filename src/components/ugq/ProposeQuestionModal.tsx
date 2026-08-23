// src/components/ugq/ProposeQuestionModal.tsx
// Epic UGQ — Build Step 3: question proposal modal (spec §9.2).
//
// Submits to the ugq-submit Edge Function using the established auth-mutex
// bypass (getJwt() + raw fetch via supabaseHeaders), not the SDK.
//
// v1 scope notes:
//   - Topic is shown as a fixed chip only when launched with a preset (e.g. from
//     a topic page). There is no topic picker yet — admins assign the topic in
//     Gate 2. (auto_topic suggestion is stored by ugq-screen for that UI.)
//   - Location pre-fills from `defaultLocation` if the caller passes it.
//
// Aug 2026: ugq-submit now returns `preview_reframe` — a fast, UNVERIFIED
// preview of how the raw text might read as a polished stance question
// (generated in parallel with Gate 1 screening, no fact-checking/web search).
// Shown on the success screen so proposers get immediate confidence-building
// feedback instead of waiting for admin review. Explicitly labeled "not
// final" since the fact-checked version (admin Gate 2) can differ.

import * as React from "react";
import { Loader2, CheckCircle2, Lightbulb, Sparkles } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

const MIN_LEN = 20;
const MAX_LEN = 1000;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetTopicId?: string | null;
  presetTopicTitle?: string | null;
  presetConstituencyId?: string | null;
  defaultLocation?: string | null;
};

// Shape returned by ugq-submit's `preview_reframe` field. Null/absent when
// the proposal was rejected or the preview call failed — always handle that.
type PreviewReframe = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  quality_notes?: string | null;
};

function parsePreviewReframe(raw: unknown): PreviewReframe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const question = typeof r.question === "string" ? r.question.trim() : "";
  if (!question) return null;
  return {
    question,
    slider_low_label: typeof r.slider_low_label === "string" ? r.slider_low_label : null,
    slider_high_label: typeof r.slider_high_label === "string" ? r.slider_high_label : null,
    quality_notes: typeof r.quality_notes === "string" ? r.quality_notes : null,
  };
}

export function ProposeQuestionModal({
  open,
  onOpenChange,
  presetTopicId = null,
  presetTopicTitle = null,
  presetConstituencyId = null,
  defaultLocation = null,
}: Props) {
  const [question, setQuestion] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [location, setLocation] = React.useState(defaultLocation ?? "");
  const [phase, setPhase] = React.useState<"form" | "submitting" | "success">("form");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [previewReframe, setPreviewReframe] = React.useState<PreviewReframe | null>(null);

  // Reset to a clean form each time the modal opens.
  React.useEffect(() => {
    if (open) {
      setQuestion("");
      setSourceUrl("");
      setLocation(defaultLocation ?? "");
      setPhase("form");
      setErrorMsg(null);
      setPreviewReframe(null);
    }
  }, [open, defaultLocation]);

  const trimmed = question.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LEN;
  const canSubmit = trimmed.length >= MIN_LEN && trimmed.length <= MAX_LEN && phase !== "submitting";

  async function handleSubmit() {
    if (!canSubmit) return;
    setPhase("submitting");
    setErrorMsg(null);
    try {
      const jwt = getJwt();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-submit`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({
          raw_question: trimmed,
          source_url: sourceUrl.trim() || null,
          location_label: location.trim() || null,
          suggested_topic_id: presetTopicId,
          constituency_id: presetConstituencyId,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        // Edge function returns friendly messages for limit/cooldown/dup/auth.
        const msg = json?.message ?? "Something went wrong. Please try again.";
        setErrorMsg(msg);
        setPhase("form");
        return;
      }

      if (json.status === "rejected") {
        // Auto-screen declined it (e.g. duplicate / not a stance question).
        setErrorMsg(json.message ?? "Your question wasn't accepted. Try rephrasing it.");
        setPhase("form");
        return;
      }

      // proposed / in_review / approved → accepted into the queue. Preview is
      // best-effort (null if the parallel preview call failed or timed out) —
      // the success screen still works fine without it.
      setPreviewReframe(parsePreviewReframe(json.preview_reframe));
      setPhase("success");
    } catch (_e) {
      setErrorMsg("Network error. Please check your connection and try again.");
      setPhase("form");
    }
  }

  function close() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {phase === "success" ? (
          <div className="flex flex-col items-center text-center py-6 gap-3">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <DialogTitle className="text-lg">Submitted!</DialogTitle>
            <DialogDescription>
              We&#x2019;ll review your question and notify you when it&#x2019;s live.
            </DialogDescription>

            {previewReframe ? (
              <div className="w-full mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  Here&#x2019;s roughly how this might look
                </div>
                <p className="text-sm text-slate-800 leading-snug">
                  {previewReframe.question}
                </p>
                {(previewReframe.slider_low_label || previewReframe.slider_high_label) ? (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
                    <span className="truncate">{previewReframe.slider_low_label ?? "Oppose"}</span>
                    <span className="text-slate-300 shrink-0">&#8596;</span>
                    <span className="truncate text-right">{previewReframe.slider_high_label ?? "Support"}</span>
                  </div>
                ) : null}
                <p className="text-[11px] text-amber-700/80 pt-1">
                  Not final &#x2014; an editor fact-checks and refines this before it goes live.
                </p>
              </div>
            ) : null}

            <Button className="mt-2" onClick={close}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-500" />
                Propose a question
              </DialogTitle>
              <DialogDescription>
                Surface an issue you care about. If it meets our civic-framing bar, it goes
                live as a stance card &#x2014; with credit to you.
              </DialogDescription>
            </DialogHeader>

            {presetTopicTitle ? (
              <div>
                <Badge variant="secondary">Topic: {presetTopicTitle}</Badge>
              </div>
            ) : null}

            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="ugq-question">Your question</Label>
                <Textarea
                  id="ugq-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value.slice(0, MAX_LEN))}
                  placeholder="What do you want the community to weigh in on?"
                  rows={4}
                  autoFocus
                />
                <div className="flex justify-between text-xs">
                  <span className={tooShort ? "text-amber-600" : "text-slate-400"}>
                    {tooShort ? `At least ${MIN_LEN} characters` : "\u00A0"}
                  </span>
                  <span className="text-slate-400">{trimmed.length}/{MAX_LEN}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ugq-source">Source link <span className="text-slate-400">(optional)</span></Label>
                <Input
                  id="ugq-source"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="Add a link for context"
                  inputMode="url"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ugq-location">Location <span className="text-slate-400">(optional)</span></Label>
                <Input
                  id="ugq-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Lucknow, UP"
                />
              </div>

              {errorMsg ? (
                <p className="text-sm text-red-600">{errorMsg}</p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={phase === "submitting"}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {phase === "submitting" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting&#x2026;</>
                ) : (
                  "Submit for review"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ProposeQuestionModal;
