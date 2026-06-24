// src/components/WebOptInCard.tsx
//
// Shown on the question page AFTER an anonymous web visitor answers. Lets them
// opt in (phone + OTP) to "track their stances / get updates", which promotes
// their anonymous forward node into a known, sendable identity.
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyForwardRef } from "@/lib/webStance";

type Step = "idle" | "phone" | "code" | "done";

export function WebOptInCard({ questionId }: { questionId: string }) {
  const [step, setStep] = React.useState<Step>("idle");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function fn(name: string, body: unknown) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) throw new Error(error.message);
    if (!(data as { ok?: boolean })?.ok) throw new Error((data as { reason?: string })?.reason ?? "failed");
    return data;
  }

  async function sendCode() {
    setError(null);
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) { setError("Enter your number in full international format, e.g. +9198…"); return; }
    setBusy(true);
    try {
      await fn("whatsapp-web-optin-start", { phone_number: phone });
      setStep("code");
    } catch (e) {
      setError(String((e as Error).message) === "too_many_requests" ? "Too many attempts — try again in a few minutes." : "Couldn't send the code. Check the number and try again.");
    } finally { setBusy(false); }
  }

  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    try {
      await fn("whatsapp-web-optin-verify", { phone_number: phone, code, ref: getMyForwardRef(questionId) });
      setStep("done");
    } catch {
      setError("That code didn't match or has expired. Request a new one.");
    } finally { setBusy(false); }
  }

  if (step === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        ✅ You're in. We'll let you know when the community stance shifts.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {step === "idle" && (
        <button
          type="button"
          onClick={() => setStep("phone")}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          📲 Track your stances — get updates (optional)
        </button>
      )}

      {step === "phone" && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Get notified when this shifts</p>
          <input
            inputMode="tel" placeholder="+91 98765 43210" value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="button" disabled={busy} onClick={sendCode}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Sending…" : "Send code on WhatsApp"}
          </button>
        </div>
      )}

      {step === "code" && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Enter the 6-digit code we sent on WhatsApp</p>
          <input
            inputMode="numeric" maxLength={6} placeholder="••••••" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em]"
          />
          <button type="button" disabled={busy} onClick={verify}
            className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button type="button" onClick={() => setStep("phone")} className="text-xs text-slate-500 underline">
            Use a different number
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
