// src/components/ugq/ProposeQuestionButton.tsx
// Epic UGQ — Build Step 3: propose entry point (spec §9.1).
//
// Reusable trigger that owns the ProposeQuestionModal. Two variants:
//   - "fab"    : fixed, persistent floating button (feed). Default.
//   - "inline" : a normal button for contextual placement (topic / question pages).
//
// Only renders for signed-in users (anon users see nothing). Auth is read with
// the same lightweight session pattern used across the app.

import * as React from "react";
import { Plus, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getSupabase } from "@/lib/supabaseClient";
import { ProposeQuestionModal } from "./ProposeQuestionModal";

type Session = import("@supabase/supabase-js").Session;

type Props = {
  variant?: "fab" | "inline";
  label?: string;
  presetTopicId?: string | null;
  presetTopicTitle?: string | null;
  presetConstituencyId?: string | null;
  defaultLocation?: string | null;
  className?: string;
};

export function ProposeQuestionButton({
  variant = "fab",
  label,
  presetTopicId = null,
  presetTopicTitle = null,
  presetConstituencyId = null,
  defaultLocation = null,
  className,
}: Props) {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  // Only signed-in users can propose.
  if (!session?.user) return null;

  const text = label ?? (presetTopicTitle ? `Ask about ${presetTopicTitle}` : "Propose a question");

  return (
    <>
      {variant === "fab" ? (
        <Button
          onClick={() => setOpen(true)}
          aria-label="Propose a question"
          className={cn(
            "fixed bottom-6 right-6 z-40 h-14 rounded-full shadow-lg",
            "px-5 gap-2",
            className,
          )}
        >
          <Plus className="h-5 w-5" />
          <span className="hidden sm:inline">Propose</span>
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} className={cn("gap-2", className)}>
          <Lightbulb className="h-4 w-4" />
          {text}
        </Button>
      )}

      <ProposeQuestionModal
        open={open}
        onOpenChange={setOpen}
        presetTopicId={presetTopicId}
        presetTopicTitle={presetTopicTitle}
        presetConstituencyId={presetConstituencyId}
        defaultLocation={defaultLocation}
      />
    </>
  );
}

export default ProposeQuestionButton;
