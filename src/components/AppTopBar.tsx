// src/components/AppTopBar.tsx
import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { ROUTES } from "@/routes/paths";

// shadcn/ui dropdown
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Session = import("@supabase/supabase-js").Session;

type ProfileIdentity = {
  random_id: string | null;
  username: string | null;
  display_handle_mode: "random_id" | "username" | null;
};

export default function AppTopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();
  const loc = useLocation();
  const [session, setSession] = React.useState<Session | null>(null);

  // ✅ NEW: identity used for display (random_id / username)
  const [identity, setIdentity] = React.useState<ProfileIdentity | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  // ✅ NEW: load profile identity whenever session user changes
  React.useEffect(() => {
    if (!sb) return;

    let cancelled = false;

    async function loadIdentity(userId: string) {
      try {
        const { data, error } = await sb
          .from("profiles")
          .select("random_id, username, display_handle_mode")
          .eq("user_id", userId)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          setIdentity((data as ProfileIdentity) ?? null);
        }
      } catch {
        if (!cancelled) setIdentity(null);
      }
    }

    const userId = session?.user?.id;
    if (!userId) {
      setIdentity(null);
      return;
    }

    loadIdentity(userId);
    return () => {
      cancelled = true;
    };
  }, [sb, session?.user?.id]);

  async function logout() {
    try {
      await sb?.auth.signOut();
      nav(ROUTES.HOME, { replace: true });
    } catch {
      // ignore
    } finally {
      // Ensure UI reflects logout immediately (no refresh needed)
      setSession(null);
      setIdentity(null);
    }
  }

  const isAuthed = !!session;

  // ✅ Primary + secondary (based on chosen display_handle_mode)
  const primaryHandle = (() => {
    if (!identity) return "";
    const mode = identity.display_handle_mode ?? "random_id";
    if (mode === "username" && identity.username) return identity.username;
    return identity.random_id || identity.username || "";
  })();

  const secondaryText = (() => {
    if (!identity) return "";
    const mode = identity.display_handle_mode ?? "random_id";
    if (mode === "username") {
      return identity.random_id ? `ID: ${identity.random_id}` : "";
    }
    return identity.username ? `Username: ${identity.username}` : "";
  })();

  return (
    <header className="sticky top-0 z-40 h-14 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-6xl h-full px-4 flex items-center justify-between">
        {/* Left: brand + global nav */}
        <div className="flex items-center gap-3">
          <Link to={ROUTES.HOME} className="font-semibold hover:opacity-80">
            Website
          </Link>
          <nav className="hidden sm:flex items-center gap-3 text-sm text-slate-700">
            <Link
              to={ROUTES.HOME}
              className={`hover:underline ${
                loc.pathname === ROUTES.HOME || loc.pathname === ROUTES.INDEX ? "font-medium" : ""
              }`}
            >
              Home
            </Link>
            <Link
              to={ROUTES.TOPICS}
              className={`hover:underline ${loc.pathname.startsWith(ROUTES.TOPICS) ? "font-medium" : ""}`}
            >
              Explore
            </Link>
          </nav>
        </div>

        {/* Right: page actions + auth controls */}
        <div className="flex items-center gap-3">
          {rightSlot}

          {!isAuthed ? (
            <>
              <Link to={ROUTES.LOGIN} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
                Log in
              </Link>
              <Link to={ROUTES.SIGNUP} className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">
                Sign up
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {/* ✅ Replace email-based greeting with handle-based identity (primary + secondary) */}
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <Link
                  to={ROUTES.SETTINGS_PROFILE}
                  className="text-sm text-slate-700 hover:underline"
                  title="Profile settings"
                >
                  {primaryHandle ? `@${primaryHandle}` : "Profile"}
                </Link>
                {secondaryText ? <div className="text-xs text-slate-500">{secondaryText}</div> : null}
              </div>

              {/* Settings dropdown — unchanged structure */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="px-3 py-1.5 h-auto text-sm">
                    Settings
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="truncate">Settings</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link role="menuitem" to={ROUTES.SETTINGS_PROFILE} className="block w-full px-1.5 py-0.5">
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link role="menuitem" to={ROUTES.SETTINGS_SECURITY} className="block w-full px-1.5 py-0.5">
                      Security
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link role="menuitem" to={ROUTES.SETTINGS_SESSIONS} className="block w-full px-1.5 py-0.5">
                      Sessions
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Logout */}
              <Button
                type="button"
                onClick={logout}
                variant="outline"
                className="px-3 py-1.5 h-auto text-sm"
                title="Sign out"
              >
                Logout
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
