// src/pages/PublisherPage.tsx
// Epic T — T4: Publisher Landing & Registration
// Explains the embed program and provides a self-serve registration form.

import * as React from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/PageLayout";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Code2, BarChart3, Users, Zap, CheckCircle2, Loader2 } from "lucide-react";

// ─── Embed code previewer ─────────────────────────────────────────────────────

function EmbedCodePreview({ questionId }: { questionId: string }) {
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
        <span className="text-xs text-slate-400 font-mono">HTML snippet</span>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          {copied ? "Copied ✓" : "Copy"}
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
      toast({ title: "Registration failed", description: error.message, variant: "destructive" });
      return;
    }

    setDone(true);
    toast({ title: "Application submitted! We'll be in touch within 1 business day." });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
        <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
        <h3 className="text-base font-semibold text-emerald-900">Application received</h3>
        <p className="text-sm text-emerald-700">
          We'll review your application and send your publisher credentials to {email} within 1 business day.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Apply to embed Stance Capture</h3>
        <p className="text-xs text-slate-500 mt-1">Free for all publishers. We'll review and approve within 1 business day.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Publication name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Daily Civic"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Your domain</label>
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
          <label className="block text-xs font-medium text-slate-700 mb-1">Contact email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="editor@yourdomain.com"
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
        {submitting ? "Submitting…" : "Apply for embed access"}
      </button>

      <p className="text-[11px] text-slate-400 text-center">
        By applying you agree to Stance Capture's{" "}
        <a href="/terms" className="underline">embed terms</a>.
        Data collected via embeds is subject to our{" "}
        <a href="/privacy" className="underline">privacy policy</a>.
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const SAMPLE_QUESTION_ID = "00000000-0000-0000-0000-000000000000"; // Placeholder

export default function PublisherPage() {
  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-16">

        {/* Hero */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium">
            <Zap className="h-3.5 w-3.5" />
            Publisher Embed Program
          </div>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight">
            Give your readers a voice.<br />
            <span className="text-blue-600">In your article.</span>
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Embed civic stance questions directly into your coverage. Readers answer without leaving your page.
            Their responses become part of a growing community intelligence dataset.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <a
              href="#register"
              className="px-5 py-2.5 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors"
            >
              Apply for free access
            </a>
            <a
              href="#how-it-works"
              className="px-5 py-2.5 rounded-lg border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Features */}
        <div id="how-it-works" className="space-y-6">
          <h2 className="text-xl font-bold text-slate-900 text-center">Why publishers use Stance Capture</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Code2 className="h-5 w-5" />}
              title="Two lines of code"
              description="Drop a div and a script tag. The widget auto-injects, auto-resizes, and works on any site — WordPress, Ghost, custom HTML."
            />
            <FeatureCard
              icon={<Users className="h-5 w-5" />}
              title="No signup required"
              description="Readers answer instantly — no friction, no registration wall. Anonymous responses are still structured and deduplicated."
            />
            <FeatureCard
              icon={<BarChart3 className="h-5 w-5" />}
              title="Real-time community bar"
              description="After answering, readers see the live community stance distribution. Drives engagement and return visits."
            />
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Structured civic data"
              description="Every response is a structured stance on a specific question — not a tweet, not a comment. Real signal, not noise."
            />
          </div>
        </div>

        {/* Code example */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">As simple as it gets</h2>
          <p className="text-sm text-slate-500">
            Paste this into any article page. The widget finds the question, renders the slider, and handles everything else.
          </p>
          <EmbedCodePreview questionId={SAMPLE_QUESTION_ID} />
          <p className="text-xs text-slate-400">
            Replace the question ID with any active Stance Capture question. Browse questions at{" "}
            <a href="/#/topics" className="underline text-blue-500">stancecapture.com/topics</a>.
          </p>
        </div>

        {/* Registration */}
        <div id="register" className="max-w-lg mx-auto">
          <RegistrationForm />
        </div>

      </div>
    </PageLayout>
  );
}
