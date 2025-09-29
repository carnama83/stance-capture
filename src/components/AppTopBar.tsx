// src/components/AppTopBar.tsx
import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

type Session = import("@supabase/supabase-js").Session;

export default function AppTopBar({ rightSlot }: { rightSlot?: React.ReactNode }) {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();
  const loc = useLocation();
  const [session, setSession] = React.useState<Session | null>(null);

  // simple settings menu state
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  React.useEffect(() => {
    // close menu on route change
    setMenuOpen(false);
  }, [loc.pathname]);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  async function logout() {
    try {
      await sb?.auth.signOut();
      nav("/", { replace: true });
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

  return (
    <header className="sticky top-0 z-40 h-14 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-6xl h-full px-4 flex items-center justify-between">
        {/* Left: brand + global nav */}
        <div className="flex items-center gap-3">
          <Link to="/" className="font-semibold hover:opacity-80">
            Website
          </Link>
          <nav className="hidden sm:flex items-center gap-3 text-sm text-slate-700">
            <Link
              to="/"
              className={`hover:underline ${loc.pathname === "/" || loc.pathname === "/index" ? "font-medium" : ""}`}
            >
              Home
            </Link>
          </nav>
        </div>

        {/* Right: page actions + auth controls */}
        <div className="flex items-center gap-3">
          {rightSlot}

          {!isAuthed ? (
            <>
              <Link to="/login" className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50">
                Log in
              </Link>
              <Link to="/signup" className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">
                Sign up
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {/* Profile quick link */}
              <Link
                to="/profile"
                className="hidden sm:inline-block text-sm text-slate-700 hover:underline"
                title={displayName}
              >
                {displayName ? `Hi, ${displayName.split(" ")[0]}` : "Profile"}
              </Link>

              {/* Settings dropdown */}
              <div className="relative" ref={menuRef}>
                <button
                  className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  Settings
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-44 rounded-lg border bg-white shadow-lg overflow-hidden"
                  >
                    <Link
                      role="menuitem"
                      to="/settings/profile"
                      className="block px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      Profile
                    </Link>
                    <Link
                      role="menuitem"
                      to="/settings/security"
                      className="block px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      Security
                    </Link>
                    <Link
                      role="menuitem"
                      to="/settings/sessions"
                      className="block px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      Sessions
                    </Link>
                  </div>
                )}
              </div>

              {/* Logout */}
              <button
                onClick={logout}
                className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
                title="Sign out"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
