// src/auth/PhoneSignInFlow.tsx
//
// "Sign in with phone number" — the recovery path for a WhatsApp-first
// account that skipped adding a real email (see this session's design
// discussion: "Sign in via WhatsApp" covers the case where WhatsApp is
// open on the device you're using right now; this covers the ordinary
// "I'm on some other computer, forgot my password" case, where reading an
// OTP off a phone and typing it into a different device is what's
// actually needed).
//
// Two steps, both hitting existing or newly-added edge functions directly
// — no session exists yet for either call, same situation as
// WhatsAppSigninPage.tsx, so this uses the same raw-fetch-with-anon-key
// pattern rather than the Supabase SDK client.
//   1. Enter phone number -> whatsapp-send-flow (verification_mode: true,
//      UNCHANGED, already used by SettingsProfile.tsx and already works
//      without a session) -> get back a verification_token.
//   2. Enter the 6-digit code -> whatsapp-otp-verify (new) -> get back a
//      whatsapp_signin_tokens token -> redirect into the EXACT SAME
//      redemption page (WhatsAppSigninPage.tsx) the SUBSCRIBE flow uses.
//      No new session-establishment code at all past step 2.
import * as React from "react";
import { Loader2 } from "lucide-react";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { useTranslation } from "react-i18next";

type Step = "phone" | "otp";

async function callFunction(name: string, body: Record<string, unknown>) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, data };
}

export default function PhoneSignInFlow() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(false);
  const [step, setStep] = React.useState<Step>("phone");
  const [phone, setPhone] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [verificationToken, setVerificationToken] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function handleSendOtp() {
    setErr(null);
    if (!phone.trim()) {
      setErr(t("auth.enterPhoneNumber"));
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await callFunction("whatsapp-send-flow", {
        phone_number: phone.trim(),
        verification_mode: true,
      });
      if (!ok || !data?.sent) {
        setErr(
          data?.reason === "opted_out"
            ? t("auth.optedOutOfWhatsApp")
            : t("auth.couldntSendCode")
        );
        return;
      }
      setVerificationToken(data.verification_token);
      setStep("otp");
    } catch {
      setErr(t("auth.couldntReachServer"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setErr(null);
    if (!otp || otp.length !== 6) {
      setErr(t("auth.enterSixDigitCodeWhatsApp"));
      return;
    }
    if (!verificationToken) {
      setErr(t("auth.verificationExpired"));
      setStep("phone");
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await callFunction("whatsapp-otp-verify", {
        verification_token: verificationToken,
        otp,
      });
      if (!ok || !data?.ok || !data?.token) {
        setErr(
          data?.reason === "no_account_for_number"
            ? t("auth.noAccountForNumber")
            : data?.reason === "invalid_or_expired_code"
            ? t("auth.incorrectOrExpiredCode")
            : t("auth.verificationFailed")
        );
        return;
      }
      // Same redemption page the SUBSCRIBE flow already uses — no new
      // session-establishment logic needed past this point.
      window.location.href = `${window.location.origin}/#/auth/whatsapp-signin?token=${encodeURIComponent(data.token)}`;
    } catch {
      setErr(t("auth.couldntReachServer"));
    } finally {
      setBusy(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full text-sm text-slate-600 underline text-center"
      >
        {t("auth.signedUpViaWhatsApp")}
      </button>
    );
  }

  return (
    <div className="rounded border p-3 space-y-2">
      {step === "phone" ? (
        <>
          <div className="text-sm font-medium">{t("auth.signInWithPhoneNumber")}</div>
          <input
            type="tel"
            className="w-full border rounded px-3 py-2"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button
            type="button"
            className="w-full rounded bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
            onClick={handleSendOtp}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : t("auth.sendCodeViaWhatsApp")}
          </button>
        </>
      ) : (
        <>
          <div className="text-sm font-medium">{t("auth.enterCodeFromWhatsApp")}</div>
          <input
            inputMode="numeric"
            maxLength={6}
            className="w-full border rounded px-3 py-2"
            placeholder="123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").trim())}
            disabled={busy}
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
              onClick={handleVerifyOtp}
              disabled={busy || otp.length < 6}
            >
              {busy ? t("auth.verifying") : t("auth.verifyAndSignIn")}
            </button>
            <button
              type="button"
              className="rounded border px-4 py-2 text-sm"
              onClick={() => {
                setStep("phone");
                setOtp("");
                setErr(null);
              }}
              disabled={busy}
            >
              {t("auth.back")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
