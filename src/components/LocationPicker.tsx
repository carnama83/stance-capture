// src/components/LocationPicker.tsx
import * as React from "react";
type Opt = { id: string; label: string };
export default function LocationPicker({
  detected, onConfirm
}: {
  detected?: { city?: Opt; state?: Opt; country: Opt; precision: "city" | "state" | "country" },
  onConfirm: (chosen: { locationId: string; precision: "city" | "state" | "country"; override: boolean; source: string }) => void
}) {
  const [country, setCountry] = React.useState<Opt | undefined>(detected?.country);
  const [state, setState] = React.useState<Opt | undefined>(detected?.state);
  const [city, setCity] = React.useState<Opt | undefined>(detected?.city);
  const [precision, setPrecision] = React.useState<"city" | "state" | "country">(detected?.precision || "country");
  const override = !!(!detected || (city?.id !== detected?.city?.id || state?.id !== detected?.state?.id || country?.id !== detected?.country?.id));
  const source = detected ? (override ? "manual" : "ip-geo") : "manual";

  function confirm() {
    const chosen = precision === "city" ? city : precision === "state" ? state : country;
    if (!chosen) return;
    onConfirm({ locationId: chosen.id, precision, override, source });
  }

  // Replace with your searchable dropdowns; this is a stub to wire the flow
  return (
    <div className="space-y-2">
      <input className="w-full border rounded px-3 py-2" placeholder="Country (ID)" value={country?.id || ""} onChange={e => setCountry({ id: e.target.value, label: e.target.value })} />
      <input className="w-full border rounded px-3 py-2" placeholder="State (ID optional)" value={state?.id || ""} onChange={e => setState({ id: e.target.value, label: e.target.value })} />
      <input className="w-full border rounded px-3 py-2" placeholder="City (ID optional)" value={city?.id || ""} onChange={e => setCity({ id: e.target.value, label: e.target.value })} />
      <select className="w-full border rounded px-3 py-2" value={precision} onChange={e => setPrecision(e.target.value as any)}>
        <option value="country">Country</option><option value="state">State</option><option value="city">City</option>
      </select>
      <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={confirm}>Confirm location</button>
      {override && <div className="text-xs">Override recorded; raw IP discarded.</div>}
    </div>
  );
}
