// src/routes/admin/whatsapp/BroadcastDetail.tsx
// Epic AA — AA6.1
//
// Admin: Broadcast detail view — full delivery and stance metrics.
// /admin/whatsapp/broadcasts/:id

import * as React from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft, RefreshCw, Loader2, Download,
  CheckCircle2, XCircle, AlertTriangle, MessageSquareDot,
  Users, Send, BarChart3, TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

const PROJECT_REF = "yzxzpnomcarnxixhjlba";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

function getJwt(): string {
  try {
    const raw = localStorage.getItem(`sb-${PROJECT_REF}-auth-token`);
    return raw ? JSON.parse(raw)?.access_token ?? "" : "";
  } catch { return ""; }
}

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

type Broadcast = {
  id: string;
  name: string;
  status: string;
  question_id: string;
  contact_list_id: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  completed_at: string | null;
  total_contacts: number;
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  total_opened: number;
  total_completed: number;
  total_stances: number;
  created_at: string;
};

type StanceDistribution = {
  score: number;
  count: number;
  attributed: number;
  anonymous: number;
};

export default function AdminWhatsAppBroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const [broadcast, setBroadcast]     = React.useState<Broadcast | null>(null);
  const [question, setQuestion]       = React.useState<{ question: string; slug: string | null } | null>(null);
  const [distribution, setDistribution] = React.useState<StanceDistribution[]>([]);
  const [loading, setLoading]         = React.useState(true);

  async function loadData() {
    if (!id) return;
    setLoading(true);
    const jwt = getJwt();
    const headers = {
      "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
      "Authorization": `Bearer ${jwt}`,
    };

    try {
      // Load broadcast
      const bRes = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_broadcasts?id=eq.${id}&select=*`,
        { headers }
      );
      const bRows = await bRes.json();
      const b = bRows[0] as Broadcast | undefined;
      if (!b) { toast({ title: "Broadcast not found", variant: "destructive" }); return; }
      setBroadcast(b);

      // Load question
      if (b.question_id) {
        const qRes = await fetch(
          `${SUPABASE_URL}/rest/v1/questions?id=eq.${b.question_id}&select=question,slug`,
          { headers }
        );
        const qRows = await qRes.json();
        setQuestion(qRows[0] ?? null);
      }

      // Load stance distribution from question_stances
      const sRes = await fetch(
        `${SUPABASE_URL}/rest/v1/question_stances?broadcast_id=eq.${id}&select=score,user_id`,
        { headers }
      );
      const stances = await sRes.json();

      if (Array.isArray(stances)) {
        const counts: Record<number, { total: number; attributed: number; anonymous: number }> = {
          [-2]: { total: 0, attributed: 0, anonymous: 0 },
          [-1]: { total: 0, attributed: 0, anonymous: 0 },
          [0]:  { total: 0, attributed: 0, anonymous: 0 },
          [1]:  { total: 0, attributed: 0, anonymous: 0 },
          [2]:  { total: 0, attributed: 0, anonymous: 0 },
        };
        for (const s of stances) {
          const sc = Number(s.score);
          if (sc in counts) {
            counts[sc].total++;
            if (s.user_id) counts[sc].attributed++;
            else counts[sc].anonymous++;
          }
        }
        setDistribution(
          Object.entries(counts).map(([score, c]) => ({
            score: Number(score),
            count: c.total,
            attributed: c.attributed,
            anonymous: c.anonymous,
          }))
        );
      }
    } catch {
      toast({ title: "Failed to load broadcast data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadData(); }, [id]);

  function handleExport() {
    if (!broadcast) return;
    const rows = [
      ["Metric", "Value"],
      ["Name", broadcast.name],
      ["Status", broadcast.status],
      ["Scheduled at", fmtDate(broadcast.scheduled_at)],
      ["Sent at", fmtDate(broadcast.sent_at)],
      ["Completed at", fmtDate(broadcast.completed_at)],
      ["Total contacts", broadcast.total_contacts],
      ["Total sent", broadcast.total_sent],
      ["Total delivered", broadcast.total_delivered],
      ["Delivery rate", pct(broadcast.total_delivered, broadcast.total_sent)],
      ["Flows opened", broadcast.total_opened],
      ["Open rate", pct(broadcast.total_opened, broadcast.total_sent)],
      ["Flows completed", broadcast.total_completed],
      ["Completion rate", pct(broadcast.total_completed, broadcast.total_sent)],
      ["Total stances", broadcast.total_stances],
      ["Failed", broadcast.total_failed],
      ...distribution.map((d) => [
        `Score ${d.score}`,
        `${d.count} (${d.attributed} attributed, ${d.anonymous} anonymous)`,
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `broadcast_${id}_metrics.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scoreLabels: Record<number, string> = {
    [-2]: "Strongly Disagree",
    [-1]: "Disagree",
    [0]:  "Neutral",
    [1]:  "Agree",
    [2]:  "Strongly Agree",
  };

  const barColors: Record<number, string> = {
    [-2]: "#ef4444",
    [-1]: "#f97316",
    [0]:  "#94a3b8",
    [1]:  "#22c55e",
    [2]:  "#16a34a",
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading broadcast…</span>
      </div>
    );
  }

  if (!broadcast) return null;

  const totalStances = distribution.reduce((s, d) => s + d.count, 0);
  const agreeCount   = distribution.filter((d) => d.score > 0).reduce((s, d) => s + d.count, 0);
  const disagreeCount= distribution.filter((d) => d.score < 0).reduce((s, d) => s + d.count, 0);
  const neutralCount = distribution.filter((d) => d.score === 0).reduce((s, d) => s + d.count, 0);
  const attributedCount = distribution.reduce((s, d) => s + d.attributed, 0);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link to="/admin/whatsapp/broadcasts" className="mt-1 rounded border p-1.5 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{broadcast.name}</h1>
          {question && (
            <p className="text-sm text-slate-500 mt-0.5">
              "{question.question.slice(0, 100)}{question.question.length > 100 ? "…" : ""}"
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            Created {fmtDate(broadcast.created_at)}
            {broadcast.completed_at && ` · Completed ${fmtDate(broadcast.completed_at)}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={loadData} className="p-2 rounded border hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Delivery metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Send className="h-4 w-4" />
            Delivery metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total sent", value: broadcast.total_sent.toLocaleString() },
              { label: "Delivery rate", value: pct(broadcast.total_delivered, broadcast.total_sent) },
              { label: "Failed", value: broadcast.total_failed.toLocaleString(), warn: broadcast.total_failed > 0 },
              { label: "Contacts", value: broadcast.total_contacts.toLocaleString() },
            ].map((m) => (
              <div key={m.label} className="space-y-0.5">
                <p className="text-xs text-slate-400">{m.label}</p>
                <p className={`text-2xl font-bold ${m.warn ? "text-rose-600" : "text-slate-900"}`}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Engagement metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Engagement metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Flows opened", value: broadcast.total_opened.toLocaleString() },
              { label: "Open rate", value: pct(broadcast.total_opened, broadcast.total_sent) },
              { label: "Flows completed", value: broadcast.total_completed.toLocaleString() },
              { label: "Completion rate", value: pct(broadcast.total_completed, broadcast.total_sent) },
            ].map((m) => (
              <div key={m.label} className="space-y-0.5">
                <p className="text-xs text-slate-400">{m.label}</p>
                <p className="text-2xl font-bold text-slate-900">{m.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stance metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Stance metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total stances", value: totalStances.toLocaleString() },
              { label: "Attributed", value: attributedCount.toLocaleString() },
              { label: "Anonymous", value: (totalStances - attributedCount).toLocaleString() },
              { label: "Attribution rate", value: pct(attributedCount, totalStances) },
            ].map((m) => (
              <div key={m.label} className="space-y-0.5">
                <p className="text-xs text-slate-400">{m.label}</p>
                <p className="text-2xl font-bold text-slate-900">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Distribution summary */}
          {totalStances > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 font-medium">Stance distribution</p>
              <div className="flex gap-4 text-sm">
                <span className="text-emerald-700">Agree: {pct(agreeCount, totalStances)}</span>
                <span className="text-slate-500">Neutral: {pct(neutralCount, totalStances)}</span>
                <span className="text-rose-600">Disagree: {pct(disagreeCount, totalStances)}</span>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribution} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="score"
                      tickFormatter={(v) => scoreLabels[v as number] ?? String(v)}
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v, n) => [v, n === "count" ? "Total" : n]}
                      labelFormatter={(l) => scoreLabels[Number(l)] ?? String(l)}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {distribution.map((d) => (
                        <Cell key={d.score} fill={barColors[d.score] ?? "#94a3b8"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {totalStances === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-slate-400">
              <MessageSquareDot className="h-6 w-6 opacity-30" />
              <p className="text-xs">No stances recorded from this broadcast yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
