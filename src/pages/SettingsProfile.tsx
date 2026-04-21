// src/pages/SettingsProfile.tsx
// M-A03: Pass currentPath + currentUrl to AvatarUploader; store avatar_path on profiles.
//        avatar_path column may not exist on older rows — gracefully falls back.
// M-A04: Bio textarea has maxLength={500} and a visible character counter (X/500).
// M-A05: After a successful username change, query username_history to show
//        "X of 2 changes used this month (resets in Y days)".
// M-A06: DOB correction pathway — re-auth via current password, then call
//        a new clear_my_dob RPC (must be deployed) before re-setting DOB.
//        If clear_my_dob is not yet deployed the section shows a support-contact fallback.
// M-A07: show_age toggle — requires profiles.show_age boolean column (see migration below).
//        Renders "Age: X" on public profile if opted in.
//
// MIGRATION REQUIRED (run once in Supabase SQL editor):
//   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS show_age boolean NOT NULL DEFAULT false;
//   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;
//
//   CREATE OR REPLACE FUNCTION public.clear_my_dob()
//   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
//   DECLARE v_uid uuid := auth.uid();
//   BEGIN
//     IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
//     UPDATE public.profiles SET dob_encrypted = NULL, dob_checked = false, updated_at = now()
//     WHERE user_id = v_uid;
//   END $$;
//   COMMENT ON FUNCTION public.clear_my_dob IS 'M-A06: Clears dob_encrypted so profile_set_dob_checked can be called again. Requires re-auth before calling.';

import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import { useQueryClient } from "@tanstack/react-query";
import UsernameField from "../components/UsernameField";
import AvatarUploader from "../components/AvatarUploader";
import { DobField } from "../components/DobField";

type DisplayHandleMode = "random_id" | "username";

const BIO_MAX = 500;

// ── M-A05: Username quota display ──────────────────────────────────────────

interface UsernameQuota {
  used: number;
  limit: number;
  resetsInDays: number | null;
}

async function fetchUsernameQuota(
  sb: ReturnType<typeof getSupabase>,
  userId: string,
): Promise<UsernameQuota> {
  if (!sb) return { used: 0, limit: 2, resetsInDays: null };
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("username_history")
    .select("changed_at")
    .eq("user_id", userId)
    .gte("changed_at", cutoff)
    .order("changed_at", { ascending: true });
  if (error || !data) return { used: 0, limit: 2, resetsInDays: null };

  const used = data.length;
  let resetsInDays: number | null = null;
  if (used > 0 && data[0]?.changed_at) {
    // oldest change within the window determines when window opens back up
    const oldestMs = new Date(data[0].changed_at).getTime();
    const resetMs  = oldestMs + 30 * 86_400_000;
    resetsInDays   = Math.max(1, Math.ceil((resetMs - Date.now()) / 86_400_000));
  }
  return { used, limit: 2, resetsInDays };
}

// ── M-A06: DOB correction section ──────────────────────────────────────────

interface DobCorrectionSectionProps {
  sb: ReturnType<typeof getSupabase>;
  onDobCleared: () => void;
}

function DobCorrectionSection({ sb, onDobCleared }: DobCorrectionSectionProps) {
  const [open, setOpen]         = React.useState(false);
  const [step, setStep]         = React.useState<"reauth" | "set_dob">("reauth");
  const [password, setPassword] = React.useState("");
  const [newDob, setNewDob]     = React.useState("");
  const [err, setErr]           = React.useState("");
  const [busy, setBusy]         = React.useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
        onClick={() => setOpen(true)}
      >
        Correct my date of birth
      </button>
    );
  }

  async function handleReauth() {
    if (!sb || !password) { setErr("Enter your current password."); return; }
    setBusy(true);
    setErr("");
    try {
      const { data: sessionData } = await sb.auth.getSession();
      const email = sessionData.session?.user?.email;
      if (!email) throw new Error("Could not read your email. Please refresh.");
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setStep("set_dob");
    } catch (e: any) {
      setErr(e.message ?? "Re-authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAndSet() {
    if (!sb || !newDob) { setErr("Select a new date of birth."); return; }
    setBusy(true);
    setErr("");
    try {
      // Step 1: clear the existing dob_encrypted via admin-gated RPC
      const { error: clearErr } = await sb.rpc("clear_my_dob");
      if (clearErr) {
        if (clearErr.message?.includes("function") || clearErr.code === "PGRST202") {
          throw new Error(
            "The clear_my_dob function is not yet deployed. " +
            "Please contact support to correct your date of birth.",
          );
        }
        throw clearErr;
      }
      // Step 2: set the new DOB
      const { error: setErr2 } = await sb.rpc("profile_set_dob_checked", { p_dob_text: newDob });
      if (setErr2) throw setErr2;

      onDobCleared();
      setOpen(false);
      setStep("reauth");
      setPassword("");
      setNewDob("");
    } catch (e: any) {
      setErr(e.message ?? "Could not update date of birth.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-4 space-y-3 mt-2">
      <div className="text-sm font-medium">Correct date of birth</div>

      {step === "reauth" && (
        <>
          <p className="text-xs text-slate-500">
            For security, please confirm your current password before changing your date of birth.
          </p>
          <input
            type="password"
            placeholder="Current password"
            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 border rounded px-3 py-1.5 text-sm"
              onClick={() => { setOpen(false); setErr(""); setPassword(""); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex-1 rounded bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={handleReauth}
              disabled={busy || !password}
            >
              {busy ? "Verifying…" : "Confirm identity"}
            </button>
          </div>
        </>
      )}

      {step === "set_dob" && (
        <>
          <p className="text-xs text-slate-500">Identity confirmed. Select your correct date of birth.</p>
          <DobField value={newDob} setValue={setNewDob} />
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 border rounded px-3 py-1.5 text-sm"
              onClick={() => { setStep("reauth"); setErr(""); }}
            >
              Back
            </button>
            <button
              type="button"
              className="flex-1 rounded bg-slate-900 text-white px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={handleClearAndSet}
              disabled={busy || !newDob}
            >
              {busy ? "Saving…" : "Save new date of birth"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function SettingsProfile() {
  const sb = React.useMemo(getSupabase, []);
  const queryClient = useQueryClient();

  const [uid, setUid]               = React.useState<string>("");
  const [randomId, setRandomId]     = React.useState<string>("");
  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);
  const [initialUsername, setInitialUsername] = React.useState<string>("");
  const [msg, setMsg]               = React.useState<string | null>(null);
  const [busy, setBusy]             = React.useState(false);
  const [lastUsernameError, setLastUsernameError] = React.useState<any>(null);

  // M-A05
  const [usernameQuota, setUsernameQuota] = React.useState<UsernameQuota | null>(null);

  // M-A06
  const [dobSet, setDobSet]         = React.useState(false);

  const [form, setForm] = React.useState({
    username: "",
    display_handle_mode: "random_id" as DisplayHandleMode,
    bio: "",
    avatar_url: "",
    // M-A03: store path alongside URL
    avatar_path: "" as string | null,
    // M-A07: age opt-in
    show_age: false,
  });

  const [handle, setHandle] = React.useState<string>("");

  // ── Session listener ──
  React.useEffect(() => {
    if (!sb) return;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const sess = await sb.auth.getSession();
        setSessionUserId(sess.data.session?.user?.id ?? null);
        const sub = sb.auth.onAuthStateChange((_evt, s) => setSessionUserId(s?.user?.id ?? null));
        unsub = sub?.data?.subscription?.unsubscribe;
      } catch {
        setSessionUserId(null);
      }
    })();
    return () => unsub?.();
  }, [sb]);

  // ── Load profile ──
  React.useEffect(() => {
    (async () => {
      if (!sb) return setMsg("Supabase is OFF (check env).");
      if (!sessionUserId) { setUid(""); setMsg("Please log in."); return; }
      try {
        setMsg(null);
        setUid(sessionUserId);
        const { data, error } = await sb
          .from("profiles")
          .select("*")
          .eq("user_id", sessionUserId)
          .maybeSingle();
        if (error) throw error;

        const username             = data?.username || "";
        const mode: DisplayHandleMode = (data?.display_handle_mode as DisplayHandleMode) || "random_id";
        const bio                  = data?.bio || "";
        const avatar_url           = data?.avatar_url || "";
        const avatar_path          = (data as any)?.avatar_path ?? null;
        const show_age             = (data as any)?.show_age ?? false;
        const rid                  = data?.random_id || "";
        const dob_encrypted        = data?.dob_encrypted;

        setRandomId(rid);
        setDobSet(!!dob_encrypted);
        setForm({ username, display_handle_mode: mode, bio, avatar_url, avatar_path, show_age });
        setInitialUsername(username);
        setHandle(mode === "username" ? (username || rid) : rid);
      } catch (e: any) {
        setMsg(e.message || "Failed to load profile");
      }
    })();
  }, [sb, sessionUserId]);

  // ── Save bio / avatar / show_age ──
  async function saveProfile() {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    try {
      setBusy(true);
      const update: Record<string, any> = {
        bio: form.bio || null,
        avatar_url: form.avatar_url || null,
        show_age: form.show_age,
      };
      // M-A03: persist avatar_path when present
      if (form.avatar_path !== undefined) {
        update.avatar_path = form.avatar_path || null;
      }
      const { error } = await sb.from("profiles").update(update).eq("user_id", uid);
      if (error) throw error;
      setMsg("Profile saved.");
    } catch (e: any) {
      setMsg(e.message || "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  // ── Update username ──
  async function updateUsername() {
    if (busy) return;
    setMsg(null);
    setLastUsernameError(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    const desired = (form.username || "").trim().toLowerCase();
    const current = (initialUsername || "").trim().toLowerCase();
    if (!desired) { setMsg("Enter a username first."); return; }
    if (desired === current) { setMsg("That's already your current username."); return; }
    try {
      setBusy(true);
      const res = await sb.rpc("set_username", { p_username: desired });
      if (res.error) {
        setLastUsernameError({ code: res.error.code, message: res.error.message });
        const raw = String(res.error.message || "").trim();
        if (raw.startsWith("ERR_USERNAME_LIMIT")) {
          setMsg("You've hit the username change limit (30 days). Try again later.");
        } else if (raw.toLowerCase().includes("reserved")) {
          setMsg("That username is reserved. Please choose another.");
        } else if (raw.toLowerCase().includes("taken") || res.error.code === "23505") {
          setMsg("That username is already taken.");
        } else if (raw.toLowerCase().includes("invalid username")) {
          setMsg("Invalid username. Use 3–20 characters: a–z, 0–9, underscore.");
        } else if (raw.toLowerCase().includes("not authenticated")) {
          setMsg("Session not detected. Please refresh and try again.");
        } else {
          setMsg(`Username update failed: ${raw}`);
        }
        return;
      }
      setForm(f => ({ ...f, username: desired }));
      setInitialUsername(desired);
      setMsg("Username updated.");
      queryClient.invalidateQueries({ queryKey: ["profile", uid] });
      if (form.display_handle_mode === "username") setHandle(desired || randomId);

      // M-A05: refresh quota display
      const quota = await fetchUsernameQuota(sb, uid);
      setUsernameQuota(quota);
    } catch (e: any) {
      setLastUsernameError({ message: e?.message ?? String(e) });
      setMsg(`Username update failed: ${e?.message ?? "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  // Trigger M-A05 quota load on initial mount once uid is known
  React.useEffect(() => {
    if (!sb || !uid) return;
    fetchUsernameQuota(sb, uid).then(setUsernameQuota);
  }, [sb, uid]);

  // ── Display handle ──
  async function setDisplay(mode: DisplayHandleMode) {
    setMsg(null);
    if (!sb) return setMsg("Supabase is OFF (check env).");
    if (mode === "username" && !form.username) {
      setMsg('Set a username before choosing "username" display mode.');
      return;
    }
    try {
      setBusy(true);
      const { error } = await sb.rpc("set_my_display_handle", { p_mode: mode });
      if (error) throw error;
      setForm(f => ({ ...f, display_handle_mode: mode }));
      setHandle(mode === "username" ? (form.username || randomId) : randomId);
      setMsg("Display handle updated.");
      queryClient.invalidateQueries({ queryKey: ["profile", uid] });
    } catch (e: any) {
      setMsg(e.message || "Could not update display mode");
    } finally {
      setBusy(false);
    }
  }

  const isUsernameSet     = !!(form.username || "").trim();
  const isUsernameChanged =
    (form.username || "").trim().toLowerCase() !== (initialUsername || "").trim().toLowerCase();
  const bioLen = (form.bio || "").length;

  return (
    <div className="mx-auto max-w-xl p-6 space-y-4">
      <h1 className="text-2xl font-bold">Profile settings</h1>
      {msg && <p className="text-sm text-slate-700">{msg}</p>}

      {/* Debug: username error */}
      {lastUsernameError && (
        <div className="rounded border p-3 text-xs bg-white">
          <div className="font-medium mb-1">set_username error (debug)</div>
          <pre className="whitespace-pre-wrap break-words">
            {JSON.stringify(lastUsernameError, null, 2)}
          </pre>
        </div>
      )}

      {/* Random ID */}
      <div className="rounded border p-3 space-y-1">
        <div className="text-sm font-medium">Your Random ID (read-only)</div>
        <div className="text-sm text-slate-700 break-all">
          {randomId ? randomId : <span className="text-slate-500">Loading…</span>}
        </div>
        <div className="text-xs text-slate-500">
          Generated at registration and cannot be changed.
        </div>
      </div>

      {/* Username */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Username</div>
        <div className="text-xs text-slate-500">
          You can update your username (subject to rules/limits enforced by the server).
        </div>
        <UsernameField
          value={form.username}
          onChange={v => setForm(f => ({ ...f, username: v }))}
        />

        {/* M-A05: quota display */}
        {usernameQuota && (
          <p className="text-xs text-slate-500">
            {usernameQuota.used} of {usernameQuota.limit} username changes used in the last 30 days
            {usernameQuota.resetsInDays != null
              ? ` (resets in ${usernameQuota.resetsInDays} day${usernameQuota.resetsInDays === 1 ? "" : "s"})`
              : ""}
            .
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border rounded px-3 py-1 disabled:opacity-50"
            onClick={updateUsername}
            disabled={busy || !isUsernameSet || !isUsernameChanged}
          >
            {isUsernameSet ? "Update Username" : "Set Username"}
          </button>
        </div>
      </div>

      {/* Display choice */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Public display</div>
        <div className="text-xs text-slate-500">
          Choose what other users see on your stances/comments/posts.
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`border rounded px-3 py-1 transition-colors ${
              form.display_handle_mode === "random_id"
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-300 hover:border-slate-400"
            }`}
            onClick={() => setDisplay("random_id")}
            disabled={busy}
            aria-pressed={form.display_handle_mode === "random_id"}
          >
            Use Random ID {form.display_handle_mode === "random_id" ? "✓" : ""}
          </button>
          <button
            type="button"
            className={`border rounded px-3 py-1 transition-colors ${
              form.display_handle_mode === "username"
                ? "bg-slate-900 text-white border-slate-900"
                : "border-slate-300 hover:border-slate-400"
            } ${!isUsernameSet ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => setDisplay("username")}
            disabled={busy || !isUsernameSet}
            aria-pressed={form.display_handle_mode === "username"}
            title={!isUsernameSet ? "Set a username first" : ""}
          >
            Use Username {form.display_handle_mode === "username" ? "✓" : ""}
          </button>
        </div>
        <div className="text-xs text-slate-600">
          Currently showing: <span className="font-medium">{handle || "(unknown)"}</span>
        </div>
      </div>

      {/* Bio — M-A04: maxLength + counter */}
      <div className="space-y-1">
        <textarea
          className="w-full border rounded px-3 py-2"
          rows={3}
          placeholder="Bio"
          maxLength={BIO_MAX}
          value={form.bio}
          onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
        />
        <div className={`text-xs text-right ${bioLen >= BIO_MAX ? "text-rose-500 font-medium" : "text-slate-400"}`}>
          {bioLen}/{BIO_MAX}
        </div>
      </div>

      {/* M-A07: Age opt-in toggle */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Age display</div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.show_age}
            onChange={e => setForm(f => ({ ...f, show_age: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          <span className="text-sm text-slate-700">Show my age on my public profile</span>
        </label>
        <p className="text-xs text-slate-500">
          When enabled, your age (calculated from your date of birth) is visible on your profile.
        </p>
      </div>

      {/* M-A06: DOB correction pathway */}
      <div className="rounded border p-3 space-y-2">
        <div className="text-sm font-medium">Date of birth</div>
        {dobSet ? (
          <>
            <p className="text-xs text-slate-500">
              Your date of birth is set and encrypted. It cannot be viewed, only corrected.
            </p>
            <DobCorrectionSection
              sb={sb}
              onDobCleared={() => {
                setDobSet(false);
                setMsg("Date of birth updated successfully.");
              }}
            />
          </>
        ) : (
          <p className="text-xs text-slate-500">
            Date of birth is not set. You can set it during onboarding.
          </p>
        )}
      </div>

      {/* Avatar — M-A02 crop, M-A03 path */}
      <AvatarUploader
        uid={uid}
        handle={handle}
        currentUrl={form.avatar_url || null}
        currentPath={form.avatar_path}
        onChange={(url, path) => setForm(f => ({ ...f, avatar_url: url || "", avatar_path: path }))}
      />

      {/* Save profile (bio + avatar + show_age) */}
      <button
        type="button"
        className="rounded bg-slate-900 text-white px-4 py-2 disabled:opacity-50"
        onClick={saveProfile}
        disabled={busy}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
