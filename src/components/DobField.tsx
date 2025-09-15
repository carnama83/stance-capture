// src/components/DobField.tsx
import * as React from "react";
export function DobField({ value, setValue }: { value: string; setValue: (v: string) => void }) {
  const [err, setErr] = React.useState("");
  function onChange(v: string) {
    setValue(v);
    const d = new Date(v); const min = new Date(); min.setFullYear(min.getFullYear() - 13);
    setErr(d > min ? "You must be at least 13." : "");
  }
  return (
    <div>
      <input type="date" className="w-full border rounded px-3 py-2" value={value} onChange={e => onChange(e.target.value)} required />
      {err && <div className="text-xs text-rose-600 mt-1">{err}</div>}
    </div>
  );
}
