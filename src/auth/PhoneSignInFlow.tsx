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
      setErr("Enter your phone number.");
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
            ? "This number has opted out of WhatsApp messages. Reply START on WhatsApp first."
            : "Couldn't send a code. Check the number and try again."
        );
        return;
      }
      setVerificationToken(data.verification_token);
      setStep("otp");
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setErr(null);
    if (!otp || otp.length !== 6) {
      setErr("Enter the 6-digit code from WhatsApp.");
      return;
    }
    if (!verificationToken) {
      setErr("Verification session expired. Please request a new code.");
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
            ? "No account found for this number. Text SUBSCRIBE on WhatsApp first to create one."
            : data?.reason === "invalid_or_expired_code"
            ? "Incorrect or expired code. Please try again."
            : "Verification failed. Please try again."
        );
        return;
      }
      // Same redemption page the SUBSCRIBE flow already uses — no new
      // session-establishment logic needed past this point.
      window.location.href = `${window.location.origin}/#/auth/whatsapp-signin?token=${encodeURIComponent(data.token)}`;
    } catch {
      setErr("Couldn't reach the server. Check your connection and try again.");
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
        Signed up via WhatsApp? Sign in with your phone number
      </button>
    );
  }

  return (
    <div className="rounded border p-3 space-y-2">
      {step === "phone" ? (
        <>
          <div className="text-sm font-medium">Sign in with your phone number</div>
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
            {busy ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Send code via WhatsApp"}
          </button>
        </>
      ) : (
        <>
          <div className="text-sm font-medium">Enter the code from WhatsApp</div>
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
              {busy ? "Verifying…" : "Verify & sign in"}
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
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
