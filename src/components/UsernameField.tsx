// src/components/UsernameField.tsx
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

export default function UsernameField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const client = React.useMemo(getSupabase, []);
  const [ok, setOk] = React.useState<null | boolean>(null);
  const [hint, setHint] = React.useState("");

  // ✅ NEW: fetch the signed-in user's current username once,
  // so we can treat "Taken" as "Yours" when appropriate.
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

    const vRaw = value.trim();
    if (!vRaw) return;

    const v = vRaw.toLowerCase();
    const mine = (myUsername || "").trim().toLowerCase();

    const t = setTimeout(async () => {
      if (!client) {
        setOk(null);
        setHint("Supabase OFF");
        return;
      }

      // 1) validate format
      const { data: valid } = await client.rpc("username_is_valid", {
        p_username: v,
      });
      if (!valid) {
        setOk(false);
        setHint("3–20 chars, letters/digits/_");
        return;
      }

      // 2) availability check (keep existing behavior + timing)
      const start = performance.now();
      const { data: available } = await client.rpc("username_available", {
        p_username: v,
      });

      // ✅ If not available but it matches the user's current username, show "Yours"
      if (!available && mine && v === mine) {
        setOk(true);
        setHint("Yours");
        return;
      }

      setOk(!!available);
      setHint(
        available
          ? `Available (${Math.round(performance.now() - start)}ms)`
          : "Taken"
      );
    }, 200);

    return () => clearTimeout(t);
  }, [value, client, myUsername]);

  return (
    <div>
      <input
        className="w-full border rounded px-3 py-2"
        placeholder="Username (optional)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <div className="text-xs mt-1">
          {ok ? "✅ " : "❌ "}
          {hint}
        </div>
      )}
    </div>
  );
}
