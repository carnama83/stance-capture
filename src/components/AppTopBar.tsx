// src/components/AppTopBar.tsx
import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";
import { ROUTES } from "@/routes/paths";
import { SearchBar } from "./search/SearchBar";

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
  const [identity, setIdentity] = React.useState<ProfileIdentity | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

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
      setSession(null);
      setIdentity(null);
    }
  }

  const isAuthed = !!session;

  const primaryHandle = (() => {
    if (!identity) return "";
    const mode = identity.display_handle_mode ?? "random_id";
    if (mode === "username" && identity.username) return identity.username;
    return identity.random_id || identity.username || "";
  })();

  const secondaryHandle = (() => {
    if (!identity) return "";
    const mode = identity.display_handle_mode ?? "random_id";
    if (mode === "username" && identity.random_id) return identity.random_id;
    if (mode === "random_id" && identity.username) return identity.username;
    return "";
  })();

  return (
    <div className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-6">
          <Link to={ROUTES.HOME} className="text-lg font-bold text-slate-900 hover:text-slate-700">
            Stance
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-4">
            <Link
              to="/for-you"
              className={`text-sm ${
                loc.pathname === "/for-you"
                  ? "font-medium text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              For You
            </Link>
            <Link
              to="/topics"
              className={`text-sm ${
                loc.pathname === "/topics"
                  ? "font-medium text-slate-900"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Topics
            </Link>
          </nav>
        </div>

        {/* Center: Search Bar */}
        <div className="hidden md:block flex-1 max-w-md mx-6">
          <SearchBar placeholder="Search..." />
        </div>

        {/* Right: User menu or Auth buttons */}
        <div className="flex items-center gap-3">
          {rightSlot}

          {!isAuthed && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(ROUTES.LOGIN)}
              >
                Log in
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => nav(ROUTES.SIGNUP)}
              >
                Sign up
              </Button>
            </>
          )}

          {isAuthed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  @{primaryHandle || "user"}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      @{primaryHandle || "user"}
                    </span>
                    {secondaryHandle && (
                      <span className="text-xs text-slate-500">
                        {secondaryHandle}
                      </span>
                    )}
                  </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => nav(ROUTES.MY_STANCES)}>
                  My stances
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => nav(ROUTES.SETTINGS_PROFILE)}>
                  Settings
                </DropdownMenuItem>

                {/* Admin link if needed */}
                {/* 
                <DropdownMenuItem onClick={() => nav("/admin")}>
                  Admin
                </DropdownMenuItem>
                */}

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={logout}>
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Mobile Search Bar */}
      <div className="md:hidden px-4 pb-3">
        <SearchBar placeholder="Search..." />
      </div>
    </div>
  );
}
