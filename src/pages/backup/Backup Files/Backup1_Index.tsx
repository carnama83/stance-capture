// src/pages/Index.tsx
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient";

// ------- Tiny session hook (local to this page) -------
type Session = import("@supabase/supabase-js").Session;
function useSupabaseSession() {
  const sb = React.useMemo(getSupabase, []);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    if (!sb) return;
    // prime current state
    sb.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    // react to changes
    const { data: { subscription } } = sb.auth.onAuthStateChange((_evt, s) => {
      setSession(s ?? null);
    });
    return () => subscription?.unsubscribe();
  }, [sb]);

  return session;
}

// ------- Page-level helpers -------
function displayName(session: Session | null) {
  if (!session) return "";
  const name =
    (session.user.user_metadata?.full_name as string | undefined) ||
    (session.user.user_metadata?.name as string | undefined) ||
    session.user.email ||
    "there";
  return name;
}

export default function Index() {
  const navigate = useNavigate();
  const session = useSupabaseSession();
  const isAuthed = !!session;

  // When an anonymous user tries to perform an action that needs auth:
  const requireLogin = React.useCallback(() => {
    // Optional: store current hash to return after login
    const returnTo = window.location.hash || "#/";
    sessionStorage.setItem("return_to", returnTo);
    navigate("/login");
  }, [navigate]);

  // After login, somewhere in Login.tsx (successful sign-in) you can:
  // const back = sessionStorage.getItem("return_to"); if (back) { window.location.hash = back; sessionStorage.removeItem("return_to"); }

  return (
    <div className="min-h-screen">
      <TopNav isAuthed={isAuthed} />

      {/* Hero */}
      {isAuthed ? (
        <HeroWelcome name={displayName(session)} />
      ) : (
        <HeroCta onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} />
      )}

      {/* Trending strip */}
      <section className="mx-auto max-w-6xl px-4 py-4">
        <Trending personalized={isAuthed} />
      </section>

      {/* Topics grid: interactive if authed, read-only otherwise */}
      <section className="mx-auto max-w-6xl px-4 py-6">
        <TopicGrid
          interactive={isAuthed}
          onRequireLogin={requireLogin}
        />
      </section>

      {/* See how your region thinks */}
      <section className="mx-auto max-w-6xl px-4 py-6">
        <RegionThinks showUserBadge={isAuthed} />
      </section>

      {/* Logged-out only sections */}
      {!isAuthed && (
        <>
          <section className="border-t">
            <HowItWorks />
          </section>
          <section className="border-t bg-slate-50/60">
            <WhyDifferent />
          </section>
          <section className="border-t">
            <FooterCta onSignup={() => navigate("/signup")} />
          </section>
        </>
      )}
    </div>
  );
}

/* ----------------------------
   Minimal stub components
   Replace these with your real ones when you wire data.
-----------------------------*/
function TopNav({ isAuthed }: { isAuthed: boolean }) {
  const navigate = useNavigate();
  return (
    <header className="border-b">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <div className="font-semibold">Website</div>
        {isAuthed ? (
          <div className="flex items-center gap-3">
            <button className="rounded border px-3 py-1.5" onClick={() => navigate("/profile")}>Profile</button>
            <button className="rounded border px-3 py-1.5" onClick={() => navigate("/settings/profile")}>Settings</button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button className="rounded border px-3 py-1.5" onClick={() => navigate("/login")}>Log in</button>
            <button className="rounded bg-slate-900 text-white px-3 py-1.5" onClick={() => navigate("/signup")}>Sign up</button>
          </div>
        )}
      </div>
    </header>
  );
}

function HeroCta({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-12 grid md:grid-cols-2 gap-8">
        <div>
          <h1 className="text-3xl font-bold">See how your region thinks</h1>
          <p className="mt-2 text-slate-600">Take a stance, compare with your city, county, state, country, and globally.</p>
          <div className="mt-6 flex gap-3">
            <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={onSignup}>Sign up</button>
            <button className="rounded border px-4 py-2" onClick={onLogin}>Log in</button>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-6">[mock hero card]</div>
      </div>
    </section>
  );
}

function HeroWelcome({ name }: { name: string }) {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="text-2xl font-semibold">Welcome back, {name} 👋</h2>
        <p className="text-slate-600 mt-1">Pick up where you left off or explore new topics below.</p>
        <div className="mt-4 flex gap-3">
          <button className="rounded bg-slate-900 text-white px-4 py-2">Continue</button>
          <button className="rounded border px-4 py-2">My topics</button>
        </div>
      </div>
    </section>
  );
}

function Trending({ personalized }: { personalized: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium mb-2">{personalized ? "Trending for you" : "Trending topics"}</div>
      <div className="flex flex-wrap gap-2">
        {["Elections", "EVs", "Housing", "AI Safety", "Taxes"].map((t) => (
          <span key={t} className="text-xs rounded-full border px-2 py-1">{t}</span>
        ))}
      </div>
    </div>
  );
}

function TopicGrid({ interactive, onRequireLogin }: { interactive: boolean; onRequireLogin: () => void }) {
  // A tiny mock grid w/ stance button behavior
  const topics = ["Carbon Tax", "Rent Control", "Crypto Regulation", "School Vouchers"];
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Topics</h3>
        <input placeholder="Search topics…" className="border rounded px-3 py-1.5 text-sm" />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {topics.map((t) => (
          <div key={t} className="rounded-lg border p-4">
            <div className="font-medium">{t}</div>
            <p className="text-sm text-slate-600 mt-1">Short summary for {t}…</p>
            <div className="mt-3">
              {interactive ? (
                <button className="rounded bg-slate-900 text-white px-3 py-1.5 text-sm">Take stance</button>
              ) : (
                <button
                  className="rounded border px-3 py-1.5 text-sm"
                  onClick={onRequireLogin}
                  title="Log in to take your stance"
                >
                  Take stance (log in)
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegionThinks({ showUserBadge }: { showUserBadge: boolean }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium mb-2">See how your region thinks</div>
      <div className="space-y-2">
        {["City", "County", "State", "Country", "Global"].map((lvl) => (
          <div key={lvl} className="flex items-center gap-2">
            <span className="w-24 text-sm text-slate-600">{lvl}</span>
            <div className="flex-1 h-2 bg-slate-200 rounded">
              <div className="h-2 rounded" style={{ width: `${50 + (Math.random() * 40 - 20)}%` }} />
            </div>
            {showUserBadge && <span className="text-xs rounded-full border px-2 py-0.5 ml-2">Your stance: +1</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h3 className="text-lg font-semibold mb-4">How it works</h3>
      <div className="grid sm:grid-cols-3 gap-4">
        {["Pick topics", "Take stance", "Compare & discuss"].map((s, i) => (
          <div key={s} className="rounded-lg border p-4">
            <div className="text-sm font-medium">{i + 1}. {s}</div>
            <p className="text-sm text-slate-600 mt-1">Quick explainer about {s.toLowerCase()}…</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WhyDifferent() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h3 className="text-lg font-semibold mb-4">Why we’re different</h3>
      <ul className="grid sm:grid-cols-2 gap-4 text-sm text-slate-700">
        <li className="rounded-lg border p-4">Neutral, region-aware insights</li>
        <li className="rounded-lg border p-4">Privacy-first, pseudonymous identity</li>
        <li className="rounded-lg border p-4">Simple stance scale (-2..+2)</li>
        <li className="rounded-lg border p-4">Admin-reviewed questions & sources</li>
      </ul>
    </div>
  );
}

function FooterCta({ onSignup }: { onSignup: () => void }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="rounded-lg border p-6 flex items-center justify-between">
        <div>
          <div className="font-semibold">Ready to add your voice?</div>
          <div className="text-sm text-slate-600">Create your profile and start taking stances.</div>
        </div>
        <button className="rounded bg-slate-900 text-white px-4 py-2" onClick={onSignup}>
          Create your profile
        </button>
      </div>
    </div>
  );
}
