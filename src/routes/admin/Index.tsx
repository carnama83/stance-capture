// src/routes/admin/prompts/Index.tsx
// Epic J2 — LLM Prompt Editor
//
// Lets admins view, edit, and version-control the AI prompts used by the
// generate pipeline. Only one prompt per prompt_key can be active at a time.
// Changes take effect on the next generate run — no redeployment needed.

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, CheckCircle2, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type AiPrompt = {
  id: string;
  prompt_key: string;
  version: number;
  label: string;
  description: string | null;
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  created_at: string;
  notes: string | null;
};

const PROMPT_KEY_LABELS: Record<string, string> = {
  question_generation:    "Question Generation",
  parent_classification:  "Parent Topic Classification",
};

const MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];

// ─── Prompt Editor Form ───────────────────────────────────────────────────────

function PromptForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: Partial<AiPrompt>;
  onSave: (data: Partial<AiPrompt>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = React.useState<Partial<AiPrompt>>({
    prompt_key:            initial.prompt_key ?? "question_generation",
    label:                 initial.label ?? "",
    description:           initial.description ?? "",
    system_prompt:         initial.system_prompt ?? "",
    user_prompt_template:  initial.user_prompt_template ?? "",
    model:                 initial.model ?? "gpt-4o-mini",
    temperature:           initial.temperature ?? 0.7,
    max_tokens:            initial.max_tokens ?? 800,
    notes:                 initial.notes ?? "",
  });

  const field = (key: keyof AiPrompt) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const numField = (key: keyof AiPrompt) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  return (
    <div className="space-y-4">
      {/* Key + Label */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Prompt key</label>
          <select
            value={form.prompt_key}
            onChange={field("prompt_key")}
            disabled={!!initial.id}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white disabled:bg-slate-50"
          >
            {Object.entries(PROMPT_KEY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Label</label>
          <input
            type="text"
            value={form.label}
            onChange={field("label")}
            placeholder="e.g. Question Generation v2"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
        <input
          type="text"
          value={form.description ?? ""}
          onChange={field("description")}
          placeholder="What does this prompt do?"
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      {/* System prompt */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          System prompt
          <span className="ml-2 text-slate-400 font-normal">Sent as the system role message</span>
        </label>
        <textarea
          value={form.system_prompt}
          onChange={field("system_prompt")}
          rows={5}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono resize-y"
          placeholder="You are an editorial AI..."
        />
      </div>

      {/* User prompt template */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">
          User prompt template
          <span className="ml-2 text-slate-400 font-normal">
            Variables: {"{{title}}"}, {"{{summary}}"}, {"{{tags}}"}, {"{{location}}"}, {"{{topics}}"}
          </span>
        </label>
        <textarea
          value={form.user_prompt_template}
          onChange={field("user_prompt_template")}
          rows={10}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono resize-y"
          placeholder="Generate a question from this article..."
        />
      </div>

      {/* Model + params */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Model</label>
          <select
            value={form.model}
            onChange={field("model")}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Temperature</label>
          <input
            type="number"
            min={0} max={2} step={0.1}
            value={form.temperature}
            onChange={numField("temperature")}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Max tokens</label>
          <input
            type="number"
            min={100} max={4000} step={100}
            value={form.max_tokens}
            onChange={numField("max_tokens")}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs font-medium text-slate-600 block mb-1">Changelog notes (optional)</label>
        <input
          type="text"
          value={form.notes ?? ""}
          onChange={field("notes")}
          placeholder="What changed in this version?"
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          onClick={() => onSave(form)}
          disabled={isSaving || !form.label || !form.system_prompt || !form.user_prompt_template}
          className="text-xs"
          size="sm"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Save prompt
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Prompt Row ───────────────────────────────────────────────────────────────

function PromptRow({
  prompt,
  onActivate,
  onDuplicate,
  onEdit,
}: {
  prompt: AiPrompt;
  onActivate: (id: string) => void;
  onDuplicate: (p: AiPrompt) => void;
  onEdit: (p: AiPrompt) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={`rounded-lg border ${prompt.is_active ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-900">{prompt.label}</span>
              <Badge variant="secondary" className="text-[10px] px-1.5">
                v{prompt.version}
              </Badge>
              {prompt.is_active && (
                <Badge className="text-[10px] px-1.5 bg-emerald-600 text-white">Active</Badge>
              )}
            </div>
            {prompt.description && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{prompt.description}</p>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-slate-400 hidden sm:block">{prompt.model}</span>
          {!prompt.is_active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onActivate(prompt.id)}
              className="text-xs h-7 px-2"
              title="Set as active"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDuplicate(prompt)}
            className="text-xs h-7 px-2"
            title="Duplicate as new version"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEdit(prompt)}
            className="text-xs h-7 px-2"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">System prompt</p>
            <pre className="text-xs text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-wrap leading-relaxed font-mono overflow-x-auto">
              {prompt.system_prompt}
            </pre>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-1">User prompt template</p>
            <pre className="text-xs text-slate-700 bg-slate-50 rounded p-3 whitespace-pre-wrap leading-relaxed font-mono overflow-x-auto">
              {prompt.user_prompt_template}
            </pre>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span>temp: {prompt.temperature}</span>
            <span>max_tokens: {prompt.max_tokens}</span>
            {prompt.notes && <span>📝 {prompt.notes}</span>}
            <span>{new Date(prompt.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPromptsPage() {
  const [prompts, setPrompts]     = React.useState<AiPrompt[]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [editTarget, setEditTarget] = React.useState<Partial<AiPrompt> | null>(null);
  const [isSaving, setIsSaving]   = React.useState(false);
  const { toast } = useToast();

  const sb = React.useMemo(() => getSupabase(), []);

  async function load() {
    if (!sb) return;
    setLoading(true);
    const { data, error } = await sb
      .from("ai_prompts")
      .select("*")
      .order("prompt_key")
      .order("version", { ascending: false });

    if (error) {
      toast({ title: "Failed to load prompts", description: error.message, variant: "destructive" });
    } else {
      setPrompts((data ?? []) as AiPrompt[]);
    }
    setLoading(false);
  }

  React.useEffect(() => { load(); }, []);

  async function handleSave(form: Partial<AiPrompt>) {
    if (!sb) return;
    setIsSaving(true);

    try {
      if (editTarget?.id) {
        // Update existing
        const { error } = await sb
          .from("ai_prompts")
          .update({
            label:                form.label,
            description:          form.description,
            system_prompt:        form.system_prompt,
            user_prompt_template: form.user_prompt_template,
            model:                form.model,
            temperature:          form.temperature,
            max_tokens:           form.max_tokens,
            notes:                form.notes,
            updated_at:           new Date().toISOString(),
          })
          .eq("id", editTarget.id);

        if (error) throw error;
        toast({ title: "Prompt updated" });
      } else {
        // Insert new
        // Calculate next version for this key
        const existing = prompts.filter((p) => p.prompt_key === form.prompt_key);
        const nextVersion = existing.length > 0 ? Math.max(...existing.map((p) => p.version)) + 1 : 1;

        const { error } = await sb.from("ai_prompts").insert({
          ...form,
          version:   nextVersion,
          is_active: false,
        });

        if (error) throw error;
        toast({ title: "Prompt saved", description: "Set it as active when ready to use." });
      }

      setEditTarget(null);
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivate(id: string) {
    if (!sb) return;
    const prompt = prompts.find((p) => p.id === id);
    if (!prompt) return;

    // Deactivate all other prompts for this key, then activate this one
    const { error: deactivateErr } = await sb
      .from("ai_prompts")
      .update({ is_active: false })
      .eq("prompt_key", prompt.prompt_key)
      .neq("id", id);

    if (deactivateErr) {
      toast({ title: "Failed to deactivate", description: deactivateErr.message, variant: "destructive" });
      return;
    }

    const { error } = await sb.from("ai_prompts").update({ is_active: true }).eq("id", id);
    if (error) {
      toast({ title: "Failed to activate", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Prompt activated", description: "Next generate run will use this prompt." });
      await load();
    }
  }

  function handleDuplicate(p: AiPrompt) {
    setEditTarget({
      prompt_key:           p.prompt_key,
      label:                `${p.label} (copy)`,
      description:          p.description ?? "",
      system_prompt:        p.system_prompt,
      user_prompt_template: p.user_prompt_template,
      model:                p.model,
      temperature:          p.temperature,
      max_tokens:           p.max_tokens,
      notes:                "",
    });
  }

  // Group by prompt_key
  const grouped = React.useMemo(() => {
    const map = new Map<string, AiPrompt[]>();
    for (const p of prompts) {
      if (!map.has(p.prompt_key)) map.set(p.prompt_key, []);
      map.get(p.prompt_key)!.push(p);
    }
    return map;
  }, [prompts]);

  return (
    <div className="max-w-4xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">LLM Prompts</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Edit prompts used by the generate pipeline. Changes take effect on the next run.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="text-xs"
          onClick={() => setEditTarget({})}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New prompt
        </Button>
      </div>

      {/* Editor */}
      {editTarget !== null && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-medium text-slate-900 mb-4">
            {editTarget.id ? "Edit prompt" : "New prompt"}
          </p>
          <PromptForm
            initial={editTarget}
            onSave={handleSave}
            onCancel={() => setEditTarget(null)}
            isSaving={isSaving}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prompts…
        </div>
      )}

      {/* Prompt groups */}
      {!loading && (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([key, keyPrompts]) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                  {PROMPT_KEY_LABELS[key] ?? key}
                </h2>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400">{keyPrompts.length} version{keyPrompts.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-2">
                {keyPrompts.map((p) => (
                  <PromptRow
                    key={p.id}
                    prompt={p}
                    onActivate={handleActivate}
                    onDuplicate={handleDuplicate}
                    onEdit={(p) => setEditTarget(p)}
                  />
                ))}
              </div>
            </div>
          ))}

          {grouped.size === 0 && !editTarget && (
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-5 py-10 text-center">
              <p className="text-sm font-medium text-slate-900 mb-1">No prompts yet</p>
              <p className="text-xs text-slate-500 mb-4">
                Run the migration to seed the default prompts, or create one manually.
              </p>
              <Button type="button" size="sm" className="text-xs" onClick={() => setEditTarget({})}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Create first prompt
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
