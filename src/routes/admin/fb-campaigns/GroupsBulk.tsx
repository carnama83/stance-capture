// src/routes/admin/fb-campaigns/GroupsBulk.tsx
// Bulk tools for the city group directory:
//   - Add many groups: paste Facebook group links (one per line, optional name),
//     pick city and Page once, preview new / duplicate / invalid, save.
//   - Bulk edit: set lean, link policy, membership, languages, rules reviewed,
//     verified, enabled or Page on many selected groups at once.
//   - Group status (ready / needs review / awaiting approval / ...) for counts
//     and filters.
//   - One-click "Add to Stance Capture" bookmark: run on a Facebook group page,
//     it opens the portal with that page's address and title only; the portal
//     saves the group to the last-used city and Page.
//
// Nothing here reads Facebook: links are pasted or handed over by the browser
// bookmark from the page the admin is viewing. New groups always arrive as
// "awaiting approval" (Page membership requested, link policy unknown, rules not
// reviewed), so nothing is scheduled to a group nobody has checked.

import * as React from "react";
import { BookmarkPlus } from "lucide-react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";
import { LocationPicker } from "./Groups";
import {
  Group, Identity, Lean, LinkPolicy, Membership, Modal, Field, inputCls, btnPrimary, btnSecondary,
  errMsg, currentUserId, updateRows, LEAN_LABEL, LINK_POLICY_LABEL, MEMBERSHIP_LABEL, LANGS,
} from "./shared";

// ── links ─────────────────────────────────────────────────────────────────────

const GROUP_RE = /^(?:https?:\/\/)?(?:www\.|m\.|web\.|mbasic\.)?facebook\.com\/groups\/([A-Za-z0-9._-]+)/i;

/** https://www.facebook.com/groups/<id-or-slug>, or null when it isn't a group link. */
export function canonicalGroupUrl(raw: string): string | null {
  const m = String(raw || "").trim().match(GROUP_RE);
  if (!m) return null;
  const slug = m[1];
  if (["feed", "discover", "joins", "search", "create"].includes(slug.toLowerCase())) return null;
  return `https://www.facebook.com/groups/${slug}`;
}

/** Comparison key: same shape the database's url_normalized produces for a canonical URL. */
export function groupKey(url: string): string {
  const c = canonicalGroupUrl(url);
  return (c ?? url).replace(/^https?:\/\/(www\.|m\.|web\.)?/i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
}

function nameFromSlug(url: string): string {
  const slug = (canonicalGroupUrl(url) ?? "").split("/").pop() ?? "";
  if (/^\d+$/.test(slug)) return `Facebook group ${slug}`;
  return slug.replace(/[._-]+/g, " ").trim() || "Facebook group";
}

/** "(3) Pune Citizens Forum | Facebook" -> "Pune Citizens Forum" */
export function nameFromTitle(title: string): string {
  return String(title || "").replace(/^\(\d+\+?\)\s*/, "").replace(/\s*[|·-]\s*Facebook\s*$/i, "").trim();
}

export interface PastedRow {
  line: number;
  raw: string;
  url: string | null;
  name: string;
  nameGiven: boolean;
  result: "new" | "duplicate" | "invalid";
  note?: string;
}

/** Each line: a group link plus an optional name, in either order, separated by comma or tab. */
export function parsePasted(text: string, existingKeys: Set<string>): PastedRow[] {
  const seen = new Set<string>();
  const out: PastedRow[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const raw = rawLine.trim();
    if (!raw) return;
    const tokens = raw.split(/[\t,]|\s+(?=https?:\/\/)/).map((t) => t.trim()).filter(Boolean);
    const urlTok = tokens.find((t) => /facebook\.com\//i.test(t)) ?? tokens.find((t) => /^https?:\/\//i.test(t)) ?? "";
    const url = canonicalGroupUrl(urlTok);
    const given = tokens.filter((t) => t !== urlTok).join(", ").trim();
    if (!url) {
      out.push({ line: i + 1, raw, url: null, name: given, nameGiven: !!given, result: "invalid",
        note: urlTok ? "Not a Facebook group link" : "No link found" });
      return;
    }
    const key = groupKey(url);
    const dup = existingKeys.has(key) ? "Already in the directory" : seen.has(key) ? "Repeated in this list" : undefined;
    seen.add(key);
    out.push({ line: i + 1, raw, url, name: given || nameFromSlug(url), nameGiven: !!given,
      result: dup ? "duplicate" : "new", note: dup });
  });
  return out;
}

// ── status ────────────────────────────────────────────────────────────────────

export type GroupStatus = "ready" | "needs_review" | "awaiting" | "not_joined" | "disabled";

export const STATUS_LABEL: Record<GroupStatus, string> = {
  ready: "Ready",
  needs_review: "Needs review",
  awaiting: "Awaiting approval",
  not_joined: "Not joined",
  disabled: "Disabled",
};

export function groupStatus(g: Group): GroupStatus {
  if (!g.enabled) return "disabled";
  if (g.membership_status === "requested") return "awaiting";
  if (g.membership_status !== "member") return "not_joined";
  if (!g.rules_reviewed || g.link_policy === "unknown") return "needs_review";
  return "ready";
}

export function isStale(g: Group): boolean {
  return !g.last_verified_at || Date.now() - new Date(g.last_verified_at).getTime() > 30 * 86400_000;
}

/** What still stops this group from receiving campaign tasks. */
export function missingFor(g: Group): string[] {
  const m: string[] = [];
  if (!g.enabled) m.push("disabled");
  if (g.membership_status === "requested") m.push("Page's membership pending");
  else if (g.membership_status !== "member") m.push("Page not a member");
  if (!g.rules_reviewed) m.push("rules");
  if (g.link_policy === "unknown") m.push("link policy");
  return m;
}

// ── writes ────────────────────────────────────────────────────────────────────

interface NewGroup { name: string; url: string }

/** Inserts groups as "awaiting approval"; existing URLs are skipped by the unique index. */
export async function insertGroups(rows: NewGroup[], locationId: string, identityId: string | null): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => ({
      name: r.name.slice(0, 200), url: r.url, location_id: locationId,
      language_codes: ["en"], lean: "general", link_policy: "unknown", membership_status: "requested",
      rules_reviewed: false, allowed_identity_ids: identityId ? [identityId] : [],
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/social_group_directory?on_conflict=url_normalized`, {
      method: "POST",
      headers: supabaseHeaders(getJwt(), { Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(chunk),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
    added += Array.isArray(body) ? body.length : 0;
  }
  return added;
}

// One-click defaults: the city and Page the last batch went to.
const QA_KEY = "sc_fb_quickadd_v1";
export interface QuickAddPrefs { locationId: string; locationLabel: string; identityId: string | null }
export function readQuickAddPrefs(): QuickAddPrefs | null {
  try { return JSON.parse(localStorage.getItem(QA_KEY) || "null"); } catch { return null; }
}
export function writeQuickAddPrefs(p: QuickAddPrefs) {
  try { localStorage.setItem(QA_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}

// ── Add many groups ───────────────────────────────────────────────────────────

export function BulkAddModal({ groups, identities, onClose, onAdded }: {
  groups: Group[]; identities: Identity[]; onClose: () => void; onAdded: (n: number, skipped: number) => void;
}) {
  const prefs = readQuickAddPrefs();
  const pages = identities.filter((i) => i.active);
  const [text, setText] = React.useState("");
  const [cityId, setCityId] = React.useState<string | null>(prefs?.locationId ?? null);
  const [cityLabel, setCityLabel] = React.useState<string | null>(prefs?.locationLabel ?? null);
  const [identityId, setIdentityId] = React.useState<string>(prefs?.identityId ?? pages[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const existing = React.useMemo(() => new Set(groups.map((g) => groupKey(g.url))), [groups]);
  const rows = React.useMemo(() => parsePasted(text, existing), [text, existing]);
  const fresh = rows.filter((r) => r.result === "new");
  const counts = {
    new: fresh.length,
    duplicate: rows.filter((r) => r.result === "duplicate").length,
    invalid: rows.filter((r) => r.result === "invalid").length,
  };

  async function save() {
    if (!cityId) { setError("Choose the city first."); return; }
    if (!fresh.length) { setError("Paste at least one new group link."); return; }
    setBusy(true); setError(null);
    try {
      const n = await insertGroups(fresh.map((r) => ({ name: r.name, url: r.url! })), cityId, identityId || null);
      writeQuickAddPrefs({ locationId: cityId, locationLabel: cityLabel ?? "", identityId: identityId || null });
      onAdded(n, counts.duplicate + (fresh.length - n));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide title="Add many groups" onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
          {busy ? "Adding…" : `Add ${counts.new} group${counts.new === 1 ? "" : "s"}`}
        </button>
      </>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="City">
          <LocationPicker value={cityId} label={cityLabel} onChange={(id, l) => { setCityId(id); setCityLabel(l); setError(null); }} />
        </Field>
        <Field label="Page that may post">
          <select className={inputCls} value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
            {pages.length === 0 && <option value="">No Page identity yet</option>}
            {pages.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Group links, one per line" hint="Optional: add the group's name after a comma or tab. Links from the Facebook app or browser both work.">
        <textarea className={`${inputCls} font-mono text-xs`} rows={7} value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          placeholder={"https://www.facebook.com/groups/punecitizens, Pune Citizens Forum\nhttps://www.facebook.com/groups/kothrudresidents"} />
      </Field>
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5">{counts.new} new</span>
            {counts.duplicate > 0 && <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">{counts.duplicate} duplicate</span>}
            {counts.invalid > 0 && <span className="rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5">{counts.invalid} not a group link</span>}
          </div>
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-64 overflow-y-auto text-xs">
            {rows.map((r) => (
              <div key={r.line} className="grid grid-cols-[2fr_3fr_1.4fr] gap-2 px-3 py-1.5">
                <span className={r.nameGiven ? "text-slate-800" : "text-slate-400"}>{r.result === "invalid" ? "—" : r.name}</span>
                <span className="text-slate-500 truncate">{r.url ?? r.raw}</span>
                <span className={r.result === "new" ? "text-emerald-700" : r.result === "duplicate" ? "text-amber-700" : "text-red-700"}>
                  {r.result === "new" ? "New" : r.note}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="text-[11px] text-slate-500">
        New groups arrive as "Awaiting approval" (the Page's membership requested), with link policy unknown and rules not
        reviewed. Nothing is scheduled to them until you mark them Member and review them (bulk edit helps). Names taken from
        a link can be corrected later.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </Modal>
  );
}

// ── Bulk edit ─────────────────────────────────────────────────────────────────

type TriState = "" | "yes" | "no";

export function BulkEditModal({ ids, identities, onClose, onDone }: {
  ids: string[]; identities: Identity[]; onClose: () => void; onDone: (n: number) => void;
}) {
  const [lean, setLean] = React.useState<"" | Lean>("");
  const [link, setLink] = React.useState<"" | LinkPolicy>("");
  const [membership, setMembership] = React.useState<"" | Membership>("");
  const [langMode, setLangMode] = React.useState<"" | "set">("");
  const [langs, setLangs] = React.useState<string[]>(["en"]);
  const [rules, setRules] = React.useState<TriState>("");
  const [verified, setVerified] = React.useState(false);
  const [enabled, setEnabled] = React.useState<TriState>("");
  const [page, setPage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const patch: Record<string, unknown> = {};
  if (lean) patch.lean = lean;
  if (link) patch.link_policy = link;
  if (membership) patch.membership_status = membership;
  if (langMode === "set") patch.language_codes = langs;
  if (rules) patch.rules_reviewed = rules === "yes";
  if (enabled) patch.enabled = enabled === "yes";
  if (page) patch.allowed_identity_ids = [page];
  if (verified) { patch.last_verified_at = new Date().toISOString(); patch.last_verified_by = currentUserId(); }
  const changes = Object.keys(patch).length;

  async function apply() {
    if (!changes) { setError("Choose at least one change."); return; }
    if (langMode === "set" && langs.length === 0) { setError("Pick at least one language, or leave languages unchanged."); return; }
    setBusy(true); setError(null);
    try {
      for (let i = 0; i < ids.length; i += 80) {
        await updateRows("social_group_directory", `id=in.(${ids.slice(i, i + 80).join(",")})`, patch);
      }
      onDone(ids.length);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const keep = <option value="">Leave unchanged</option>;
  return (
    <Modal title={`Update ${ids.length} group${ids.length === 1 ? "" : "s"}`} onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={apply}>
          {busy ? "Updating…" : `Update ${ids.length}`}
        </button>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lean">
          <select className={inputCls} value={lean} onChange={(e) => setLean(e.target.value as Lean)}>
            {keep}{(Object.keys(LEAN_LABEL) as Lean[]).map((k) => <option key={k} value={k}>{LEAN_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Link policy">
          <select className={inputCls} value={link} onChange={(e) => setLink(e.target.value as LinkPolicy)}>
            {keep}{(Object.keys(LINK_POLICY_LABEL) as LinkPolicy[]).map((k) => <option key={k} value={k}>{LINK_POLICY_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Page's membership">
          <select className={inputCls} value={membership} onChange={(e) => setMembership(e.target.value as Membership)}>
            {keep}{(Object.keys(MEMBERSHIP_LABEL) as Membership[]).map((k) => <option key={k} value={k}>{MEMBERSHIP_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="Rules reviewed">
          <select className={inputCls} value={rules} onChange={(e) => setRules(e.target.value as TriState)}>
            {keep}<option value="yes">Yes</option><option value="no">No</option>
          </select>
        </Field>
        <Field label="Enabled">
          <select className={inputCls} value={enabled} onChange={(e) => setEnabled(e.target.value as TriState)}>
            {keep}<option value="yes">Enable</option><option value="no">Disable</option>
          </select>
        </Field>
        <Field label="Page that may post">
          <select className={inputCls} value={page} onChange={(e) => setPage(e.target.value)}>
            {keep}{identities.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Languages">
        <div className="flex flex-wrap items-center gap-3">
          <select className={`${inputCls} w-44`} value={langMode} onChange={(e) => setLangMode(e.target.value as "" | "set")}>
            <option value="">Leave unchanged</option><option value="set">Set to</option>
          </select>
          {langMode === "set" && LANGS.map((l) => (
            <label key={l.code} className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={langs.includes(l.code)}
                onChange={() => setLangs(langs.includes(l.code) ? langs.filter((x) => x !== l.code) : [...langs, l.code])} />
              {l.label}
            </label>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        I checked these groups today (sets "last verified")
      </label>
      <p className="text-[11px] text-slate-500">Fields left as "Leave unchanged" keep each group's current value.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </Modal>
  );
}

// ── One-click bookmark ────────────────────────────────────────────────────────

/** The bookmark: reads only the current page's address and title, then opens the portal. */
export function bookmarkletCode(origin: string): string {
  const target = `${origin}/#/admin/fb-campaigns/groups?add=`;
  return "javascript:(()=>{var u=location.href;if(!/facebook\\.com\\/groups\\/[^\\/?#]+/i.test(u)){alert('Open a Facebook group page first, then click Add to Stance Capture.');return;}"
    + `window.open('${target}'+encodeURIComponent(u)+'&name='+encodeURIComponent(document.title),'_blank');})();`;
}

export function BookmarkModal({ identities, onClose }: { identities: Identity[]; onClose: () => void }) {
  const prefs = readQuickAddPrefs();
  const pages = identities.filter((i) => i.active);
  const [cityId, setCityId] = React.useState<string | null>(prefs?.locationId ?? null);
  const [cityLabel, setCityLabel] = React.useState<string | null>(prefs?.locationLabel ?? null);
  const [identityId, setIdentityId] = React.useState<string>(prefs?.identityId ?? pages[0]?.id ?? "");
  const [saved, setSaved] = React.useState(false);
  const linkRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    // React refuses javascript: URLs in JSX, so set it on the element directly.
    linkRef.current?.setAttribute("href", bookmarkletCode(window.location.origin));
  }, []);

  function saveDefaults() {
    if (!cityId) return;
    writeQuickAddPrefs({ locationId: cityId, locationLabel: cityLabel ?? "", identityId: identityId || null });
    setSaved(true);
  }

  return (
    <Modal title="One-click button: Add to Stance Capture" onClose={onClose}
      footer={<button type="button" className={btnSecondary} onClick={onClose}>Done</button>}>
      <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600">
        <li>Show your browser's bookmarks bar (Ctrl+Shift+B in Chrome).</li>
        <li>Drag this button onto the bookmarks bar:</li>
      </ol>
      <div className="flex justify-center py-1">
        <a ref={linkRef} onClick={(e) => e.preventDefault()} draggable
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white cursor-grab">
          <BookmarkPlus className="h-3.5 w-3.5" /> Add to Stance Capture
        </a>
      </div>
      <ol start={3} className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600">
        <li>On Facebook, switched to the Page, open a group and click <span className="font-medium">Join</span>.</li>
        <li>Click <span className="font-medium">Add to Stance Capture</span> in your bookmarks bar. The portal opens and adds the group to the city and Page below, as "Awaiting approval".</li>
      </ol>
      <p className="text-[11px] text-slate-500">
        The button reads only the address and title of the page you are on. It does not read anything else from Facebook.
        It works for this site ({window.location.host}); add it again from each site you use.
      </p>
      <div className="rounded-lg border border-slate-200 p-3 space-y-3">
        <p className="text-xs font-medium text-slate-700">Groups added with the button go to</p>
        <Field label="City">
          <LocationPicker value={cityId} label={cityLabel} onChange={(id, l) => { setCityId(id); setCityLabel(l); setSaved(false); }} />
        </Field>
        <Field label="Page that may post">
          <select className={inputCls} value={identityId} onChange={(e) => { setIdentityId(e.target.value); setSaved(false); }}>
            {pages.length === 0 && <option value="">No Page identity yet</option>}
            {pages.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </Field>
        <div className="flex items-center gap-3">
          <button type="button" className={btnSecondary} disabled={!cityId} onClick={saveDefaults}>Save these defaults</button>
          {saved && <span className="text-xs text-emerald-700">Saved</span>}
        </div>
      </div>
    </Modal>
  );
}

/** Shown when the bookmark arrives without saved defaults: choose city and Page once. */
export function QuickAddModal({ url, name, identities, onClose, onAdd }: {
  url: string; name: string; identities: Identity[]; onClose: () => void;
  onAdd: (name: string, prefs: QuickAddPrefs) => Promise<void>;
}) {
  const pages = identities.filter((i) => i.active);
  const [n, setN] = React.useState(name);
  const [cityId, setCityId] = React.useState<string | null>(null);
  const [cityLabel, setCityLabel] = React.useState<string | null>(null);
  const [identityId, setIdentityId] = React.useState<string>(pages[0]?.id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    if (!cityId) { setError("Choose the city first."); return; }
    if (!n.trim()) { setError("Enter the group's name."); return; }
    setBusy(true); setError(null);
    try {
      await onAdd(n.trim(), { locationId: cityId, locationLabel: cityLabel ?? "", identityId: identityId || null });
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add group" onClose={onClose}
      footer={<>
        <button type="button" className={btnSecondary} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={add}>{busy ? "Adding…" : "Add group"}</button>
      </>}>
      <p className="text-xs text-slate-500 break-all">{url}</p>
      <Field label="Name"><input className={inputCls} value={n} onChange={(e) => { setN(e.target.value); setError(null); }} /></Field>
      <Field label="City" hint="Remembered for the next one-click add.">
        <LocationPicker value={cityId} label={cityLabel} onChange={(id, l) => { setCityId(id); setCityLabel(l); setError(null); }} />
      </Field>
      <Field label="Page that may post">
        <select className={inputCls} value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
          {pages.length === 0 && <option value="">No Page identity yet</option>}
          {pages.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </Field>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </Modal>
  );
}
