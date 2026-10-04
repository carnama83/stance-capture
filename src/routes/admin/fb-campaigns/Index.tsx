// src/routes/admin/fb-campaigns/Index.tsx
// Facebook Campaign Manager (PDD v1.2), Phase 1: campaign list and creation.
// One campaign = one published question + one city, over (default) 7 days.

import * as React from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { useIdentities } from "./Identities";
import { LocationPicker } from "./Groups";
import {
  Campaign, PageHeader, Modal, Field, Pill, Loading, ErrorBox, campaignTone,
  inputCls, btnPrimary, btnSecondary, insertRow, errMsg, fmtDate, LANGS,
} from "./shared";

interface QuestionOption {
  id: string;
  question: string;
  location_label: string | null;
  location: { id: string; name: string; type: string } | null;
  langs: string[];
}

function useCampaigns() {
  return useQuery<Campaign[]>({
    queryKey: ["fb-campaigns"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("social_campaigns").select("*, questions(question), locations(name, type)").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Campaign[];
    },
  });
}

function usePublishedQuestions() {
  return useQuery<QuestionOption[]>({
    queryKey: ["fb-campaign-questions"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("questions")
        .select("id, question, location_label, locations(id, name, type), question_renditions(language_code, lifecycle_status)")
        .eq("status", "active")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((q: any) => ({
        id: q.id,
        question: q.question,
        location_label: q.location_label,
        location: q.locations ?? null,
        langs: Array.from(new Set((q.question_renditions ?? [])
          .filter((r: any) => r.lifecycle_status === "published").map((r: any) => r.language_code))) as string[],
      }));
    },
  });
}

// Best guess at the campaign city: the question's own location when it is a city
// or district, else a city named by the first part of its label ("Pune, India").
// Questions are often tagged with the whole country, so the admin confirms it.
async function guessCity(q: QuestionOption): Promise<{ id: string; label: string } | null> {
  if (q.location && (q.location.type === "city" || q.location.type === "county")) {
    return { id: q.location.id, label: `${q.location.name} (${q.location.type})` };
  }
  const first = (q.location_label ?? "").split(",")[0].trim();
  if (!first) return null;
  const { data } = await (supabase as any).from("locations").select("id, name, type")
    .eq("type", "city").ilike("name", first).limit(1);
  const hit = data?.[0];
  return hit ? { id: hit.id, label: `${hit.name} (${hit.type})` } : null;
}

function tomorrow(): string {
  const d = new Date(Date.now() + 86400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: questions } = usePublishedQuestions();
  const { data: identities } = useIdentities();
  const [questionId, setQuestionId] = React.useState("");
  const [name, setName] = React.useState("");
  const [start, setStart] = React.useState(tomorrow());
  const [days, setDays] = React.useState("7");
  const [slots, setSlots] = React.useState("09:00, 14:00, 19:00");
  const [langs, setLangs] = React.useState<string[]>(["en"]);
  const [includePage, setIncludePage] = React.useState(true);
  const [pageIdentity, setPageIdentity] = React.useState("");
  const [pagePerDay, setPagePerDay] = React.useState("1");
  const [perGroup, setPerGroup] = React.useState("1");
  const [cityId, setCityId] = React.useState<string | null>(null);
  const [cityLabel, setCityLabel] = React.useState<string | null>(null);

  const q = questions?.find((x) => x.id === questionId);
  React.useEffect(() => {
    if (!q) return;
    setLangs((prev) => prev.filter((l) => q.langs.includes(l)).length ? prev.filter((l) => q.langs.includes(l)) : q.langs.slice(0, 1));
    if (!name) setName(`${q.location_label ?? "City"} · ${q.question.slice(0, 40)}`);
    setCityId(null); setCityLabel(null);
    void guessCity(q).then((c) => { if (c) { setCityId(c.id); setCityLabel(c.label); } });
  }, [questionId]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!pageIdentity) {
      const page = identities?.find((i) => i.kind === "page" && i.active);
      if (page) setPageIdentity(page.id);
    }
  }, [identities, pageIdentity]);

  const slotList = slots.split(/[,\s]+/).filter(Boolean);
  const slotsOk = slotList.length >= 1 && slotList.length <= 6 && slotList.every((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
  const windows = slotsOk ? slotList.length * Number(days || 0) : 0;
  const pagePosts = includePage ? Number(pagePerDay || 0) * Number(days || 0) : 0;

  const create = useMutation({
    mutationFn: async () => insertRow<Campaign>("social_campaigns", {
      question_id: questionId, location_id: cityId, name: name.trim(), start_date: start, duration_days: Number(days),
      timezone: "Asia/Kolkata", daily_slots: slotList, language_codes: langs,
      include_page: includePage, page_identity_id: includePage && pageIdentity ? pageIdentity : null,
      page_posts_per_day: Number(pagePerDay), group_posts_per_group: Number(perGroup),
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["fb-campaigns"] });
      navigate(`/admin/fb-campaigns/${c.id}`);
    },
    onError: (e) => toast({ title: "Could not create campaign", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Modal wide title="New Facebook campaign" onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary}
          disabled={!questionId || !cityId || !name.trim() || !slotsOk || langs.length === 0 || create.isPending}
          onClick={() => create.mutate()}>Create draft</button>
      </>}>
      <Field label="Published question" hint="Multi-city questions get one campaign per city, so captions and groups stay local.">
        <select className={inputCls} value={questionId} onChange={(e) => setQuestionId(e.target.value)}>
          <option value="">Choose a question…</option>
          {(questions ?? []).map((x) => (
            <option key={x.id} value={x.id}>{x.location_label ? `[${x.location_label}] ` : ""}{x.question.slice(0, 110)}</option>
          ))}
        </select>
      </Field>
      {questionId && (
        <Field label="Target city" hint="Groups are matched to this city. Questions are often tagged with a whole country, so confirm it.">
          <LocationPicker value={cityId} label={cityLabel} onChange={(id, l) => { setCityId(id); setCityLabel(l); }} />
        </Field>
      )}
      <Field label="Campaign name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Start date (Asia/Kolkata)"><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Days"><input type="number" min={1} max={30} className={inputCls} value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Daily slots" hint={slotsOk ? undefined : "HH:MM, comma separated, 1 to 6."}>
          <input className={inputCls} value={slots} onChange={(e) => setSlots(e.target.value)} />
        </Field>
      </div>
      <Field label="Languages" hint={q ? `Published renditions: ${q.langs.join(", ") || "none"}` : undefined}>
        <div className="flex gap-3">
          {LANGS.map((l) => {
            const available = !q || q.langs.includes(l.code);
            return (
              <label key={l.code} className={`flex items-center gap-1.5 text-xs ${available ? "text-slate-600" : "text-slate-300"}`}>
                <input type="checkbox" disabled={!available} checked={langs.includes(l.code)}
                  onChange={() => setLangs(langs.includes(l.code) ? langs.filter((x) => x !== l.code) : [...langs, l.code])} />
                {l.label}
              </label>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-3 gap-3 items-end">
        <label className="flex items-center gap-2 text-xs text-slate-600 pb-2">
          <input type="checkbox" checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} /> Post on the Page
        </label>
        <Field label="Page identity">
          <select className={inputCls} disabled={!includePage} value={pageIdentity} onChange={(e) => setPageIdentity(e.target.value)}>
            <option value="">—</option>
            {(identities ?? []).filter((i) => i.kind === "page").map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </Field>
        <Field label="Page posts per day" hint="Default 1. Higher values risk reach.">
          <input type="number" min={0} max={6} disabled={!includePage} className={inputCls} value={pagePerDay} onChange={(e) => setPagePerDay(e.target.value)} />
        </Field>
      </div>
      <Field label="Posts per group" hint="Each group's own cap still applies. Suggested: 1 per campaign.">
        <input type="number" min={1} max={7} className={`${inputCls} max-w-[8rem]`} value={perGroup} onChange={(e) => setPerGroup(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2">
        {windows} distribution windows{includePage ? `, ${pagePosts} Page posts` : ""}. Windows are not posts to every destination: group tasks are spread across them within each group's and identity's limits.
      </p>
    </Modal>
  );
}

export default function FbCampaignsPage() {
  const { data, isLoading, isError } = useCampaigns();
  const [showNew, setShowNew] = React.useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facebook campaigns"
        sub="Distribute a published city question through the Page and reviewed city groups. Posting happens by hand on Facebook; this tool prepares neutral content, schedules tasks and measures visits and stances."
        action={<button type="button" className={`${btnPrimary} shrink-0`} onClick={() => setShowNew(true)}><Plus className="h-3.5 w-3.5" /> New campaign</button>}
      />
      {isLoading && <Loading />}
      {isError && <ErrorBox>Failed to load campaigns.</ErrorBox>}
      <div className="space-y-2">
        {(data ?? []).map((c) => (
          <Link key={c.id} to={`/admin/fb-campaigns/${c.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-900">{c.name}</span>
              <Pill tone={campaignTone(c.status)}>{c.status}</Pill>
              <Pill>{c.language_codes.join(", ")}</Pill>
            </div>
            <p className="text-xs text-slate-500 mt-1 line-clamp-1">{c.questions?.question}</p>
            <p className="text-[11px] text-slate-400 mt-1">
              {c.locations?.name ?? "No city set"} · starts {fmtDate(c.start_date)} · {c.duration_days} days · slots {c.daily_slots.map((s) => s.slice(0, 5)).join(", ")}
            </p>
          </Link>
        ))}
        {data && data.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
            No campaigns yet. Register city groups and posting identities first, then create a campaign.
          </div>
        )}
      </div>
      {showNew && <NewCampaignModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
