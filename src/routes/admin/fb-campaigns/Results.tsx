// src/routes/admin/fb-campaigns/Results.tsx
// Campaign results (PDD v1.2 §4, §6, §15): task counts, visits, first stances
// and conversion per destination, and the city aggregate with and without
// campaign-attributed respondents.
//
// Descriptive only. A difference describes who answered through each route; it
// does not show the campaign caused a shift, and neither group is
// representative of the city. Facebook impressions are not inferred from clicks.

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Campaign, Pill, Loading, ErrorBox, rpc, errMsg, LEAN_LABEL } from "./shared";

interface Segment {
  segment: string;
  n: number;
  later_updates: number;
  support_pct: number | null;
  neutral_pct: number | null;
  oppose_pct: number | null;
  mean: number | null;
  too_few_to_compare: boolean;
}
interface Destination {
  link_id: string;
  code: string;
  destination_kind: "page" | "group" | "paid_ad";
  group_name: string | null;
  group_lean: "general" | "interest" | "partisan" | null;
  language_code: string;
  visits: number;
  first_stances: number;
  pending_first_stances: number;
}
interface Impact {
  segments: Segment[];
  destinations: Destination[];
  tasks_by_status: Record<string, number>;
  note: string;
}

const SEGMENT_LABEL: Record<string, string> = {
  all: "Everyone",
  this_campaign: "Arrived via this campaign",
  without_this_campaign: "Everyone else",
  any_campaign: "Arrived via any campaign",
  without_any_campaign: "No campaign link",
};

function pct(v: number | null) {
  return v === null ? "—" : `${v}%`;
}

export default function CampaignResults({ c }: { c: Campaign }) {
  const { data, isLoading, isError, error } = useQuery<Impact>({
    queryKey: ["fb-impact", c.id],
    staleTime: 30_000,
    queryFn: () => rpc<Impact>("admin_social_campaign_impact", { p_social_campaign_id: c.id }),
  });

  const thisSeg = data?.segments.find((s) => s.segment === "this_campaign");
  const otherSeg = data?.segments.find((s) => s.segment === "without_this_campaign");
  const gap = thisSeg && otherSeg && thisSeg.mean !== null && otherSeg.mean !== null
    ? Math.abs(thisSeg.mean - otherSeg.mean) : null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-900">Results</h2>
      {isLoading && <Loading />}
      {isError && <ErrorBox>{errMsg(error)}</ErrorBox>}
      {data && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.tasks_by_status).map(([k, v]) => <Pill key={k}>{k}: {v}</Pill>)}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-1.5 pr-3 font-medium">Destination</th>
                  <th className="py-1.5 pr-3 font-medium">Lang</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Visits</th>
                  <th className="py-1.5 pr-3 font-medium text-right">First stances</th>
                  <th className="py-1.5 pr-3 font-medium text-right">of which signed out</th>
                  <th className="py-1.5 font-medium text-right">Visit → stance</th>
                </tr>
              </thead>
              <tbody>
                {data.destinations.map((d) => (
                  <tr key={d.link_id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-800">
                      {d.destination_kind === "page" ? "Page" : d.group_name}
                      {d.group_lean && d.group_lean !== "general" && <span className="ml-1.5 text-amber-600">({LEAN_LABEL[d.group_lean]})</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{d.language_code}</td>
                    <td className="py-1.5 pr-3 text-right">{d.visits}</td>
                    <td className="py-1.5 pr-3 text-right">{d.first_stances}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{d.pending_first_stances}</td>
                    <td className="py-1.5 text-right">{d.visits ? `${Math.round((100 * d.first_stances) / d.visits)}%` : "—"}</td>
                  </tr>
                ))}
                {data.destinations.length === 0 && (
                  <tr><td colSpan={6} className="py-3 text-center text-slate-400">No links yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-1.5 pr-3 font-medium">Respondents</th>
                  <th className="py-1.5 pr-3 font-medium text-right">n</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Support</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Neutral</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Oppose</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Mean</th>
                  <th className="py-1.5 font-medium text-right">Later updates</th>
                </tr>
              </thead>
              <tbody>
                {data.segments.map((s) => (
                  <tr key={s.segment} className="border-b border-slate-50">
                    <td className="py-1.5 pr-3 text-slate-800">
                      {SEGMENT_LABEL[s.segment] ?? s.segment}
                      {s.too_few_to_compare && s.n > 0 && <span className="ml-1.5 text-slate-400">(too few to compare)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{s.n}</td>
                    <td className="py-1.5 pr-3 text-right">{pct(s.support_pct)}</td>
                    <td className="py-1.5 pr-3 text-right">{pct(s.neutral_pct)}</td>
                    <td className="py-1.5 pr-3 text-right">{pct(s.oppose_pct)}</td>
                    <td className="py-1.5 pr-3 text-right">{s.mean ?? "—"}</td>
                    <td className="py-1.5 text-right">{s.later_updates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {gap !== null && gap >= 0.5 && thisSeg && !thisSeg.too_few_to_compare && (
            <p className="text-xs text-amber-700 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              Respondent-composition signal: people who arrived through this campaign answered differently from everyone else (mean gap {gap.toFixed(2)}). This describes who answered through each route, not an effect of the campaign.
            </p>
          )}
          <p className="text-[11px] text-slate-400">{data.note}</p>
        </>
      )}
    </section>
  );
}
