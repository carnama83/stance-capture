// src/components/HomeOptInPrompt.tsx
//
// A single floating prompt for the homepage. Logged-out users can stage stances
// on any card (no login bounce); once they've staged at least one, this slides up
// from the bottom offering the same email / WhatsApp opt-in as the detail page —
// but only ONCE, so the feed stays uncluttered.
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/webStance";
import { buildWaHref } from "@/lib/whatsapp";

export function HomeOptInPrompt({
  stagedCount,
  onDismiss,
}: {
  stagedCount: number;       // how many stances they've staged this session
  onDismiss: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [emailSent, setEmailSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (stagedCount < 1) return null;

  async function sendMagicLink() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError("Enter a valid email address."); return; }
    setBusy(true);
    try {
      // Return to the homepage after auth; OAuthCallbackPage reads return_to.
      try { localStorage.setItem("return_to", "#/"); } catch { /* ignore */ }
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/#/auth/callback` },
      });
      if (error) throw error;
      setEmailSent(true);
    } catch {
      setError("Couldn't send the link. Try again in a moment.");
    } finally { setBusy(false); }
  }

  // Same device_id embedding as WebOptInCard.tsx — here it matters even more,
  // since a homepage visitor can have staged several questions (stagedCount)
  // before subscribing. commit_staged_stances_for_device() commits all of
  // them for this device in one shot, not just whichever prompted the click.
  const deviceId = getDeviceId();
  const waText = deviceId ? `SUBSCRIBE ${deviceId}` : "SUBSCRIBE";
  const waHref = buildWaHref(waText);

  // Collapsed pill
  if (!open) {
    return (
      <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-violet-700"
        >
          ✓ {stagedCount} stance{stagedCount > 1 ? "s" : ""} recorded — add your voice to count {stagedCount > 1 ? "them" : "it"} →
        </button>
      </div>
    );
  }

  // Expanded card
  return (
    <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-violet-200 bg-white p-4 shadow-2xl space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              ✓ {stagedCount} stance{stagedCount > 1 ? "s" : ""} recorded
            </p>
            <p className="text-xs text-slate-500">Not counted yet — add your voice to make {stagedCount > 1 ? "them" : "it"} count.</p>
          </div>
          <button type="button" onClick={() => { setOpen(false); onDismiss(); }} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>

        {emailSent ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            ✅ Check your email for a sign-in link. Open it on this device.
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

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" /><span className="text-xs text-slate-400">or</span><div className="h-px flex-1 bg-slate-200" />
        </div>
        <a href={waHref} target="_blank" rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
          💬 Add my voice on WhatsApp
        </a>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
