// src/routes/admin/elections/New.tsx
//
// Admin: Election Creation Wizard (Epic EL — Phase EL-1)
//
// 5-step wizard to create a new election record.
//
// Step 1 — Tier & Type
//   Select tier (Vidhan Sabha active; others inactive/deferred).
//   Select election subtype (GENERAL, BY_ELECTION, SNAP, etc.).
//   Snap elections: relaxed setup, no 5-month lead time (EL-QA-G07).
//
// Step 2 — Name & Geography
//   Election name, governing body code.
//   Multi-phase config: is this a phase of a larger election?
//
// Step 3 — Key Dates
//   Announced, campaign start, MCC start (India ECI only), polling start/end.
//   All stored UTC. Validation: dates must be in correct order.
//
// Step 4 — Compliance
//   Disclosure text, anti-funding disclaimer.
//   Legal review gate: checkbox with acknowledgement.
//   EL-F-006 / EL-QA-007: election cannot go ACTIVE without this.
//
// Step 5 — Review & Create
//   Summary of all inputs. Submit to elections table via rpcFetch pattern
//   (avoids auth mutex bug — uses JWT from localStorage directly).
//
// QA gates: EL-QA-001 (Lok Sabha), EL-QA-002 (Vidhan Sabha),
//           EL-QA-007 (legal gate), EL-QA-G07 (snap election)

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_PROJECT_REF, getJwt } from "@/lib/env";
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  Vote,
  Info,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_TIERS = [
  { code: "IN_VIDHAN_SABHA", label: "Vidhan Sabha (State Assembly)", country: "IN", hasMcc: true },
];

const DEFERRED_TIERS = [
  { code: "IN_LOK_SABHA",    label: "Lok Sabha (Parliament) — Deferred",    country: "IN", hasMcc: true },
  { code: "US_PRESIDENTIAL", label: "US Presidential — Deferred",           country: "US", hasMcc: false },
  { code: "US_SENATE",       label: "US Senate — Deferred",                  country: "US", hasMcc: false },
  { code: "US_HOUSE",        label: "US House of Representatives — Deferred",country: "US", hasMcc: false },
  { code: "US_GOVERNOR",     label: "US Governor — Deferred",                country: "US", hasMcc: false },
  { code: "US_STATE_SENATE", label: "US State Senate — Deferred",            country: "US", hasMcc: false },
  { code: "US_STATE_HOUSE",  label: "US State House — Deferred",             country: "US", hasMcc: false },
];

const SUBTYPES = [
  { value: "GENERAL",    label: "General Election" },
  { value: "BY_ELECTION",label: "By-Election" },
  { value: "SNAP",       label: "Snap Election (relaxed 48h setup)" },
];

const TOTAL_STEPS = 5;

// ─── Form state ───────────────────────────────────────────────────────────────

type WizardState = {
  // Step 1
  tier_code: string;
  country: string;
  election_subtype: string;
  is_snap: boolean;
  has_mcc: boolean;

  // Step 2
  name: string;
  governing_body_code: string;
  is_multi_phase: boolean;
  phase_number: string;
  total_phases: string;
  phase_label: string;
  parent_election_id: string;

  // Step 3
  announced_at: string;
  campaign_start_at: string;
  mcc_start_at: string;
  polling_start_at: string;
  polling_end_at: string;

  // Step 4
  disclosure_text: string;
  anti_funding_disclaimer: string;
  legal_review_completed: boolean;
  legal_review_notes: string;

  // Step 5 — no extra fields, review only
};

const DEFAULT_STATE: WizardState = {
  tier_code: "IN_VIDHAN_SABHA",
  country: "IN",
  election_subtype: "GENERAL",
  is_snap: false,
  has_mcc: true,
  name: "",
  governing_body_code: "",
  is_multi_phase: false,
  phase_number: "1",
  total_phases: "1",
  phase_label: "",
  parent_election_id: "",
  announced_at: "",
  campaign_start_at: "",
  mcc_start_at: "",
  polling_start_at: "",
  polling_end_at: "",
  disclosure_text:
    "Stance Capture is a neutral civic intelligence platform. We are not affiliated with any political party, candidate, or electoral body.",
  anti_funding_disclaimer:
    "This platform accepts no payment from political parties, candidates, or electoral bodies. All content is independently generated.",
  legal_review_completed: false,
  legal_review_notes: "",
};

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = [
  "Tier & Type",
  "Name & Geography",
  "Key Dates",
  "Compliance",
  "Review & Create",
];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <React.Fragment key={step}>
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  done
                    ? "bg-primary border-primary text-primary-foreground"
                    : active
                    ? "border-primary text-primary bg-background"
                    : "border-muted text-muted-foreground bg-background"
                }`}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : step}
              </div>
              <span
                className={`text-xs whitespace-nowrap ${
                  active ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className="h-px w-4 bg-border shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Step 1: Tier & Type ──────────────────────────────────────────────────────

function Step1({
  form,
  onChange,
}: {
  form: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const handleTierChange = (code: string) => {
    const all = [...ACTIVE_TIERS, ...DEFERRED_TIERS];
    const tier = all.find((t) => t.code === code);
    onChange({
      tier_code: code,
      country: tier?.country ?? "IN",
      has_mcc: tier?.hasMcc ?? false,
      // Clear MCC date if switching to non-MCC tier
      mcc_start_at: tier?.hasMcc ? form.mcc_start_at : "",
    });
  };

  const handleSubtypeChange = (value: string) => {
    onChange({
      election_subtype: value,
      is_snap: value === "SNAP",
    });
  };

  return (
    <div className="space-y-5">
      {/* Active tiers */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Election Tier *</Label>
        <Select value={form.tier_code} onValueChange={handleTierChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Active (India Priority)
            </div>
            {ACTIVE_TIERS.map((t) => (
              <SelectItem key={t.code} value={t.code}>
                {t.label}
              </SelectItem>
            ))}
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1">
              Deferred — schema available
            </div>
            {DEFERRED_TIERS.map((t) => (
              <SelectItem key={t.code} value={t.code} className="text-muted-foreground">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only <strong>Vidhan Sabha</strong> is active for this launch. Other tiers are available in schema but deferred.
        </p>
      </div>

      {/* Subtype */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Election Type *</Label>
        <Select value={form.election_subtype} onValueChange={handleSubtypeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBTYPES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Snap warning */}
      {form.is_snap && (
        <div className="flex items-start gap-2 rounded bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>Snap Election:</strong> Minimum 48-hour setup enforced (EL-QA-G07).
            Standard 5-month lead time is waived. Legal review still required before going Active.
          </span>
        </div>
      )}

      {/* MCC indicator */}
      {form.has_mcc && (
        <div className="flex items-center gap-2 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
          <Info className="h-3.5 w-3.5 shrink-0" />
          This tier uses the ECI Model Code of Conduct. MCC start date required in Step 3.
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Name & Geography ─────────────────────────────────────────────────

function Step2({
  form,
  onChange,
}: {
  form: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Election name */}
      <div className="space-y-2">
        <Label htmlFor="name" className="text-sm font-medium">
          Election Name *
        </Label>
        <Input
          id="name"
          placeholder="e.g. Uttar Pradesh Vidhan Sabha 2027"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Include state name and year. This appears in admin UI and compliance logs.
        </p>
      </div>

      {/* Governing body */}
      <div className="space-y-2">
        <Label htmlFor="governing_body_code" className="text-sm font-medium">
          Governing Body Code
        </Label>
        <Input
          id="governing_body_code"
          placeholder="e.g. UP_LEGISLATIVE_ASSEMBLY"
          value={form.governing_body_code}
          onChange={(e) => onChange({ governing_body_code: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Internal identifier for the legislative body this election fills seats for.
        </p>
      </div>

      {/* Multi-phase */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            id="is_multi_phase"
            type="checkbox"
            checked={form.is_multi_phase}
            onChange={(e) => onChange({ is_multi_phase: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300"
          />
          <Label htmlFor="is_multi_phase" className="text-sm font-medium cursor-pointer">
            This is a phase of a multi-phase election
          </Label>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          UP Vidhan Sabha typically runs in 7 phases. Each phase is a separate election record
          pointing to a parent (Phase 1). Silence is enforced per-constituency.
        </p>
      </div>

      {/* Phase fields — shown only if multi-phase */}
      {form.is_multi_phase && (
        <div className="space-y-4 pl-4 border-l-2 border-blue-200">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phase_number" className="text-sm font-medium">
                Phase Number *
              </Label>
              <Input
                id="phase_number"
                type="number"
                min={1}
                value={form.phase_number}
                onChange={(e) => onChange({ phase_number: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="total_phases" className="text-sm font-medium">
                Total Phases *
              </Label>
              <Input
                id="total_phases"
                type="number"
                min={2}
                value={form.total_phases}
                onChange={(e) => onChange({ total_phases: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phase_label" className="text-sm font-medium">
              Phase Label
            </Label>
            <Input
              id="phase_label"
              placeholder="e.g. Western UP — Districts 1-7"
              value={form.phase_label}
              onChange={(e) => onChange({ phase_label: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parent_election_id" className="text-sm font-medium">
              Parent Election ID
            </Label>
            <Input
              id="parent_election_id"
              placeholder="UUID of Phase 1 election record"
              value={form.parent_election_id}
              onChange={(e) => onChange({ parent_election_id: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Required for phases 2+. Leave blank if creating Phase 1.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Key Dates ─────────────────────────────────────────────────────────

function Step3({
  form,
  onChange,
}: {
  form: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        All dates are stored in UTC. The admin UI displays in local time but the database
        always stores UTC. Silence windows are computed server-side by the pg_cron job (EL-6).
      </div>

      {/* Announced */}
      <div className="space-y-2">
        <Label htmlFor="announced_at" className="text-sm font-medium">
          Announced Date
        </Label>
        <Input
          id="announced_at"
          type="datetime-local"
          value={form.announced_at}
          onChange={(e) => onChange({ announced_at: e.target.value })}
        />
      </div>

      {/* Campaign start */}
      <div className="space-y-2">
        <Label htmlFor="campaign_start_at" className="text-sm font-medium">
          Campaign Opens
        </Label>
        <Input
          id="campaign_start_at"
          type="datetime-local"
          value={form.campaign_start_at}
          onChange={(e) => onChange({ campaign_start_at: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Date from which stances are accepted. Election moves to CAMPAIGN_ACTIVE on this date.
        </p>
      </div>

      {/* MCC — India ECI only */}
      {form.has_mcc && (
        <div className="space-y-2">
          <Label htmlFor="mcc_start_at" className="text-sm font-medium">
            MCC Start Date *
          </Label>
          <Input
            id="mcc_start_at"
            type="datetime-local"
            value={form.mcc_start_at}
            onChange={(e) => onChange({ mcc_start_at: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Model Code of Conduct start. The silence window begins at MIN(MCC start, polling start − 48h).
            Set by ECI — do not guess; use the official ECI schedule notification.
          </p>
        </div>
      )}

      {/* Polling start */}
      <div className="space-y-2">
        <Label htmlFor="polling_start_at" className="text-sm font-medium">
          Polling Start *
        </Label>
        <Input
          id="polling_start_at"
          type="datetime-local"
          value={form.polling_start_at}
          onChange={(e) => onChange({ polling_start_at: e.target.value })}
        />
      </div>

      {/* Polling end */}
      <div className="space-y-2">
        <Label htmlFor="polling_end_at" className="text-sm font-medium">
          Polling End
        </Label>
        <Input
          id="polling_end_at"
          type="datetime-local"
          value={form.polling_end_at}
          onChange={(e) => onChange({ polling_end_at: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank if single-day polling. For multi-day, enter last polling day.
          Exit poll gating (RPA 126A) triggers off this date + 30 min.
        </p>
      </div>
    </div>
  );
}

// ─── Step 4: Compliance ───────────────────────────────────────────────────────

function Step4({
  form,
  onChange,
}: {
  form: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Disclosure text */}
      <div className="space-y-2">
        <Label htmlFor="disclosure_text" className="text-sm font-medium">
          Disclosure Text *
        </Label>
        <Textarea
          id="disclosure_text"
          rows={3}
          value={form.disclosure_text}
          onChange={(e) => onChange({ disclosure_text: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Shown in the footer of all election question cards. Required by ECI / Section 126B guidelines.
        </p>
      </div>

      {/* Anti-funding disclaimer */}
      <div className="space-y-2">
        <Label htmlFor="anti_funding_disclaimer" className="text-sm font-medium">
          Anti-Funding Disclaimer *
        </Label>
        <Textarea
          id="anti_funding_disclaimer"
          rows={3}
          value={form.anti_funding_disclaimer}
          onChange={(e) => onChange({ anti_funding_disclaimer: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          EL-IN-015: confirms platform accepts no payment from political parties or candidates.
        </p>
      </div>

      {/* Legal review gate */}
      <div className="rounded border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
          <span className="text-sm font-semibold text-amber-900">
            Legal Review Gate (EL-F-006)
          </span>
        </div>
        <p className="text-xs text-amber-800">
          By checking this box you confirm that formal legal review has been completed
          for this election's compliance setup. The election cannot transition from UPCOMING
          to CAMPAIGN_ACTIVE without this confirmation. This acknowledgement is
          permanently recorded in the audit log.
        </p>

        <div className="flex items-start gap-2">
          <input
            id="legal_review_completed"
            type="checkbox"
            checked={form.legal_review_completed}
            onChange={(e) => onChange({ legal_review_completed: e.target.checked })}
            className="h-4 w-4 rounded border-amber-400 mt-0.5"
          />
          <Label
            htmlFor="legal_review_completed"
            className="text-xs text-amber-900 cursor-pointer font-medium leading-relaxed"
          >
            I confirm that formal legal review has been completed and this election complies
            with applicable electoral law (RPA 1951, MCC, ECI guidelines for India;
            FECA/BCRA and FEC advisory opinions for USA).
          </Label>
        </div>

        {form.legal_review_completed && (
          <div className="space-y-2">
            <Label htmlFor="legal_review_notes" className="text-xs font-medium text-amber-900">
              Legal Review Notes / Reference
            </Label>
            <Textarea
              id="legal_review_notes"
              rows={2}
              placeholder="e.g. Reviewed by [Counsel Name], opinion dated [date], reference [file/case number]"
              value={form.legal_review_notes}
              onChange={(e) => onChange({ legal_review_notes: e.target.value })}
              className="text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step 5: Review ────────────────────────────────────────────────────────────

function Step5({ form }: { form: WizardState }) {
  const allTiers = [...ACTIVE_TIERS, ...DEFERRED_TIERS];
  const tierLabel = allTiers.find((t) => t.code === form.tier_code)?.label ?? form.tier_code;
  const subtypeLabel = SUBTYPES.find((s) => s.value === form.election_subtype)?.label ?? form.election_subtype;

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: "Tier",           value: tierLabel },
    { label: "Type",           value: subtypeLabel },
    { label: "Name",           value: form.name || "—", warn: !form.name },
    { label: "Governing Body", value: form.governing_body_code || "—" },
    { label: "Multi-phase",    value: form.is_multi_phase ? `Phase ${form.phase_number} of ${form.total_phases}` : "No" },
    ...(form.phase_label ? [{ label: "Phase Label", value: form.phase_label }] : []),
    { label: "Announced",      value: form.announced_at ? new Date(form.announced_at).toLocaleString("en-IN") : "—" },
    { label: "Campaign Opens", value: form.campaign_start_at ? new Date(form.campaign_start_at).toLocaleString("en-IN") : "—" },
    ...(form.has_mcc ? [{ label: "MCC Start", value: form.mcc_start_at ? new Date(form.mcc_start_at).toLocaleString("en-IN") : "—", warn: !form.mcc_start_at }] : []),
    { label: "Polling Start",  value: form.polling_start_at ? new Date(form.polling_start_at).toLocaleString("en-IN") : "—", warn: !form.polling_start_at },
    { label: "Polling End",    value: form.polling_end_at ? new Date(form.polling_end_at).toLocaleString("en-IN") : "—" },
    {
      label: "Legal Review",
      value: form.legal_review_completed ? "✓ Completed" : "✗ NOT completed — election will be created in UPCOMING state and cannot advance",
      warn: !form.legal_review_completed,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review all details before creating. The election will be created in{" "}
        <strong>UPCOMING</strong> state.
        {form.legal_review_completed
          ? " It can be advanced to Campaign Active once ready."
          : " It cannot advance beyond UPCOMING until legal review is marked complete."}
      </p>

      <div className="rounded border divide-y text-sm">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-3 px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">{r.label}</span>
            <span className={`col-span-2 text-xs ${r.warn ? "text-amber-700 font-medium" : ""}`}>
              {r.value}
            </span>
          </div>
        ))}
      </div>

      {!form.name && (
        <div className="flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          Election name is required. Go back to Step 2.
        </div>
      )}

      {form.has_mcc && !form.mcc_start_at && (
        <div className="flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          MCC start date is required for ECI elections. Go back to Step 3.
        </div>
      )}

      {!form.polling_start_at && (
        <div className="flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          Polling start date is required. Go back to Step 3.
        </div>
      )}
    </div>
  );
}

// ─── Validation per step ──────────────────────────────────────────────────────

function validateStep(step: number, form: WizardState): string | null {
  if (step === 1) {
    if (!form.tier_code) return "Please select an election tier.";
  }
  if (step === 2) {
    if (!form.name.trim()) return "Election name is required.";
    if (form.is_multi_phase && parseInt(form.phase_number) > 1 && !form.parent_election_id.trim()) {
      return "Parent Election ID is required for phases 2+.";
    }
  }
  if (step === 3) {
    if (!form.polling_start_at) return "Polling start date is required.";
    if (form.has_mcc && !form.mcc_start_at) return "MCC start date is required for ECI elections.";
    if (form.polling_end_at && form.polling_start_at && form.polling_end_at < form.polling_start_at) {
      return "Polling end date must be on or after polling start date.";
    }
  }
  if (step === 4) {
    if (!form.disclosure_text.trim()) return "Disclosure text is required.";
    if (!form.anti_funding_disclaimer.trim()) return "Anti-funding disclaimer is required.";
  }
  return null;
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function AdminElectionNewPage() {
  const navigate = useNavigate();
  const sb = getSupabase()!;
  const { toast } = useToast();

  const [step, setStep] = React.useState(1);
  const [form, setForm] = React.useState<WizardState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = React.useState(false);
  const [stepError, setStepError] = React.useState<string | null>(null);

  const onChange = (patch: Partial<WizardState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setStepError(null);
  };

  const handleNext = () => {
    const err = validateStep(step, form);
    if (err) { setStepError(err); return; }
    setStepError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };

  const handleBack = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 1));
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const err = validateStep(5, form);
    if (err) { setStepError(err); return; }

    setSubmitting(true);
    setStepError(null);

    try {
      // ── rpcFetch pattern throughout — never use sb.* for mutations ──────────
      // Avoids Supabase JS auth mutex bug (getSession() lock blocks all SDK calls)
      const projectRef = SUPABASE_URL
        ?.replace("https://", "")
        ?.split(".")[0] ?? "";
      const anonKey = SUPABASE_ANON_KEY;
      const supabaseUrl = SUPABASE_URL;

      let jwt = anonKey;
      try {
        const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.access_token) jwt = parsed.access_token;
        }
      } catch { /* use anon fallback */ }

      const restHeaders = {
        "Content-Type": "application/json",
        "apikey":        anonKey,
        "Authorization": `Bearer ${jwt}`,
      };

      // Look up tier_id via raw fetch — never through SDK
      const tierRes = await fetch(
        `${supabaseUrl}/rest/v1/election_tiers?tier_code=eq.${form.tier_code}&select=id,tier_code,country&limit=1`,
        { headers: restHeaders }
      );
      if (!tierRes.ok) throw new Error(`Tier lookup failed: HTTP ${tierRes.status}`);
      const tierRows = await tierRes.json();
      if (!tierRows.length) throw new Error(`Tier not found: ${form.tier_code}`);
      const tierRow = tierRows[0];

      // Build insert payload
      const payload: Record<string, any> = {
        tier_id:              tierRow.id,
        tier_code:            form.tier_code,
        country:              tierRow.country,
        name:                 form.name.trim(),
        election_subtype:     form.election_subtype,
        is_snap:              form.is_snap,
        state:                "UPCOMING",
        legal_review_completed: form.legal_review_completed,
        legal_review_notes:   form.legal_review_notes.trim() || null,
        disclosure_text:      form.disclosure_text.trim(),
        anti_funding_disclaimer: form.anti_funding_disclaimer.trim(),
        governing_body_code:  form.governing_body_code.trim() || null,
        ai_generation_enabled: true,
      };

      // Dates — convert local datetime-local to UTC ISO strings
      const toUTC = (v: string) => v ? new Date(v).toISOString() : null;
      payload.announced_at      = toUTC(form.announced_at);
      payload.campaign_start_at = toUTC(form.campaign_start_at);
      payload.mcc_start_at      = form.has_mcc ? toUTC(form.mcc_start_at) : null;
      payload.polling_start_at  = toUTC(form.polling_start_at);
      payload.polling_end_at    = toUTC(form.polling_end_at) || toUTC(form.polling_start_at);

      // Multi-phase
      if (form.is_multi_phase) {
        payload.phase_number    = parseInt(form.phase_number);
        payload.total_phases    = parseInt(form.total_phases);
        payload.phase_label     = form.phase_label.trim() || null;
        payload.parent_election_id = form.parent_election_id.trim() || null;
      }

      // Use rpcFetch pattern — raw fetch already set up above
      const res = await fetch(`${supabaseUrl}/rest/v1/elections`, {
        method: "POST",
        headers: { ...restHeaders, "Prefer": "return=representation" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }

      const created = await res.json();
      const electionId = Array.isArray(created) ? created[0]?.id : created?.id;

      toast({
        title: "Election created",
        description: `"${form.name}" is now in UPCOMING state.`,
      });

      navigate(`/admin/elections`);
    } catch (err: any) {
      setStepError(err.message ?? "Failed to create election.");
      toast({
        title: "Creation failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Vote className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">New Election</h1>
          <p className="text-xs text-muted-foreground">Election Creation Wizard · Epic EL-1</p>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Step content */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Step {step} — {STEP_LABELS[step - 1]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 1 && <Step1 form={form} onChange={onChange} />}
          {step === 2 && <Step2 form={form} onChange={onChange} />}
          {step === 3 && <Step3 form={form} onChange={onChange} />}
          {step === 4 && <Step4 form={form} onChange={onChange} />}
          {step === 5 && <Step5 form={form} />}

          {/* Step error */}
          {stepError && (
            <div className="mt-4 flex items-center gap-2 rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {stepError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={step === 1 || submitting}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>

        {step < TOTAL_STEPS ? (
          <Button onClick={handleNext} disabled={submitting}>
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting || !form.name.trim() || !form.polling_start_at}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Create Election
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
