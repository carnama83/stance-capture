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

import * as React from "react";
import { Loader2, CheckCircle2, Lightbulb } from "lucide-react";
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

  // Reset to a clean form each time the modal opens.
  React.useEffect(() => {
    if (open) {
      setQuestion("");
      setSourceUrl("");
      setLocation(defaultLocation ?? "");
      setPhase("form");
      setErrorMsg(null);
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

      // proposed / in_review → accepted into the queue.
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
