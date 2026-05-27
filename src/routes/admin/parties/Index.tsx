// src/routes/admin/parties/Index.tsx
//
// Admin: Party Library (Epic EL — Phase EL-2)
//
// Sections:
//   1. Party list — all parties with type badge, brand colour swatch,
//      regional presence count, alliance membership
//   2. Create party dialog — name, abbreviation, type, brand colour,
//      ECI registration ID, regional presence
//   3. Regional Presence Manager — per-party state presence,
//      restricts candidate creation (EL-P-007, EL-QA-P02)
//   4. Alliance Manager — link member parties to ALLIANCE entities
//      (EL-IN-004, EL-QA-G04)
//
// QA gates:
//   EL-QA-P01: party record reused across elections without re-entry
//   EL-QA-P02: regional presence restricts candidate creation to correct states
//   EL-QA-G04: alliance question card shows all member party logos

import * as React from "react";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Loader2,
  Plus,
  ChevronDown,
  ChevronRight,
  Users,
  MapPin,
  Link2,
  Pencil,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PartyType = "PARTY" | "ALLIANCE" | "INDEPENDENT";

type Party = {
  id: string;
  country: string;
  party_type: PartyType;
  name: string;
  abbreviation: string;
  name_local: string | null;
  eci_party_id: string | null;
  brand_colour: string | null;
  logo_path: string | null;
  symbol_path: string | null;
  description: string | null;
  website_url: string | null;
  is_active: boolean;
  created_at: string;
};

type RegionRow = {
  id: string;
  party_id: string;
  state_code: string;
  state_name: string;
  tier_codes: string[];
};

type AllianceMember = {
  id: string;
  alliance_party_id: string;
  member_party_id: string;
  state_code: string | null;
  role: string;
  member?: Party;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const UP_STATE = { code: "IN-UP", name: "Uttar Pradesh" };

const PARTY_TYPE_STYLES: Record<PartyType, string> = {
  PARTY:       "bg-blue-50 text-blue-700 border-blue-200",
  ALLIANCE:    "bg-violet-50 text-violet-700 border-violet-200",
  INDEPENDENT: "bg-gray-50 text-gray-600 border-gray-200",
};

// ─── Colour swatch ────────────────────────────────────────────────────────────

function ColourSwatch({ colour }: { colour: string | null }) {
  if (!colour) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-4 w-4 rounded-sm border border-black/10 shrink-0"
        style={{ backgroundColor: colour }}
      />
      <span className="text-xs font-mono">{colour}</span>
    </span>
  );
}

// ─── Regional Presence Panel ──────────────────────────────────────────────────

function RegionalPresencePanel({
  party,
  onClose,
}: {
  party: Party;
  onClose: () => void;
}) {
  const sb = getSupabase()!;
  const { toast } = useToast();
  const [regions, setRegions] = React.useState<RegionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [newState, setNewState] = React.useState(UP_STATE.code);
  const [newStateName, setNewStateName] = React.useState(UP_STATE.name);

  const fetch = React.useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from("election_party_regions")
      .select("*")
      .eq("party_id", party.id)
      .order("state_name");
    setRegions(data ?? []);
    setLoading(false);
  }, [sb, party.id]);

  React.useEffect(() => { fetch(); }, [fetch]);

  const addRegion = async () => {
    if (!newState.trim()) return;
    setAdding(true);
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://","")?.split(".")[0] ?? "";
      let jwt = anonKey;
      try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/election_party_regions`, {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify({
          party_id: party.id,
          state_code: newState.trim(),
          state_name: newStateName.trim() || newState.trim(),
          tier_codes: ["IN_VIDHAN_SABHA"],
        }),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({ title: "Region added" });
      fetch();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setAdding(false); }
  };

  const removeRegion = async (regionId: string) => {
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://","")?.split(".")[0] ?? "";
    let jwt = anonKey;
    try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/election_party_regions?id=eq.${regionId}`, {
      method: "DELETE",
      headers: { "apikey": anonKey, "Authorization": `Bearer ${jwt}` },
    });
    fetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Regional Presence — {party.abbreviation}</p>
          <p className="text-xs text-muted-foreground">
            Defines which states this party contests in. Restricts candidate creation (EL-P-007).
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : regions.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No regional presence configured.</p>
      ) : (
        <div className="divide-y rounded border text-sm">
          {regions.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <span className="font-medium">{r.state_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{r.state_code}</span>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {r.tier_codes.map((t) => (
                    <span key={t} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0 rounded">
                      {t.replace("IN_","").replace("US_","").replace(/_/g," ")}
                    </span>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRegion(r.id)}>
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add region */}
      <div className="rounded border p-3 space-y-3 bg-muted/30">
        <p className="text-xs font-medium">Add State Presence</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">State Code</Label>
            <Input
              placeholder="e.g. IN-UP"
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">State Name</Label>
            <Input
              placeholder="e.g. Uttar Pradesh"
              value={newStateName}
              onChange={(e) => setNewStateName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <Button size="sm" onClick={addRegion} disabled={adding} className="w-full">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
          Add
        </Button>
      </div>
    </div>
  );
}

// ─── Alliance Members Panel ────────────────────────────────────────────────────

function AllianceMembersPanel({
  alliance,
  allParties,
  onClose,
}: {
  alliance: Party;
  allParties: Party[];
  onClose: () => void;
}) {
  const sb = getSupabase()!;
  const { toast } = useToast();
  const [members, setMembers] = React.useState<AllianceMember[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [selectedMemberId, setSelectedMemberId] = React.useState("");
  const [selectedRole, setSelectedRole] = React.useState("PARTNER");

  const fetchMembers = React.useCallback(async () => {
    setLoading(true);
    const { data } = await sb
      .from("party_alliance_members")
      .select("*")
      .eq("alliance_party_id", alliance.id)
      .is("valid_to", null)
      .order("role");
    // Enrich with party data
    const enriched = (data ?? []).map((m: AllianceMember) => ({
      ...m,
      member: allParties.find((p) => p.id === m.member_party_id),
    }));
    setMembers(enriched);
    setLoading(false);
  }, [sb, alliance.id, allParties]);

  React.useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const addMember = async () => {
    if (!selectedMemberId) return;
    setAdding(true);
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://","")?.split(".")[0] ?? "";
      let jwt = anonKey;
      try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/party_alliance_members`, {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify({
          alliance_party_id: alliance.id,
          member_party_id: selectedMemberId,
          state_code: "IN-UP",
          role: selectedRole,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({ title: "Member added" });
      fetchMembers();
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally { setAdding(false); }
  };

  const eligibleParties = allParties.filter(
    (p) => p.party_type === "PARTY" && p.id !== alliance.id && !members.some((m) => m.member_party_id === p.id)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Alliance Members — {alliance.abbreviation}</p>
          <p className="text-xs text-muted-foreground">
            Member parties shown together on alliance question cards (EL-QA-G04).
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : members.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No members linked yet.</p>
      ) : (
        <div className="divide-y rounded border text-sm">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2">
              {m.member?.brand_colour && (
                <span
                  className="h-3 w-3 rounded-full shrink-0 border border-black/10"
                  style={{ backgroundColor: m.member.brand_colour }}
                />
              )}
              <div className="flex-1 min-w-0">
                <span className="font-medium">{m.member?.name ?? m.member_party_id}</span>
                <span className="ml-2 text-xs text-muted-foreground">{m.member?.abbreviation}</span>
              </div>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                m.role === "LEADER"
                  ? "bg-amber-50 text-amber-700 border-amber-300"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}>
                {m.role}
              </span>
            </div>
          ))}
        </div>
      )}

      {eligibleParties.length > 0 && (
        <div className="rounded border p-3 space-y-3 bg-muted/30">
          <p className="text-xs font-medium">Add Member Party</p>
          <div className="grid grid-cols-2 gap-2">
            <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select party" /></SelectTrigger>
              <SelectContent>
                {eligibleParties.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">{p.name} ({p.abbreviation})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LEADER" className="text-xs">Leader</SelectItem>
                <SelectItem value="PARTNER" className="text-xs">Partner</SelectItem>
                <SelectItem value="OUTSIDE_SUPPORT" className="text-xs">Outside Support</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={addMember} disabled={adding || !selectedMemberId} className="w-full">
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            Add Member
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Create Party Dialog ───────────────────────────────────────────────────────

type CreatePartyForm = {
  party_type: PartyType;
  name: string;
  abbreviation: string;
  name_local: string;
  eci_party_id: string;
  brand_colour: string;
  description: string;
  website_url: string;
};

const DEFAULT_CREATE: CreatePartyForm = {
  party_type: "PARTY",
  name: "",
  abbreviation: "",
  name_local: "",
  eci_party_id: "",
  brand_colour: "",
  description: "",
  website_url: "",
};

function CreatePartyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState<CreatePartyForm>(DEFAULT_CREATE);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (patch: Partial<CreatePartyForm>) => { setForm((p) => ({ ...p, ...patch })); setError(null); };

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError("Party name is required."); return; }
    if (!form.abbreviation.trim()) { setError("Abbreviation is required."); return; }
    if (form.brand_colour && !/^#[0-9A-Fa-f]{6}$/.test(form.brand_colour)) {
      setError("Brand colour must be a valid hex code, e.g. #FF9933"); return;
    }
    setSaving(true);
    setError(null);
    try {
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const projectRef = import.meta.env.VITE_SUPABASE_URL?.replace("https://","")?.split(".")[0] ?? "";
      let jwt = anonKey;
      try { const r = localStorage.getItem(`sb-${projectRef}-auth-token`); if (r) { const p = JSON.parse(r); if (p?.access_token) jwt = p.access_token; } } catch {}
      const payload: Record<string,any> = {
        country: "IN",
        party_type: form.party_type,
        name: form.name.trim(),
        abbreviation: form.abbreviation.trim().toUpperCase(),
        name_local: form.name_local.trim() || null,
        eci_party_id: form.eci_party_id.trim() || null,
        brand_colour: form.brand_colour.trim() || null,
        description: form.description.trim() || null,
        website_url: form.website_url.trim() || null,
        is_active: true,
      };
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/election_parties`, {
        method: "POST",
        headers: { "Content-Type":"application/json","apikey":anonKey,"Authorization":`Bearer ${jwt}`,"Prefer":"return=minimal" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const b = await res.json().catch(()=>{}); throw new Error(b?.message ?? `HTTP ${res.status}`); }
      toast({ title: "Party created", description: `${form.name} (${form.abbreviation})` });
      setForm(DEFAULT_CREATE);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Party / Alliance</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Type *</Label>
            <Select value={form.party_type} onValueChange={(v) => set({ party_type: v as PartyType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PARTY">Party</SelectItem>
                <SelectItem value="ALLIANCE">Alliance (NDA, INDIA bloc, etc.)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full Name *</Label>
              <Input placeholder="Bharatiya Janata Party" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Abbreviation *</Label>
              <Input placeholder="BJP" value={form.abbreviation} onChange={(e) => set({ abbreviation: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Name in Hindi</Label>
            <Input placeholder="भारतीय जनता पार्टी" value={form.name_local} onChange={(e) => set({ name_local: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>ECI Party ID</Label>
              <Input placeholder="ECI registration number" value={form.eci_party_id} onChange={(e) => set({ eci_party_id: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Brand Colour</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="#FF9933"
                  value={form.brand_colour}
                  onChange={(e) => set({ brand_colour: e.target.value })}
                  className="flex-1"
                />
                {/^#[0-9A-Fa-f]{6}$/.test(form.brand_colour) && (
                  <span className="h-9 w-9 rounded border border-black/10 shrink-0" style={{ backgroundColor: form.brand_colour }} />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Use verified official colour — do not infer from logo.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} placeholder="Brief description of the party…" value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Party Row ─────────────────────────────────────────────────────────────────

function PartyRow({
  party,
  allParties,
  onRefresh,
}: {
  party: Party;
  allParties: Party[];
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [panel, setPanel] = React.useState<"regions" | "alliance" | null>(null);

  const togglePanel = (p: "regions" | "alliance") => {
    if (panel === p) { setPanel(null); setExpanded(false); return; }
    setPanel(p); setExpanded(true);
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Colour swatch */}
        <span
          className="h-8 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: party.brand_colour ?? "#e5e7eb" }}
        />

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{party.name}</span>
            <span className="text-xs text-muted-foreground font-mono">{party.abbreviation}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${PARTY_TYPE_STYLES[party.party_type]}`}>
              {party.party_type}
            </span>
            {!party.is_active && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-500 border-gray-200">INACTIVE</span>
            )}
          </div>
          {party.name_local && (
            <p className="text-xs text-muted-foreground mt-0.5">{party.name_local}</p>
          )}
        </div>

        {/* Colour */}
        <div className="hidden sm:block shrink-0">
          <ColourSwatch colour={party.brand_colour} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant={panel === "regions" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => togglePanel("regions")}
          >
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Regions</span>
          </Button>
          {party.party_type === "ALLIANCE" && (
            <Button
              variant={panel === "alliance" ? "default" : "ghost"}
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => togglePanel("alliance")}
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Members</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Expandable panel */}
      {expanded && panel && (
        <div className="border-t bg-muted/20 px-4 py-4">
          {panel === "regions" && (
            <RegionalPresencePanel
              party={party}
              onClose={() => { setPanel(null); setExpanded(false); }}
            />
          )}
          {panel === "alliance" && party.party_type === "ALLIANCE" && (
            <AllianceMembersPanel
              alliance={party}
              allParties={allParties}
              onClose={() => { setPanel(null); setExpanded(false); }}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPartiesPage() {
  const sb = getSupabase()!;
  const { toast } = useToast();

  const [parties, setParties] = React.useState<Party[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<"all" | "PARTY" | "ALLIANCE">("all");
  const [search, setSearch] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);

  const fetchParties = React.useCallback(async () => {
    setLoading(true);
    try {
      let q = sb.from("election_parties").select("*").eq("country", "IN").order("party_type").order("name");
      if (filter !== "all") q = q.eq("party_type", filter);
      const { data, error } = await q;
      if (error) throw error;
      setParties(data ?? []);
    } catch (e: any) {
      toast({ title: "Failed to load parties", description: e.message, variant: "destructive" });
    } finally { setLoading(false); }
  }, [sb, filter, toast]);

  React.useEffect(() => { fetchParties(); }, [fetchParties]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return parties;
    const q = search.toLowerCase();
    return parties.filter(
      (p) => p.name.toLowerCase().includes(q) || p.abbreviation.toLowerCase().includes(q)
    );
  }, [parties, search]);

  const filterTabs: { value: typeof filter; label: string }[] = [
    { value: "all",      label: "All" },
    { value: "PARTY",    label: "Parties" },
    { value: "ALLIANCE", label: "Alliances" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Party Library</h1>
            <p className="text-xs text-muted-foreground">
              Epic EL-2 · Master party records — reused across elections without re-entry
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={fetchParties} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Party
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2">
          {filterTabs.map((f) => (
            <Button key={f.value} variant={filter === f.value ? "default" : "outline"} size="sm" onClick={() => setFilter(f.value)}>
              {f.label}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Search name or abbreviation…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-56 text-sm"
        />
      </div>

      {/* Party list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading parties…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground space-y-3">
          <Users className="h-8 w-8 mx-auto opacity-30" />
          <p className="text-sm">No parties found.</p>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>Add first party</Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PartyRow key={p.id} party={p} allParties={parties} onRefresh={fetchParties} />
          ))}
        </div>
      )}

      <CreatePartyDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchParties}
      />
    </div>
  );
}
