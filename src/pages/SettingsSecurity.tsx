// src/pages/SettingsSecurity.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

type TotpFactor = { id: string; created_at?: string; friendly_name?: string };

export default function SettingsSecurity() {
  const sb = React.useMemo(getSupabase, []);
  const [factors, setFactors] = React.useState<TotpFactor[]>([]);
  const [enrolling, setEnrolling] = React.useState<{ factorId: string; qr: string } | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");
      const u = await sb.auth.getUser();
      if (!u.data.user) return setMsg("Please log in.");
      await refresh();
    })();
  }, [sb]);

  async function refresh() {
    setMsg(null);
    const res = await sb!.auth.mfa.listFactors();
    if (res.error) return setMsg(res.error.message);
    setFactors(res.data.totp as any);
  }

  async function startEnroll() {
    setMsg(null);
    setBusy(true);
    try {
      const { data, error } = await sb!.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      // data.totp.qr_code is an SVG image string; display directly in <img>.
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code });
    } catch (e: any) {
      setMsg(e.message || "Could not start enrollment");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnroll() {
    if (!enrolling) return setEnrolling(null);
    // Best-effort cleanup (unenroll the unverified factor)
    try {
      await sb!.auth.mfa.unenroll({ factorId: enrolling.factorId });
    } catch {}
    setEnrolling(null);
    setVerifyCode("");
  }

  async function verifyEnroll() {
    if (!enrolling) return;
    setBusy(true);
    setMsg(null);
    try {
      // 1) Create challenge for this factor
      const ch = await sb!.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (ch.error) throw ch.error;
      // 2) Verify the code from the authenticator app
      const vr = await sb!.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: ch.data.id,
        code: verifyCode.trim(),
      });
      if (vr.error) throw vr.error;

      setMsg("Authenticator enabled.");
      setEnrolling(null);
      setVerifyCode("");
      await refresh();
    } catch (e: any) {
      setMsg(e.message || "Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await sb!.auth.mfa.unenroll({ factorId: id });
      if (error) throw error;
      setMsg("Removed authenticator.");
      await refresh();
    } catch (e: any) {
      setMsg(e.message || "Could not remove authenticator");
    } finally {
      setBusy(false);
    }
  }

  if (!sb) return <div className="p-6">Supabase is OFF (check env).</div>;

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Security</h1>
      {msg && <div className="text-sm text-slate-700">{msg}</div>}

      <section className="rounded-xl border p-4 space-y-3">
        <h2 className="font-medium">Two-Factor Auth (TOTP)</h2>

        {/* Enroll flow */}
        {!enrolling ? (
          <div className="space-y-2">
            {factors.length === 0 ? (
              <p className="text-sm text-slate-600">No authenticators yet.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {factors.map((f) => (
                  <li key={f.id} className="flex items-center justify-between">
                    <span>Authenticator • <span className="text-slate-500">{f.id.slice(-6)}</span></span>
                    <button
                      className="text-red-600 hover:underline"
                      onClick={() => removeFactor(f.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="pt-2">
              <button
                className="border rounded px-3 py-2 text-sm"
                onClick={startEnroll}
                disabled={busy}
              >
                {busy ? "Starting…" : "Enable authenticator"}
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Tip: You can enroll **more than one** authenticator (e.g., a backup device) —
                Supabase doesn’t use recovery codes; multiple factors act as recovery. 
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">Scan this QR in your authenticator app, then enter the 6-digit code:</div>
            {/* Supabase returns an SVG string; put it directly as the image source */}
            <img alt="TOTP QR" src={enrolling.qr} className="w-48 h-48 border rounded" />
            <input
              inputMode="numeric"
              maxLength={8}
              className="w-40 border rounded px-2 py-1"
              placeholder="123456"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
            />
            <div className="flex gap-2">
              <button className="rounded bg-slate-900 text-white px-3 py-1" onClick={verifyEnroll} disabled={busy}>
                {busy ? "Verifying…" : "Enable"}
              </button>
              <button className="rounded border px-3 py-1" onClick={cancelEnroll} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
