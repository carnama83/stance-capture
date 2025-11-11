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

export default function AppTopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();
  const loc = useLocation();
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  async function logout() {
    try {
      await sb?.auth.signOut();
      nav(ROUTES.HOME, { replace: true });
    } catch {
      // ignore
    }
  }

  const isAuthed = !!session;
  const displayName =
    (session?.user.user_metadata?.full_name as string | undefined) ||
    (session?.user.user_metadata?.name as string | undefined) ||
    session?.user.email ||
    "";

  const firstName = displayName ? displayName.split(" ")[0] : "";

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
              {/* Profile quick link */}
              <Link
                to={ROUTES.PROFILE}
                className="hidden sm:inline-block text-sm text-slate-700 hover:underline"
                title={displayName}
              >
                {firstName ? `Hi, ${firstName}` : "Profile"}
              </Link>

              {/* Settings dropdown — Option A: asChild Links inside shadcn Dropdown */}
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
                    <Link
                      role="menuitem"
                      to={ROUTES.SETTINGS_PROFILE}
                      className="block w-full px-1.5 py-0.5"
                    >
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      role="menuitem"
                      to={ROUTES.SETTINGS_SECURITY}
                      className="block w-full px-1.5 py-0.5"
                    >
                      Security
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link
                      role="menuitem"
                      to={ROUTES.SETTINGS_SESSIONS}
                      className="block w-full px-1.5 py-0.5"
                    >
                      Sessions
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Logout */}
              <Button
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
