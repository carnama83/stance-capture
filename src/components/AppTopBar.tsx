// src/components/AppTopBar.tsx
// REDESIGNED HEADER - Privacy-first, capability-focused navigation
// Logged-in: Logo | Explore | My Stances | Insights | [+ Answer] | @handle ▾
// Logged-out: Logo | Explore | [Sign In] | [Create Account]

import * as React from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Search, Compass } from "lucide-react";

type Profile = {
  random_id: string;
  username: string | null;
  display_handle_mode: "username" | "random_id";
};

// ---------- Session Hook ----------
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<any>(null);

  React.useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ---------- Get Display Handle ----------
function getDisplayHandle(
  profile: Profile | null | undefined, 
  session: any
): string {
  // If profile loaded, use it
  if (profile) {
    if (profile.display_handle_mode === "username" && profile.username) {
      return `@${profile.username}`;
    }
    return `#${profile.random_id}`;
  }
  
  // Fallback to email local-part while loading
  if (session?.user?.email) {
    const email = session.user.email;
    const atIdx = email.indexOf("@");
    if (atIdx > 0) {
      const local = email.slice(0, atIdx);
      return `@${local}`;
    }
  }
  
  return "...";
}

// ---------- Navigation Item Component ----------
function NavItem({ 
  to, 
  children, 
  active 
}: { 
  to: string; 
  children: React.ReactNode; 
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`
        px-3 py-2 rounded-md text-sm font-medium transition-colors
        ${active 
          ? 'bg-accent text-foreground' 
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }
      `}
    >
      {children}
    </Link>
  );
}



function PillButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground hover:border-primary/20"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ---------- Main Component ----------
export default function AppTopBar({ 
  rightSlot 
}: { 
  rightSlot?: React.ReactNode 
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSupabaseSession();
  const sb = React.useMemo(getSupabase, []);
  const isAuthed = !!session;
  const userId = session?.user?.id ?? null;
  const onLoginPage = location.pathname === "/login";
  const onSignupPage = location.pathname === "/signup";
  const onAuthPage = onLoginPage || onSignupPage;

  // Fetch user profile
  const { data: profile } = useQuery({
    enabled: !!userId,
    queryKey: ["profile", userId],
    queryFn: async () => {
      if (!sb || !userId) return null;
      const { data, error } = await sb
        .from("profiles")
        .select("random_id, username, display_handle_mode")
        .eq("user_id", userId)
        .maybeSingle<Profile>();
      if (error) {
        console.error("Failed to load profile", error);
        return null;
      }
      return data;
    },
    staleTime: 60_000,
  });

  const handleLogout = async () => {
    if (!sb) return;
    await sb.auth.signOut();
    navigate("/login");
  };

  // Check active route
  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        
        {/* LEFT: Logo / Brand */}
        <Link 
          to="/" 
          className="flex items-center space-x-2 group"
          title="Track how views change over time"
        >
          <span className="text-xl font-bold text-foreground">
            Stance
          </span>
          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline">
            Track evolving views
          </span>
        </Link>

        {/* CENTER: Core Navigation */}
        <nav className="hidden md:flex items-center space-x-1">
          {isAuthed ? (
            <>
              {/* Logged-in Navigation */}
              <NavItem to="/topics" active={isActive("/topics")}>
                Explore
              </NavItem>
              <NavItem to="/me/stances" active={isActive("/me/stances")}>
                My Stances
              </NavItem>
              <NavItem to="/insights" active={isActive("/insights")}>
                Insights
              </NavItem>
            </>
          ) : (
            <>
              {/* Logged-out Navigation */}
              <NavItem to="/topics" active={isActive("/topics")}>
                Explore
              </NavItem>
            </>
          )}
        </nav>

        {/* RIGHT: Identity & Control */}
        <div className="flex items-center space-x-3">

          {/* View mode: Anonymous vs Signed in (interactive) + common pills */}
          <div className="hidden sm:flex items-center gap-3">
            <div
              className="inline-flex items-center rounded-full border border-border bg-muted p-1"
              aria-label="View mode"
            >
              <button
                type="button"
                onClick={async () => {
                  if (!isAuthed) return;
                  // Switch to Anonymous by signing out (privacy-first)
                  if (!sb) return;
                  await sb.auth.signOut();
                  navigate("/");
                }}
                className={[
                  "px-3 py-1.5 text-xs font-medium rounded-full transition",
                  !isAuthed
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                ].join(" ")}
                aria-pressed={!isAuthed}
                title={!isAuthed ? "Anonymous mode" : "Sign out to go anonymous"}
              >
                Anonymous
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isAuthed) return;
                  if (onLoginPage) return;
                  navigate("/login");
                }}
                className={[
                  "px-3 py-1.5 text-xs font-medium rounded-full transition",
                  // When logged in: active "Signed in".
                  // When logged out: active on /login, otherwise neutral.
                  isAuthed || onLoginPage
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  onLoginPage && !isAuthed ? "cursor-default" : "",
                ].join(" ")}
                aria-pressed={isAuthed || onLoginPage}
                title={isAuthed ? "Signed in" : onLoginPage ? "You are on the login page" : "Sign in"}
              >
                {isAuthed ? "Signed in" : "Sign in"}
              </button>
            </div>

            {/* Consistent pills across auth states */}
            <PillButton
              onClick={() => navigate("/topics")}
              icon={<Search className="h-4 w-4" />}
              label="Search"
            />
            <PillButton
              onClick={() => navigate("/topics")}
              icon={<Compass className="h-4 w-4" />}
              label="Explore topics"
            />
          </div>

          {isAuthed ? (
            <>
              {/* Primary CTA: Answer Question */}
              <button
                onClick={() => navigate("/topics")}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                <span>Answer</span>
              </button>

              {/* Mobile CTA */}
              <button
                onClick={() => navigate("/topics")}
                className="sm:hidden flex items-center justify-center w-10 h-10 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors"
                aria-label="Answer question"
              >
                <Plus className="h-5 w-5" />
              </button>

              {/* User Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:border-primary/20 hover:bg-accent transition-colors">
                  <span className="text-sm font-medium text-foreground">
                    {getDisplayHandle(profile, session)}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-sm font-medium text-foreground">
                    {getDisplayHandle(profile, session)}
                  </div>
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem onClick={() => navigate("/settings/profile")}>
                    Profile
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem onClick={() => navigate("/settings/location")}>
                    Location
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem onClick={() => navigate("/settings/privacy")}>
                    Privacy
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  >
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              {/* Logged-out CTAs */}
              <button
                onClick={() => {
                  if (!onSignupPage) navigate("/signup");
                }}
                className={
                  onSignupPage
                    ? "px-4 py-2 rounded-full text-sm font-medium border border-border text-muted-foreground bg-card cursor-default"
                    : "px-4 py-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors text-sm font-medium"
                }
                aria-current={onSignupPage ? "page" : undefined}
              >
                Create account
              </button>
            </>
          )}

          {/* Optional right slot (for page-specific actions) */}
          {rightSlot && (
            <div className="hidden lg:flex items-center ml-2">
              {rightSlot}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Navigation (Bottom Sheet Style) */}
      {isAuthed && (
        <div className="md:hidden border-t border-border bg-card px-4 py-2">
          <nav className="flex items-center justify-around">
            <Link
              to="/topics"
              className={`flex-1 text-center py-2 text-xs font-medium ${
                isActive("/topics")
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Explore
            </Link>
            <Link
              to="/me/stances"
              className={`flex-1 text-center py-2 text-xs font-medium ${
                isActive("/me/stances")
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              My Stances
            </Link>
            <Link
              to="/insights"
              className={`flex-1 text-center py-2 text-xs font-medium ${
                isActive("/insights")
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Insights
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
