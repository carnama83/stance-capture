// src/components/WebOptInCard.tsx
//
// Shown after an anonymous web visitor answers. Two ways to opt in:
//   1) Email magic-link (primary, robust) — creates a real account via Supabase
//      Auth, then attaches that user to the visitor's forward node.
//   2) WhatsApp click-to-chat — a wa.me button that prefills "SUBSCRIBE"; when
//      they send it, the webhook records a global opt-in (no OTP, no template).
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyForwardRef } from "@/lib/webStance";

// Your business WhatsApp number, digits only (from display +1 201-466-7244).
const WA_BUSINESS_NUMBER = "12014667244";
const PENDING_ATTACH_KEY = "sc_pending_attach_ref";

export function WebOptInCard({ questionId }: { questionId: string }) {
  const [email, setEmail] = React.useState("");
  const [emailSent, setEmailSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // If the visitor returns already authenticated (clicked the magic link),
  // attach their user to the forward node they created earlier.
  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) return;
      const ref = getMyForwardRef(questionId) || localStorage.getItem(PENDING_ATTACH_KEY);
      if (!ref) return;
      try {
        await supabase.rpc("attach_user_to_node", { p_ref: ref, p_user_id: userId });
        localStorage.removeItem(PENDING_ATTACH_KEY);
      } catch { /* non-fatal */ }
    })();
  }, [questionId]);

  async function sendMagicLink() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError("Enter a valid email address."); return; }
    setBusy(true);
    try {
      // Stash the ref so we can attach after the round-trip through email.
      const ref = getMyForwardRef(questionId);
      if (ref) localStorage.setItem(PENDING_ATTACH_KEY, ref);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setEmailSent(true);
    } catch {
      setError("Couldn't send the link. Check the address and try again.");
    } finally { setBusy(false); }
  }

  const waHref =
    `https://wa.me/${WA_BUSINESS_NUMBER}?text=${encodeURIComponent("SUBSCRIBE")}`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <p className="text-sm font-medium text-slate-700">Track your stances &amp; get updates</p>

      {/* Track 1 — email magic-link */}
      {emailSent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          ✅ Check your email for a sign-in link. Open it on this device to finish.
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="email" inputMode="email" placeholder="you@email.com" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" disabled={busy} onClick={sendMagicLink}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </div>
      )}

      {/* Track 2 — WhatsApp click-to-chat */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <a
        href={waHref} target="_blank" rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
      >
        💬 Get updates on WhatsApp
      </a>
      <p className="text-[11px] leading-snug text-slate-400">
        Opens WhatsApp with a pre-filled "SUBSCRIBE" message. Send it to opt in. Reply STOP anytime.
      </p>

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
