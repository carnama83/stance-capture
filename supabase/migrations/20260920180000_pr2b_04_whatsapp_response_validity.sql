-- PR 2b.6 / D4 — WhatsApp response validity.
--
-- DECISION RECORDED (D4): a reply arriving AFTER its rendition was invalidated
-- is REJECTED and re-asked. At current volume (0 broadcasts, 5 WhatsApp stances
-- ever) that costs nothing, and adopting it later would mean either re-asking a
-- real cohort or living with a knowingly contaminated distribution.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BRIEF'S TIMESTAMP RULE CANNOT BE FOLLOWED LITERALLY HERE, AND THIS SAYS
-- WHY RATHER THAN SILENTLY SUBSTITUTING.
--
-- §2b.6 requires validity to be judged on "the provider-supplied inbound
-- message timestamp", never server receipt. That distinction is right for an
-- ASYNCHRONOUS message webhook, where a reply can sit queued and arrive late:
-- network delay must not reclassify someone who answered a valid instrument.
--
-- Stance submissions do not arrive that way. They come through
-- whatsapp-flow-endpoint as an encrypted Flow data_exchange — a synchronous
-- HTTP round trip whose payload carries action, flow_token and data, and NO
-- timestamp. Meta supplies messages[].timestamp on the Messages webhook, but
-- that path (whatsapp-flow-webhook) handles only opt-outs and delivery
-- receipts; it explicitly stopped handling stances.
--
-- So for this channel there is no provider timestamp to use, and server receipt
-- is not a lossy proxy for it — the exchange IS live, so receipt time and
-- submission time differ by request latency, not by queue time. The condition
-- the brief is protecting against does not arise.
--
-- provider_timestamp is therefore added NULLABLE and left unset by the Flow
-- path. If a non-Flow reply route is ever added, it has somewhere truthful to
-- put messages[].timestamp, and the validity rule can switch to it without a
-- migration. Storing both keeps clock skew auditable rather than invisible,
-- which is the durable half of the brief's intent.

alter table public.whatsapp_flow_sessions
  add column if not exists responded_at timestamptz,
  add column if not exists provider_timestamp timestamptz,
  add column if not exists response_outcome text;

alter table public.whatsapp_flow_sessions
  drop constraint if exists whatsapp_flow_sessions_outcome_chk;

alter table public.whatsapp_flow_sessions
  add constraint whatsapp_flow_sessions_outcome_chk
  check (response_outcome is null or response_outcome in ('recorded','rejected_invalidated'));

comment on column public.whatsapp_flow_sessions.responded_at is
  'Server receipt time of the Flow data_exchange. AUTHORITATIVE for validity on this channel: the exchange is a synchronous round trip, so this differs from the respondent''s submission by request latency rather than queue time.';
comment on column public.whatsapp_flow_sessions.provider_timestamp is
  'Provider-supplied inbound message timestamp. Always NULL for Flow submissions — Meta does not include one in the encrypted data_exchange payload. Reserved for a future non-Flow reply route, where messages[].timestamp exists and must take precedence over responded_at.';
comment on column public.whatsapp_flow_sessions.response_outcome is
  'recorded | rejected_invalidated. A rejection means the bound rendition had been withdrawn before the reply arrived, so the answer was NOT counted and the respondent was re-asked against current wording (D4).';

create index if not exists idx_whatsapp_flow_sessions_outcome
  on public.whatsapp_flow_sessions (response_outcome)
  where response_outcome is not null;

-- One place that decides, so the edge function cannot drift from the rule.
--
-- Deliberately mirrors the eligibility table in §2b.1 rather than inventing a
-- parallel one: published and superseded accept, invalidated rejects. A
-- superseded rendition is valid historical wording — the recipient genuinely
-- read it on the card that was sent to them — and rejecting it would discard
-- good measurements every time an admin published a routine correction.
create or replace function public.whatsapp_response_is_valid(p_rendition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select r.lifecycle_status in ('published','superseded')
     from public.question_renditions r
     where r.id = p_rendition_id),
    -- No bound rendition: a pre-f2_13 session. Accept, because rejecting a
    -- reply whose provenance we simply never captured would punish the
    -- respondent for our own gap.
    true);
$function$;

comment on function public.whatsapp_response_is_valid(uuid) is
  'Whether a WhatsApp reply against this rendition may be counted (D4). Accepts published and superseded — the recipient read what was on their card. Rejects invalidated: at response time the instrument is already known to be defective, and "accept and quarantine" is not defensible when that is known up front. NULL accepts, for pre-f2_13 sessions with no bound rendition.';
