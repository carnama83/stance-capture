// src/components/UsernameField.tsx
import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";

export default function UsernameField({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  const client = React.useMemo(getSupabase, []);
  const [ok, setOk] = React.useState<null | boolean>(null);
  const [hint, setHint] = React.useState("");

  React.useEffect(() => {
    setOk(null); setHint("");
    const v = value.trim();
    if (!v) return;
    const t = setTimeout(async () => {
      if (!client) { setOk(null); setHint("Supabase OFF"); return; }
      const { data: valid } = await client.rpc("username_is_valid", { p_username: v });
      if (!valid) { setOk(false); setHint("3–20 chars, letters/digits/_"); return; }
      const start = performance.now();
      const { data: available } = await client.rpc("username_available", { p_username: v });
      setOk(!!available);
      setHint(available ? `Available (${Math.round(performance.now()-start)}ms)` : "Taken");
    }, 200);
    return () => clearTimeout(t);
  }, [value, client]);

  return (
    <div>
      <input
        className="w-full border rounded px-3 py-2"
        placeholder="Username (optional)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <div className="text-xs mt-1">{ok ? "✅ " : "❌ "}{hint}</div>}
    </div>
  );
}
