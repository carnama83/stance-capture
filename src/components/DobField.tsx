// src/components/DobField.tsx
// M-A08: Replaced <input type="date"> with month/day/year selects for
// consistent cross-browser, cross-locale rendering.
import * as React from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function calcAge(year: number, month: number, day: number): number {
  const today = new Date();
  let age = today.getFullYear() - year;
  const mDiff = today.getMonth() + 1 - month;
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < day)) age--;
  return age;
}

interface DobFieldProps {
  value: string;        // YYYY-MM-DD
  setValue: (v: string) => void;
  error?: string;       // external error from parent validate()
  /** Optional ref forwarded to the wrapper div; used by Signup for scroll-to-error. */
  containerRef?: React.RefObject<HTMLDivElement>;
}

export function DobField({ value, setValue, error: externalError, containerRef }: DobFieldProps) {
  const parsed = React.useMemo(() => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { y: "", m: "", d: "" };
    const [y, m, d] = value.split("-");
    return { y, m: String(parseInt(m, 10)), d: String(parseInt(d, 10)) };
  }, [value]);

  const [year, setYear]   = React.useState(parsed.y);
  const [month, setMonth] = React.useState(parsed.m);
  const [day, setDay]     = React.useState(parsed.d);
  const [inlineErr, setInlineErr] = React.useState("");

  React.useEffect(() => {
    setYear(parsed.y);
    setMonth(parsed.m);
    setDay(parsed.d);
  }, [parsed.y, parsed.m, parsed.d]);

  const currentYear = new Date().getFullYear();
  const yearRange = Array.from({ length: 120 }, (_, i) => currentYear - i);

  const numMonth = parseInt(month, 10);
  const numYear  = parseInt(year, 10);
  const maxDays  = numMonth >= 1 && numMonth <= 12 && numYear > 0
    ? daysInMonth(numMonth, numYear) : 31;
  const dayRange = Array.from({ length: maxDays }, (_, i) => i + 1);

  function update(y: string, m: string, d: string) {
    setYear(y); setMonth(m); setDay(d);
    const ny = parseInt(y, 10);
    const nm = parseInt(m, 10);
    const nd = parseInt(d, 10);

    if (!y || !m || !d) { setValue(""); setInlineErr(""); return; }

    const maxD = daysInMonth(nm, ny);
    const clampedDay = Math.min(nd, maxD);
    if (clampedDay !== nd) setDay(String(clampedDay));

    const iso = `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
    setValue(iso);
    const age = calcAge(ny, nm, clampedDay);
    setInlineErr(age < 13 ? "You must be at least 13." : "");
  }

  const displayErr = inlineErr || externalError || "";
  const sel = "border rounded px-2 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-400";

  return (
    <div className="space-y-1" ref={containerRef}>
      <div className="flex gap-2">
        <select aria-label="Month" className={`${sel} flex-1`} value={month}
          onChange={(e) => update(year, e.target.value, day)}>
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={i + 1} value={String(i + 1)}>{name}</option>
          ))}
        </select>

        <select aria-label="Day" className={`${sel} w-20`} value={day}
          onChange={(e) => update(year, month, e.target.value)}>
          <option value="">Day</option>
          {dayRange.map((d) => (
            <option key={d} value={String(d)}>{d}</option>
          ))}
        </select>

        <select aria-label="Year" className={`${sel} w-24`} value={year}
          onChange={(e) => update(e.target.value, month, day)}>
          <option value="">Year</option>
          {yearRange.map((y) => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>
      </div>
      {displayErr && <div className="text-xs text-rose-600 mt-1">{displayErr}</div>}
    </div>
  );
}
