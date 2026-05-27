// src/pages/settings/ConstituencySetup.tsx
//
// Settings: Constituency Setup (Epic EL — Phase EL-5)
//
// Allows users to set their primary_constituency_id so election questions
// are geo-targeted to their Assembly Constituency.
//
// Flow:
//   1. User selects state (defaults to UP for launch)
//   2. Searchable dropdown of all ACs in that state
//   3. Postal voter checkbox with UX note
//   4. Save → writes to profiles via rpcFetch pattern
//
// EL-F-018: profile.primary_constituency_id set here
// EL-QA-G08: postal voter flag shown with "registered vs physical" note
// EL-F-019: feed uses this to geo-target election questions

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, MapPin, CheckCircle2, Info, Vote } from "lucide-react";

type Constituency = {
  id: string;
  name: string;
  name_local: string | null;
  constituency_code: string;
  district_name: string | null;
  state_code: string;
  state_name: string;
};

type StateGroup = { code: string; name: string };

const SUPPORTED_STATES: StateGroup[] = [
  { code: "IN-UP", name: "Uttar Pradesh" },
  // Additional states as they launch
];

function getRpcFetchHeaders() {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://", "")?.split(".")[0] ?? "";
  let jwt = anonKey;
  try {
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (raw) { const p = JSON.parse(raw); if (p?.access_token) jwt = p.access_token; }
  } catch {}
  return { anonKey, jwt, baseUrl: import.meta.env.VITE_SUPABASE_URL as string };
}

export default function ConstituencySetupPage() {
  const sb = getSupabase()!;
  const { toast } = useToast();

  const [userId, setUserId] = React.useState<string | null>(null);
  const [selectedState, setSelectedState] = React.useState("IN-UP");
  const [constituencies, setConstituencies] = React.useState<Constituency[]>([]);
  const [loadingConstituencies, setLoadingConstituencies] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selectedConstituencyId, setSelectedConstituencyId] = React.useState("");
  const [currentConstituencyId, setCurrentConstituencyId] = React.useState<string | null>(null);
  const [postalVoter, setPostalVoter] = React.useState(false);
  const [electionNotifications, setElectionNotifications] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Load current user and their profile constituency
  React.useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data } = await sb
        .from("profiles")
        .select("primary_constituency_id,postal_voter,election_notifications_enabled")
        .eq("user_id", user.id)
        .single();

      if (data?.primary_constituency_id) {
        setCurrentConstituencyId(data.primary_constituency_id);
        setSelectedConstituencyId(data.primary_constituency_id);
      }
      if (data?.postal_voter !== undefined) setPostalVoter(data.postal_voter);
      if (data?.election_notifications_enabled !== undefined) setElectionNotifications(data.election_notifications_enabled);
    })();
  }, [sb]);

  // Load constituencies for selected state
  React.useEffect(() => {
    if (!selectedState) return;
    setLoadingConstituencies(true);
    (async () => {
      const { data } = await sb
        .from("election_constituencies")
        .select("id,name,name_local,constituency_code,district_name,state_code,state_name")
        .eq("state_code", selectedState)
        .eq("tier_code", "IN_VIDHAN_SABHA")
        .is("valid_to", null)
        .order("name");
      setConstituencies(data ?? []);
      setLoadingConstituencies(false);
    })();
  }, [sb, selectedState]);

  // Filtered constituencies
  const filtered = React.useMemo(() => {
    if (!search.trim()) return constituencies;
    const q = search.toLowerCase();
    return constituencies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.name_local ?? "").includes(q) ||
        (c.district_name ?? "").toLowerCase().includes(q) ||
        c.constituency_code.toLowerCase().includes(q)
    );
  }, [constituencies, search]);

  const selectedConstituency = constituencies.find((c) => c.id === selectedConstituencyId);

  const handleSave = async () => {
    if (!userId || !selectedConstituencyId) return;
    setSaving(true);
    setSaved(false);

    try {
      const { anonKey, jwt, baseUrl } = getRpcFetchHeaders();
      const res = await fetch(`${baseUrl}/rest/v1/profiles?user_id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": anonKey,
          "Authorization": `Bearer ${jwt}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          primary_constituency_id: selectedConstituencyId,
          postal_voter: postalVoter,
          election_notifications_enabled: electionNotifications,
        }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.message ?? `HTTP ${res.status}`);
      }

      setCurrentConstituencyId(selectedConstituencyId);
      setSaved(true);
      toast({
        title: "Constituency saved",
        description: `Election questions for ${selectedConstituency?.name} will appear in your feed.`,
      });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const hasChanged =
    selectedConstituencyId !== (currentConstituencyId ?? "") ||
    (selectedConstituencyId !== "" && selectedConstituencyId !== currentConstituencyId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Vote className="h-4 w-4 text-muted-foreground" />
          Election Constituency
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Set your Assembly Constituency to see election questions and community stances relevant to your area.
        </p>
      </div>

      {/* Current status */}
      {currentConstituencyId && (
        <div className="flex items-center gap-2 rounded bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Your constituency is set. Election questions for{" "}
            <strong>{constituencies.find((c) => c.id === currentConstituencyId)?.name ?? "your constituency"}</strong>{" "}
            will appear in your feed.
          </span>
        </div>
      )}

      {/* State selector */}
      <div className="space-y-2">
        <Label>State</Label>
        <Select value={selectedState} onValueChange={(v) => { setSelectedState(v); setSelectedConstituencyId(""); setSearch(""); }}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_STATES.map((s) => (
              <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          More states will be added as elections are scheduled.
        </p>
      </div>

      {/* Constituency search + picker */}
      <div className="space-y-3">
        <Label>Assembly Constituency</Label>

        <Input
          placeholder="Search by name, district, or AC number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        {loadingConstituencies ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading constituencies…
          </div>
        ) : (
          <div className="rounded border divide-y max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No constituencies match "{search}"
              </div>
            ) : (
              filtered.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    selectedConstituencyId === c.id
                      ? "bg-primary/5 border-l-2 border-primary"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => { setSelectedConstituencyId(c.id); setSaved(false); }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                      {c.name_local && (
                        <span className="text-xs text-muted-foreground">{c.name_local}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{c.constituency_code}</span>
                      {c.district_name && <span>· {c.district_name} district</span>}
                    </div>
                  </div>
                  {selectedConstituencyId === c.id && (
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Postal voter */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-2">
            <input
              id="postal_voter"
              type="checkbox"
              checked={postalVoter}
              onChange={(e) => setPostalVoter(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 mt-0.5"
            />
            <div>
              <Label htmlFor="postal_voter" className="cursor-pointer text-sm">
                I am a postal / absentee voter
              </Label>
              {postalVoter && (
                <div className="flex items-start gap-1.5 mt-1.5 text-xs text-amber-700">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Your registered constituency may differ from where you currently live.
                    The constituency above is your <strong>registered</strong> voting constituency
                    for election purposes — not your current physical location (EL-QA-G08).
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Election notifications */}
      <div className="flex items-center gap-2">
        <input
          id="election_notifications"
          type="checkbox"
          checked={electionNotifications}
          onChange={(e) => setElectionNotifications(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <Label htmlFor="election_notifications" className="cursor-pointer text-sm">
          Notify me when new election questions are added for my constituency
        </Label>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 rounded bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-800">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Stance Capture is a neutral civic intelligence platform. We are not affiliated with any
          political party, candidate, or electoral body. Your constituency is used only to
          geo-target relevant election questions — it is never shared with third parties.
        </span>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || !selectedConstituencyId || !hasChanged}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : saved ? (
            <CheckCircle2 className="h-4 w-4 mr-2 text-green-400" />
          ) : (
            <MapPin className="h-4 w-4 mr-2" />
          )}
          {saved ? "Saved" : "Save Constituency"}
        </Button>
        {!selectedConstituencyId && (
          <p className="text-xs text-muted-foreground">Select a constituency above to save.</p>
        )}
      </div>
    </div>
  );
}
