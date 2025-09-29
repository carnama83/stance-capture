//src/components/AppTopBar.tsx
import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

type Session = import("@supabase/supabase-js").Session;

export default function AppTopBar({
  rightSlot, // page-level actions (optional)
}: {
  rightSlot?: React.ReactNode;
}) {
  const sb = React.useMemo(getSupabase, []);
  const nav = useNavigate();
  const loc = useLocation();
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
    });
    return () => subscription?.unsubscribe();
  }, [sb]);

  async function logout() {
    try {
      await sb?.auth.signOut();
      // after logout, go Home (index)
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
        {/* Left: brand + basic nav */}
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
            {/* add more global links as needed */}
          </nav>
        </div>

        {/* Right: page slot + auth controls */}
        <div className="flex items-center gap-3">
          {rightSlot /* page-level actions (buttons/filters) */}

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
              <Link
                to="/profile"
                className="hidden sm:inline-block text-sm text-slate-700 hover:underline"
                title={displayName}
              >
                {displayName ? `Hi, ${displayName.split(" ")[0]}` : "Profile"}
              </Link>
              <Link
                to="/settings/profile"
                className="hidden sm:inline-block text-sm text-slate-700 hover:underline"
              >
                Settings
              </Link>
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
