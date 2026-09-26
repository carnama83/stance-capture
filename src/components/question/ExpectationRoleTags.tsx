// src/components/question/ExpectationRoleTags.tsx
// Epic R — M-R10: optional government-office tags on a user's expectations
// (US-R17, US-R18, BR-R10, BR-R11, QA-R21).
//
// Shown inside "Your expectation" once the user holds at least one action-type
// expectation. For each action it offers the offices an admin has confirmed as
// relevant (get_expectation_role_options — verified roles only), plus a search
// of all verified offices, and lets the user pick several, none, or skip. The
// copy is neutral: it records which office the user associates with the
// action; it never tells anyone to contact or pressure an official (BR-R10).
// A named office-holder appears only as secondary text, and only when the
// server returns it (verified, sourced, within its dates — BR-R11).
//
// Writes go through set_my_expectation_role_tags(), one call per action whose
// set changed. Withdrawing an expectation withdraws its tags on the server.

import * as React from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabaseClient";
import { EXPECTATION_LABEL_KEYS } from "@/components/question/ExpectationPrompt";

// Expectations that do not take an office (mirrors set_my_expectation_role_tags).
const NON_ACTION_TYPES = new Set(["no_action", "unsure", "no_accountability_expected"]);

interface RoleOption {
  expectation_type: string;
  government_role_id: string;
  role_name: string;
  authority_name: string;
  current_office_holder_name: string | null;
  is_suggested: boolean;
}

interface SearchResult {
  id: string;
  role_name: string;
  authority_name: string;
  current_office_holder_name: string | null;
}

type Office = { id: string; role_name: string; authority_name: string; holder: string | null };

function useRoleOptions(questionId: string, userId: string, types: string[]) {
  return useQuery<RoleOption[]>({
    queryKey: ["expectation-role-options", userId, questionId, types.join(",")],
    enabled: types.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return [];
      const { data, error } = await sb.rpc("get_expectation_role_options", {
        p_question_id: questionId,
        p_expectation_types: types,
      });
      if (error) throw error;
      return (data ?? []) as RoleOption[];
    },
  });
}

function useMyRoleTags(questionId: string, userId: string) {
  return useQuery<Record<string, string[]>>({
    queryKey: ["my-role-tags", userId, questionId],
    staleTime: 30_000,
    queryFn: async () => {
      const sb = getSupabase();
      if (!sb) return {};
      const { data, error } = await sb
        .from("expectation_role_tags")
        .select("expectation_type, government_role_id")
        .eq("question_id", questionId)
        .is("withdrawn_at", null);
      if (error) throw error;
      const byType: Record<string, string[]> = {};
      for (const r of (data ?? []) as { expectation_type: string; government_role_id: string }[]) {
        (byType[r.expectation_type] ??= []).push(r.government_role_id);
      }
      return byType;
    },
  });
}

function OfficeSearch({ onPick, exclude }: { onPick: (o: Office) => void; exclude: Set<string> }) {
  const { t } = useTranslation();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const sb = getSupabase();
      const { data } = sb
        ? await sb.rpc("search_government_roles", { p_query: term, p_limit: 8 })
        : { data: [] };
      if (!cancelled) {
        setResults((data ?? []) as SearchResult[]);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const shown = results.filter((r) => !exclude.has(r.id));
  return (
    <div className="mt-1.5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("expectationRoles.searchPlaceholder")}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-300"
      />
      {q.trim().length >= 2 && !loading && shown.length === 0 && (
        <p className="text-[10px] text-slate-400 mt-1">{t("expectationRoles.noResults")}</p>
      )}
      {shown.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {shown.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onPick({ id: r.id, role_name: r.role_name, authority_name: r.authority_name, holder: r.current_office_holder_name });
                setQ("");
              }}
              className="block w-full text-left text-[11px] rounded px-1.5 py-1 hover:bg-slate-50 text-slate-700"
            >
              {r.role_name} <span className="text-slate-400">· {r.authority_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExpectationRoleTags({
  questionId,
  userId,
  expectationTypes,
}: {
  questionId: string;
  userId: string;
  expectationTypes: string[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const actionTypes = React.useMemo(
    () => expectationTypes.filter((ty) => !NON_ACTION_TYPES.has(ty)).sort(),
    [expectationTypes]
  );
  const { data: options = [], isSuccess: optionsLoaded } = useRoleOptions(questionId, userId, actionTypes);
  const { data: tags = {}, isSuccess: tagsLoaded } = useMyRoleTags(questionId, userId);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, Set<string>>>({});
  const [extra, setExtra] = React.useState<Record<string, Office>>({});
  const [searchFor, setSearchFor] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (actionTypes.length === 0 || !optionsLoaded || !tagsLoaded) return null;

  const officeById = new Map<string, Office>();
  for (const o of options) {
    officeById.set(o.government_role_id, {
      id: o.government_role_id,
      role_name: o.role_name,
      authority_name: o.authority_name,
      holder: o.current_office_holder_name,
    });
  }
  for (const o of Object.values(extra)) officeById.set(o.id, o);

  const suggestedFor = (type: string) =>
    options.filter((o) => o.expectation_type === type && o.is_suggested).map((o) => o.government_role_id);
  const label = (type: string) => (EXPECTATION_LABEL_KEYS[type] ? t(EXPECTATION_LABEL_KEYS[type]) : type);
  const hasAnyTag = actionTypes.some((ty) => (tags[ty] ?? []).length > 0);
  const hasAnySuggestion = actionTypes.some((ty) => suggestedFor(ty).length > 0);

  function startEdit() {
    const next: Record<string, Set<string>> = {};
    for (const ty of actionTypes) next[ty] = new Set(tags[ty] ?? []);
    setDraft(next);
    setError(null);
    setSearchFor(null);
    setEditing(true);
  }

  function toggle(type: string, roleId: string) {
    setDraft((prev) => {
      const set = new Set(prev[type] ?? []);
      if (set.has(roleId)) set.delete(roleId);
      else set.add(roleId);
      return { ...prev, [type]: set };
    });
  }

  async function save() {
    const sb = getSupabase();
    if (!sb) return;
    setSaving(true);
    setError(null);
    try {
      for (const ty of actionTypes) {
        const before = new Set(tags[ty] ?? []);
        const after = draft[ty] ?? new Set<string>();
        const same = before.size === after.size && [...after].every((id) => before.has(id));
        if (same) continue;
        const { error: rpcErr } = await sb.rpc("set_my_expectation_role_tags", {
          p_question_id: questionId,
          p_expectation_type: ty,
          p_role_ids: [...after],
        });
        if (rpcErr) throw rpcErr;
      }
      await qc.invalidateQueries({ queryKey: ["my-role-tags", userId, questionId] });
      await qc.invalidateQueries({ queryKey: ["expectation-role-options", userId, questionId] });
      qc.invalidateQueries({ queryKey: ["expectation-role-signal", questionId] });
      setEditing(false);
    } catch (err) {
      console.error("[ExpectationRoleTags] save failed", err);
      setError(t("expectationRoles.couldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  const officeLine = (o: Office | undefined, id: string) => (
    <>
      {o?.role_name ?? id.slice(0, 8)}
      {o?.authority_name && <span className="text-slate-400"> · {o.authority_name}</span>}
      {o?.holder && (
        <span className="text-slate-400"> · {t("expectationRoles.currentlyHeldBy", { name: o.holder })}</span>
      )}
    </>
  );

  // Collapsed: nothing to offer and nothing tagged → a single quiet link.
  if (!editing && !hasAnyTag && !hasAnySuggestion) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className="mt-2 text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2"
      >
        {t("expectationRoles.addOffice")}
      </button>
    );
  }

  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-600">{t("expectationRoles.title")}</p>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="text-[11px] font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2"
          >
            {hasAnyTag ? t("expectationRoles.change") : t("expectationRoles.choose")}
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-400 mb-1.5">{t("expectationRoles.suggestedBasis")}</p>

      {!editing ? (
        <div className="space-y-1">
          {actionTypes.map((ty) => {
            const ids = tags[ty] ?? [];
            if (ids.length === 0) return null;
            return (
              <div key={ty} className="text-[11px] text-slate-600">
                <span className="text-slate-400">{label(ty)}: </span>
                {ids.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    {officeLine(officeById.get(id), id)}
                  </span>
                ))}
              </div>
            );
          })}
          {!hasAnyTag && <p className="text-[11px] text-slate-400">{t("expectationRoles.noneTagged")}</p>}
        </div>
      ) : (
        <div className="space-y-2.5">
          {actionTypes.map((ty) => {
            const chosen = draft[ty] ?? new Set<string>();
            const ids = Array.from(new Set([...suggestedFor(ty), ...chosen]));
            return (
              <div key={ty}>
                <p className="text-[11px] text-slate-500 mb-1">{t("expectationRoles.forAction", { action: label(ty) })}</p>
                {ids.length === 0 && (
                  <p className="text-[10px] text-slate-400 mb-1">{t("expectationRoles.noSuggestions")}</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {ids.map((id) => {
                    const on = chosen.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(ty, id)}
                        disabled={saving}
                        className={[
                          "text-[11px] rounded-full border px-2 py-0.5 text-left",
                          on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-slate-400",
                        ].join(" ")}
                      >
                        {officeById.get(id)?.role_name ?? id.slice(0, 8)}
                        {officeById.get(id)?.holder && (
                          <span className={on ? "text-slate-300" : "text-slate-400"}>
                            {" "}· {t("expectationRoles.currentlyHeldBy", { name: officeById.get(id)!.holder })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {searchFor === ty ? (
                  <OfficeSearch
                    exclude={new Set(ids)}
                    onPick={(o) => {
                      setExtra((prev) => ({ ...prev, [o.id]: o }));
                      setDraft((prev) => ({ ...prev, [ty]: new Set([...(prev[ty] ?? []), o.id]) }));
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchFor(ty)}
                    className="mt-1 text-[10px] text-slate-500 hover:text-slate-700 underline underline-offset-2"
                  >
                    {t("expectationRoles.searchOffices")}
                  </button>
                )}
              </div>
            );
          })}
          <p className="text-[10px] text-slate-400">{t("expectationRoles.notAMessage")}</p>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
            >
              {t("expectationRoles.skip")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-xs font-medium rounded-lg px-3 py-1.5 bg-slate-900 text-white disabled:opacity-30 hover:bg-slate-800 transition-colors"
            >
              {saving ? t("stance.saving") : t("expectationRoles.save")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-600 mt-1.5">{error}</p>}
    </div>
  );
}
