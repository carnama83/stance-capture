// src/components/RationaleEditor.tsx
// E2: Inline rationale + links editor on a stance card.

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { Pencil, Check, X, Link as LinkIcon, Plus, Trash2 } from "lucide-react";

interface StanceText {
  rationale: string | null;
  links: string[];
}

interface RationaleEditorProps {
  questionId: string;
}

export function RationaleEditor({ questionId }: RationaleEditorProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftLinks, setDraftLinks] = React.useState<string[]>([]);
  const [newLink, setNewLink] = React.useState("");

  const { data } = useQuery<StanceText | null>({
    queryKey: ["stance-text", questionId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return null;
      const { data, error } = await sb
        .from("stance_texts")
        .select("rationale, links")
        .eq("question_id", questionId)
        .maybeSingle();
      if (error) throw error;
      return data as StanceText | null;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ rationale, links }: { rationale: string; links: string[] }) => {
      const sb = getSupabase();
      if (!sb) throw new Error("Supabase not available");
      const { data, error } = await sb.rpc("upsert_stance_text", {
        p_question_id: questionId,
        p_rationale: rationale || null,
        p_links: links,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stance-text", questionId] });
      setEditing(false);
    },
  });

  const startEdit = () => {
    setDraft(data?.rationale ?? "");
    setDraftLinks(data?.links ?? []);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setNewLink("");
  };

  const save = () => {
    mutation.mutate({ rationale: draft.trim(), links: draftLinks });
  };

  const addLink = () => {
    const trimmed = newLink.trim();
    if (!trimmed || draftLinks.includes(trimmed)) return;
    setDraftLinks((prev) => [...prev, trimmed]);
    setNewLink("");
  };

  const removeLink = (link: string) => {
    setDraftLinks((prev) => prev.filter((l) => l !== link));
  };

  const hasContent = data?.rationale || (data?.links && data.links.length > 0);

  if (!editing) {
    return (
      <div className="mt-2">
        {hasContent ? (
          <div className="space-y-1">
            {data?.rationale && (
              <p className="text-xs text-slate-600 italic">"{data.rationale}"</p>
            )}
            {data?.links && data.links.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.links.map((link) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
                  >
                    <LinkIcon className="h-2.5 w-2.5" />
                    {(() => {
                      try { return new URL(link).hostname; } catch { return link.slice(0, 30); }
                    })()}
                  </a>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Pencil className="h-2.5 w-2.5" />
              Edit rationale
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            <Pencil className="h-2.5 w-2.5" />
            Add rationale
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Why do you hold this stance? (optional)"
        rows={2}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
      />

      {/* Links */}
      <div className="space-y-1">
        {draftLinks.map((link) => (
          <div key={link} className="flex items-center gap-1.5 text-[10px] text-slate-600">
            <LinkIcon className="h-2.5 w-2.5 shrink-0 text-slate-400" />
            <span className="flex-1 truncate">{link}</span>
            <button type="button" onClick={() => removeLink(link)} className="text-slate-400 hover:text-red-500">
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="url"
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
            placeholder="Add a supporting link…"
            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            type="button"
            onClick={addLink}
            disabled={!newLink.trim()}
            className="text-slate-400 hover:text-blue-500 disabled:opacity-40 transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={mutation.isPending}
          className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Check className="h-2.5 w-2.5" />
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="h-2.5 w-2.5" />
          Cancel
        </button>
        {mutation.isError && (
          <span className="text-[10px] text-red-500">Failed to save.</span>
        )}
      </div>
    </div>
  );
}
