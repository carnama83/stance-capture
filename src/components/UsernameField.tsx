// src/components/UsernameField.tsx
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

type UStatus = "idle" | "invalid" | "checking" | "available" | "taken";

export default function UsernameField({
  value,
  onChange,
  setValue,
  error,
  status,
  setStatus,
}: {
  value: string;
  onChange: (v: string) => void;
  setValue?: (v: string) => void;
  error?: string;
  status?: UStatus;
  setStatus?: (s: UStatus) => void;
}) {
  const client = React.useMemo(getSupabase, []);
  const [ok, setOk] = React.useState<null | boolean>(null);
  const [hint, setHint] = React.useState("");

  // Fetch the signed-in user's current username once so we can treat
  // "Taken" as "Yours" when appropriate (settings page use case).
  const [myUsername, setMyUsername] = React.useState<string>("");

  React.useEffect(() => {
    let cancelled = false;

    async function loadMyUsername() {
      try {
        if (!client) return;

        const { data: sess } = await client.auth.getSession();
        const uid = sess.session?.user?.id;
        if (!uid) {
          if (!cancelled) setMyUsername("");
          return;
        }

        const { data, error } = await client
          .from("profiles")
          .select("username")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          if (!cancelled) setMyUsername("");
          return;
        }

        const u = (data?.username || "").toString();
        if (!cancelled) setMyUsername(u);
      } catch {
        if (!cancelled) setMyUsername("");
      }
    }

    loadMyUsername();
    return () => {
      cancelled = true;
    };
  }, [client]);

  React.useEffect(() => {
    setOk(null);
    setHint("");
    setStatus?.("idle");

    const vRaw = value.trim();
    if (!vRaw) return;

    const v = vRaw.toLowerCase();
    const mine = (myUsername || "").trim().toLowerCase();

    setStatus?.("checking");

    const t = setTimeout(async () => {
      if (!client) {
        setOk(null);
        setHint("Supabase OFF");
        setStatus?.("idle");
        return;
      }

      // 1) validate format
      const { data: valid } = await client.rpc("username_is_valid", {
        p_username: v,
      });
      if (!valid) {
        setOk(false);
        setHint("3–20 chars, letters/digits/_");
        setStatus?.("invalid");
        return;
      }

      // 2) If it matches the user's own current username, short-circuit — no RPC needed
      if (mine && v === mine) {
        setOk(true);
        setHint("Yours");
        setStatus?.("available");
        return;
      }

      // 3) availability check
      const start = performance.now();
      const { data: available } = await client.rpc("username_available", {
        p_username: v,
      });

      setOk(!!available);
      setStatus?.(available ? "available" : "taken");
      setHint(
        available
          ? `Available (${Math.round(performance.now() - start)}ms)`
          : "Taken"
      );
    }, 200);

    return () => clearTimeout(t);
  }, [value, client, myUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor="username">
        Username <span className="text-rose-600">*</span>
      </label>
      <input
        id="username"
        className={[
          "mt-1 w-full border rounded px-3 py-2",
          error ? "border-rose-500" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        placeholder="Choose a username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="username"
      />
      {/* Availability hint (only shown when user has typed something) */}
      {hint && !error && (
        <div className="text-xs mt-1">
          {ok ? "✅ " : "❌ "}
          {hint}
        </div>
      )}
      {/* Validation error from parent (required / format) — takes priority over hint */}
      {error && (
        <p className="mt-1 text-xs text-rose-600">{error}</p>
      )}
    </div>
  );
}
