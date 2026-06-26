// src/components/WebOptInCard.tsx
//
// Shown after an anonymous web visitor STAGES a stance (moves the slider). Their
// stance is recorded as theirs but does NOT count in the community total until they
// commit by opting in — via email magic-link or WhatsApp click-to-chat. This card is
// the commit step, framed around what they gain by joining.
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyForwardRef } from "@/lib/webStance";

const WA_BUSINESS_NUMBER = "12014667244"; // +1 201-466-7244, digits only
const PENDING_ATTACH_KEY = "sc_pending_attach_ref";

export function WebOptInCard({
  questionId,
  stanceLabel,
}: {
  questionId: string;
  stanceLabel?: string | null; // e.g. "Strongly oppose" — shown back to them
}) {
  const [email, setEmail] = React.useState("");
  const [emailSent, setEmailSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // If they return already authenticated (clicked the magic link), commit the
  // staged stance by attaching their user to the node.
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
      const ref = getMyForwardRef(questionId);
      if (ref) localStorage.setItem(PENDING_ATTACH_KEY, ref);

      // After auth, OAuthCallbackPage reads sessionStorage.return_to and navigates
      // back here, where the attach effect commits the staged stance.
      const returnTo = `#/q/${questionId}`;
      try { sessionStorage.setItem("return_to", returnTo); } catch { /* ignore */ }

      // Magic link must land on the app's /auth/callback route (which extracts the
      // token and calls setSession) — NOT directly on the question page, which has
      // no token-extraction logic under HashRouter.
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/#/auth/callback` },
      });
      if (error) throw error;
      setEmailSent(true);
    } catch {
      setError("Couldn't send the link. Check the address and try again.");
    } finally { setBusy(false); }
  }

  const waHref = `https://wa.me/${WA_BUSINESS_NUMBER}?text=${encodeURIComponent("SUBSCRIBE")}`;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-4">
      {/* Recorded → not yet counted */}
      <div>
        <p className="text-sm font-semibold text-slate-800">
          ✓ Your stance{stanceLabel ? <> — <span className="text-violet-700">{stanceLabel}</span></> : null} is recorded
        </p>
        <p className="mt-1 text-sm text-slate-600">
          It's not in the community total yet. Add your voice to make it count.
        </p>
      </div>

      {/* Why join */}
      <ul className="space-y-1.5 text-[13px] text-slate-600">
        <li className="flex gap-2"><span>📈</span><span><b className="text-slate-700">Track how your view evolves</b> — see your stance change over time as the issue develops.</span></li>
        <li className="flex gap-2"><span>🌍</span><span><b className="text-slate-700">Compare to your community</b> — your city, state, and country, not just the global number.</span></li>
        <li className="flex gap-2"><span>🔔</span><span><b className="text-slate-700">Get notified when consensus shifts</b> — know when the community moves.</span></li>
        <li className="flex gap-2"><span>📣</span><span><b className="text-slate-700">Strengthen the signal</b> — verified voices make the collective stance harder to ignore.</span></li>
      </ul>

      {/* Track 1 — email magic-link */}
      {emailSent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          ✅ Check your email for a sign-in link. Open it on this device to add your voice.
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
            {busy ? "Sending…" : "Add my voice — email me a link"}
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
        💬 Add my voice on WhatsApp
      </a>
      <p className="text-[11px] leading-snug text-slate-400">
        Opens WhatsApp with a pre-filled "SUBSCRIBE" message. Send it to count your stance and get updates. Reply STOP anytime.
      </p>

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
