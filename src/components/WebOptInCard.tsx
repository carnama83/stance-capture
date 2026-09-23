// src/components/WebOptInCard.tsx
//
// Shown after an anonymous web visitor STAGES a stance (moves the slider). Their
// stance is recorded as theirs but does NOT count in the community total until they
// commit by opting in — via email magic-link or WhatsApp click-to-chat. This card is
// the commit step, framed around what they gain by joining.
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyForwardRef, getDeviceId } from "@/lib/webStance";
import { buildWaHref } from "@/lib/whatsapp";
import { Trans, useTranslation } from "react-i18next";

const PENDING_ATTACH_KEY = "sc_pending_attach_ref";

export function WebOptInCard({
  questionId,
  stanceLabel,
}: {
  questionId: string;
  stanceLabel?: string | null; // e.g. "Strongly oppose" — shown back to them
}) {
  const { t } = useTranslation();
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
        // p_device_id proves this browser answered: a ref alone is shared in
        // every forwarded link, so the RPC only commits a device-bound node for
        // the device that recorded it (Epic AA-04).
        await supabase.rpc("attach_user_to_node", {
          p_ref: ref, p_user_id: userId, p_device_id: getDeviceId() || null,
        });
        localStorage.removeItem(PENDING_ATTACH_KEY);
      } catch { /* non-fatal */ }
    })();
  }, [questionId]);

  async function sendMagicLink() {
    setError(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError(t("auth.enterValidEmail")); return; }
    setBusy(true);
    try {
      const ref = getMyForwardRef(questionId);
      if (ref) localStorage.setItem(PENDING_ATTACH_KEY, ref);

      // After auth, OAuthCallbackPage reads sessionStorage.return_to and navigates
      // back here, where the attach effect commits the staged stance.
      // Use localStorage (survives the new tab the email link opens) — sessionStorage
      // is per-tab and would be empty in the tab the magic link opens.
      const returnTo = `#/q/${questionId}`;
      try { localStorage.setItem("return_to", returnTo); } catch { /* ignore */ }

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
      setError(t("webOptIn.couldnTSendTheLink"));
    } finally { setBusy(false); }
  }

  // Carry the device_id through so whatsapp-flow-webhook can find and commit
  // everything this browser staged, not just this one question — see
  // commit_staged_stances_for_device(). Falls back to bare SUBSCRIBE if
  // localStorage is blocked (getDeviceId() returns "").
  const deviceId = getDeviceId();
  const waText = deviceId ? `SUBSCRIBE ${deviceId}` : "SUBSCRIBE";
  const waHref = buildWaHref(waText);

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-4">
      {/* Recorded → not yet counted */}
      <div>
        <p className="text-sm font-semibold text-slate-800">
          {stanceLabel ? (
            <Trans
              i18nKey="webOptIn.stanceRecordedLabeled"
              values={{ label: stanceLabel }}
              components={{ v: <span className="text-violet-700" /> }}
            />
          ) : (
            t("webOptIn.stanceRecorded")
          )}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {t("webOptIn.itSNotInThe")}
        </p>
      </div>

      {/* Why join */}
      <ul className="space-y-1.5 text-[13px] text-slate-600">
        <li className="flex gap-2"><span>📈</span><span><b className="text-slate-700">{t("webOptIn.trackHowYourViewEvolves")}</b> {t("webOptIn.seeYourStanceChangeOver")}</span></li>
        <li className="flex gap-2"><span>🌍</span><span><b className="text-slate-700">{t("webOptIn.compareToYourCommunity")}</b> {t("webOptIn.yourCityStateAndCountry")}</span></li>
        <li className="flex gap-2"><span>🔔</span><span><b className="text-slate-700">{t("webOptIn.getNotifiedWhenConsensusShifts")}</b> {t("webOptIn.knowWhenTheCommunityMoves")}</span></li>
        <li className="flex gap-2"><span>📣</span><span><b className="text-slate-700">{t("webOptIn.strengthenTheSignal")}</b> {t("webOptIn.verifiedVoicesMakeTheCollective")}</span></li>
      </ul>

      {/* Track 1 — email magic-link */}
      {emailSent ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t("webOptIn.checkYourEmailForA")}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="email" inputMode="email" placeholder={t("webOptIn.youEmailCom")} value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" disabled={busy} onClick={sendMagicLink}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? t("webOptIn.sending") : t("webOptIn.addMyVoiceEmailMe")}
          </button>
        </div>
      )}

      {/* Track 2 — WhatsApp click-to-chat */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-400">{t("webOptIn.or")}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      <a
        href={waHref} target="_blank" rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
      >
        {t("webOptIn.addMyVoiceOnWhatsapp")}
      </a>
      <p className="text-[11px] leading-snug text-slate-400">
        {t("webOptIn.opensWhatsappWithAPre")}
      </p>

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
