// src/pages/PublisherPage.tsx
// Epic T — T4: Publisher Landing & Registration
// UPDATED: Added PublisherStats section — approved publishers see their
// embed performance (impressions, submissions, conversion rate) after login.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/PageLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Code2, BarChart3, Users, Zap, CheckCircle2, Loader2, TrendingUp, Eye, Send, MousePointerClick } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";

// ─── Embed code previewer ─────────────────────────────────────────────────────

function EmbedCodePreview({ questionId }: { questionId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const baseUrl = window.location.origin;
  const snippet = `<div data-sc-question="${questionId}" data-sc-theme="light"></div>\n<script src="${baseUrl}/embed.js" async></script>`;

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700">
        <span className="text-xs text-slate-400 font-mono">{t("publisher.htmlSnippet")}</span>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied ? t("publisher.copied") : t("publisher.copy")}
        </button>
      </div>
      <pre className="p-4 text-xs text-emerald-400 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
        {snippet}
      </pre>
    </div>
  );
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
      <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Registration form ────────────────────────────────────────────────────────

function RegistrationForm() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [domain, setDomain] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim() || !email.trim()) return;
    setSubmitting(true);

    // Generate a publisher_ref from domain
    const ref = domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()
      .slice(0, 40);

    const { error } = await supabase.from("publishers").insert({
      name: name.trim(),
      domains: [domain.trim()],
      contact_email: email.trim(),
      publisher_ref: ref + "_" + Date.now().toString(36),
      status: "pending",
    });

    setSubmitting(false);

    if (error) {
      toast({ title: t("publisher.registrationFailed"), description: error.message, variant: "destructive" });
      return;
    }

    setDone(true);
    toast({ title: t("publisher.applicationSubmittedWeLlBe") });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
        <h3 className="text-base font-semibold text-emerald-900">{t("publisher.applicationReceived")}</h3>
        <p className="text-sm text-emerald-700">
          {t("publisher.reviewNotice", { email })}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{t("publisher.applyToEmbedStanceCapture")}</h3>
        <p className="text-xs text-slate-500 mt-1">{t("publisher.freeForAllPublishersWe")}</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">{t("publisher.publicationName")}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("publisher.theDailyCivic")}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">{t("publisher.yourDomain")}</label>
          <input
            type="url"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="https://yourdomain.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">{t("publisher.contactEmail")}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("publisher.editorYourdomainCom")}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !name || !domain || !email}
        className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? t("comments.submitting") : t("publisher.applyForEmbedAccess")}
      </button>

      <p className="text-[11px] text-slate-400 text-center">
        <Trans
          i18nKey="publisher.legalNotice"
          components={{
            terms: <a href="/terms" className="underline" />,
            privacy: <a href="/privacy" className="underline" />,
          }}
        />
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── Publisher stats ──────────────────────────────────────────────────────────
// Shown to logged-in users whose publisher application is approved.
// Pulls embed_impressions and embedded_stances filtered by publisher_ref.

type PublisherRecord = {
  id: string;
  name: string;
  publisher_ref: string;
  status: string;
  approved_at: string | null;
};

type QuestionStat = {
  question_id: string;
  question_text: string;
  impressions: number;
  submissions: number;
  rate: number;
};

function usePublisherAccount() {
  return useQuery<PublisherRecord | null>({
    queryKey: ["publisher-account"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("publishers")
        .select("id, name, publisher_ref, status, approved_at")
        .eq("contact_email", user.email!)
        .eq("status", "approved")
        .maybeSingle();
      return (data as PublisherRecord | null) ?? null;
    },
  });
}

function usePublisherStats(publisherRef: string | null) {
  return useQuery<{ total_impressions: number; total_submissions: number; rate: number; by_question: QuestionStat[] }>({
    queryKey: ["publisher-stats", publisherRef],
    staleTime: 5 * 60_000,
    enabled: !!publisherRef,
    queryFn: async () => {
      if (!publisherRef) return { total_impressions: 0, total_submissions: 0, rate: 0, by_question: [] };

      // Fetch impressions and submissions in parallel
      const [impRes, subRes] = await Promise.all([
        supabase
          .from("embed_impressions")
          .select("question_id")
          .eq("publisher_ref", publisherRef),
        supabase
          .from("embedded_stances")
          .select("question_id")
          .eq("publisher_ref", publisherRef),
      ]);

      const impressions = impRes.data ?? [];
      const submissions = subRes.data ?? [];

      const totalImpressions = impressions.length;
      const totalSubmissions = submissions.length;
      const rate = totalImpressions > 0 ? (totalSubmissions / totalImpressions) * 100 : 0;

      // Group by question_id
      const impByQ: Record<string, number> = {};
      for (const r of impressions) {
        impByQ[r.question_id] = (impByQ[r.question_id] ?? 0) + 1;
      }
      const subByQ: Record<string, number> = {};
      for (const r of submissions) {
        subByQ[r.question_id] = (subByQ[r.question_id] ?? 0) + 1;
      }

      const qids = [...new Set([...Object.keys(impByQ), ...Object.keys(subByQ)])];
      if (qids.length === 0) return { total_impressions: totalImpressions, total_submissions: totalSubmissions, rate, by_question: [] };

      // Batch fetch question texts
      const { data: qRows } = await supabase
        .from("questions")
        .select("id, question")
        .in("id", qids);

      const qText: Record<string, string> = {};
      for (const q of qRows ?? []) qText[(q as any).id] = (q as any).question;

      const by_question: QuestionStat[] = qids
        .map(qid => {
          const imp = impByQ[qid] ?? 0;
          const sub = subByQ[qid] ?? 0;
          return { question_id: qid, question_text: qText[qid] ?? qid, impressions: imp, submissions: sub, rate: imp > 0 ? (sub / imp) * 100 : 0 };
        })
        .sort((a, b) => b.impressions - a.impressions);

      return { total_impressions: totalImpressions, total_submissions: totalSubmissions, rate, by_question };
    },
  });
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">{icon}</span>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function PublisherStats() {
  const { t } = useTranslation();
  const { data: publisher, isLoading: pubLoading } = usePublisherAccount();
  const { data: stats, isLoading: statsLoading } = usePublisherStats(publisher?.publisher_ref ?? null);

  if (pubLoading) return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {t("publisher.loadingYourPublisherAccount")}
    </div>
  );

  if (!publisher) return null; // Not an approved publisher — don't show section

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{t("publisher.yourEmbedPerformance")}</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          {t("publisher.statsFor")} <span className="font-medium text-slate-700">{publisher.name}</span> ·{" "}
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{publisher.publisher_ref}</code>
        </p>
      </div>

      {statsLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("publisher.loadingStats")}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard icon={<Eye className="h-4 w-4" />} label={t("publisher.totalImpressions")} value={(stats?.total_impressions ?? 0).toLocaleString()} sub={t("publisher.widgetLoadsAcrossPages")} />
            <StatCard icon={<Send className="h-4 w-4" />} label={t("publisher.stancesCaptured")} value={(stats?.total_submissions ?? 0).toLocaleString()} sub={t("publisher.completedResponses")} />
            <StatCard icon={<MousePointerClick className="h-4 w-4" />} label={t("publisher.conversionRate")} value={`${(stats?.rate ?? 0).toFixed(1)}%`} sub={t("publisher.readersWhoSubmitted")} />
          </div>

          {/* Per-question breakdown */}
          {stats && stats.by_question.length > 0 ? (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                <p className="text-sm font-semibold text-slate-700">{t("publisher.byQuestion")}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {stats.by_question.map(q => (
                  <div key={q.question_id} className="px-4 py-3 flex items-center gap-4">
                    <p className="flex-1 text-sm text-slate-800 line-clamp-1">{q.question_text}</p>
                    <div className="flex items-center gap-6 text-xs text-slate-500 shrink-0">
                      <span><span className="font-medium text-slate-700">{q.impressions.toLocaleString()}</span> {t("publisher.views")}</span>
                      <span><span className="font-medium text-slate-700">{q.submissions.toLocaleString()}</span> {t("proposalDetail.stances")}</span>
                      <span className="w-14 text-right">
                        <span className={`font-medium ${q.rate >= 20 ? "text-emerald-600" : q.rate >= 10 ? "text-amber-600" : "text-slate-500"}`}>
                          {q.rate.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              {t("publisher.noEmbedActivityYetDeploy")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_QUESTION_ID = "00000000-0000-0000-0000-000000000000"; // Placeholder

export default function PublisherPage() {
  const { t } = useTranslation();
  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-16">

        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium">
            <Zap className="h-3.5 w-3.5" />
            {t("publisher.publisherEmbedProgram")}
          </div>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight">
            {t("publisher.giveYourReadersAVoice")}<br />
            <span className="text-blue-600">{t("publisher.inYourArticle")}</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
            {t("publisher.embedCivicStanceQuestionsDirectly")}
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <a
              href="#register"
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors"
            >
              {t("publisher.applyForFreeAccess")}
            </a>
            <a
              href="#how-it-works"
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
            >
              {t("publisher.seeHowItWorks")}
            </a>
          </div>
        </div>

        {/* Features */}
        <div id="how-it-works" className="space-y-6">
          <h2 className="text-xl font-bold text-slate-900 text-center">{t("publisher.whyPublishersUseStanceCapture")}</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Code2 className="h-5 w-5" />}
              title={t("publisher.twoLinesOfCode")}
              description={t("publisher.dropADivAndA")}
            />
            <FeatureCard
              icon={<Users className="h-5 w-5" />}
              title={t("publisher.noSignupRequired")}
              description={t("publisher.readersAnswerInstantlyNoFriction")}
            />
            <FeatureCard
              icon={<BarChart3 className="h-5 w-5" />}
              title={t("publisher.realTimeCommunityBar")}
              description={t("publisher.afterAnsweringReadersSeeThe")}
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title={t("publisher.structuredCivicData")}
              description={t("publisher.everyResponseIsAStructured")}
            />
          </div>
        </div>

        {/* Code example */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">{t("publisher.asSimpleAsItGets")}</h2>
          <p className="text-sm text-slate-500">
            {t("publisher.pasteThisIntoAnyArticle")}
          </p>
          <EmbedCodePreview questionId={SAMPLE_QUESTION_ID} />
          <p className="text-xs text-slate-400">
            <Trans
              i18nKey="publisher.browseQuestions"
              components={{ a: <a href="/#/topics" className="underline text-blue-500" /> }}
            />
          </p>
        </div>

        {/* Registration */}
        <div id="register" className="max-w-lg mx-auto">
          <RegistrationForm />
        </div>

        {/* Publisher analytics — shown to approved publishers who are logged in */}
        <PublisherStats />

      </div>
    </PageLayout>
  );
}
