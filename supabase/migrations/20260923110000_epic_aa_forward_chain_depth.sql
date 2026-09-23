-- Epic AA defect AA-10 (Dev reconciliation, 23 Sep 2026): forward chains never
-- got deeper than 1, and the caps were not enforced or logged.
--   * whatsapp-flow-endpoint created a child node for the inbound chain, but
--     gave the respondent a SEPARATE depth-0 root (no parent) to forward, so
--     the next hop always started a new tree;
--   * record_web_stance wrote parentless roots at depth 1 (0 + 1) and applied
--     neither the depth-10 nor the 500-children cap;
--   * hitting the 500 cap was never flagged.
--
-- Fix: one node per respondent per question. The node's parent is the chain
-- they arrived through, and it is also the ref they forward, so depth
-- accumulates. The decision is made in one place, resolve_forward_parent(),
-- used by both the web path and the Flow path:
--   * no or unknown inbound ref    -> new root, depth 0;
--   * parent at depth >= 10        -> new root (the tree stops growing deeper);
--   * parent with >= 500 children  -> new root, flagged ONCE in
--                                     whatsapp_webhook_errors for admin review;
--   * otherwise                    -> child at parent.depth + 1, parent counted.
-- At a cap the respondent still gets a node, because an anonymous web stance
-- needs one as its identity (question_stances_identity_check). It becomes a new
-- root rather than the spec's "no row at all".

create or replace function public.resolve_forward_parent(p_ref text, out parent_id text, out depth integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_depth int;
  v_children int;
begin
  parent_id := null;
  depth := 0;
  if p_ref is null then return; end if;

  select c.depth, c.child_stance_count into v_depth, v_children
    from public.whatsapp_forward_chains c where c.id = p_ref
    for update;
  if not found then return; end if;

  if v_depth >= 10 then
    return;  -- depth cap: start a new root
  end if;

  if v_children >= 500 then
    -- abuse cap: flag once per chain for admin review, then start a new root
    if not exists (select 1 from public.whatsapp_webhook_errors
                    where error_type = 'forward_chain_cap' and payload_preview = 'chain ' || p_ref) then
      insert into public.whatsapp_webhook_errors (error_type, payload_preview)
      values ('forward_chain_cap', 'chain ' || p_ref);
    end if;
    return;
  end if;

  update public.whatsapp_forward_chains set child_stance_count = child_stance_count + 1 where id = p_ref;
  parent_id := p_ref;
  depth := v_depth + 1;
end;
$function$;

-- The Flow path: return this respondent's node for the question, creating it
-- if needed. A person who re-answers keeps the node their stance already has,
-- so a re-answer does not grow the tree or bump the parent's count again.
create or replace function public.open_whatsapp_forward_node(
  p_question_id uuid,
  p_phone_hash  text,
  p_inbound_ref text,
  p_new_id      text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing text;
  v_parent   record;
begin
  select qs.forward_chain_id into v_existing
    from public.question_stances qs
   where qs.whatsapp_phone_hash = p_phone_hash
     and qs.question_id = p_question_id
     and qs.forward_chain_id is not null
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('node_id', v_existing, 'reused', true);
  end if;

  select * into v_parent from public.resolve_forward_parent(p_inbound_ref);
  insert into public.whatsapp_forward_chains
    (id, question_id, root_phone_hash, responder_phone_hash, parent_forward_chain_id, depth, channel)
  values
    (p_new_id, p_question_id, p_phone_hash, p_phone_hash, v_parent.parent_id, v_parent.depth, 'whatsapp');
  return jsonb_build_object('node_id', p_new_id, 'reused', false,
                            'parent', v_parent.parent_id, 'depth', v_parent.depth);
end;
$function$;

revoke all on function public.resolve_forward_parent(text) from public, anon, authenticated;
revoke all on function public.open_whatsapp_forward_node(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_forward_parent(text) to service_role;
grant execute on function public.open_whatsapp_forward_node(uuid, text, text, text) to service_role;

-- The web path: same rule. Surgical edit of record_web_stance's own body (the
-- repo's copy of the function is not the live one), aborting if the expected
-- text is not found.
do $mig$
declare
  v_src text;
  v_new text;
  v_old_depth  text := $o$    SELECT depth INTO v_parent_depth FROM public.whatsapp_forward_chains WHERE id = p_ref;
    v_parent_depth := coalesce(v_parent_depth, 0);$o$;
  v_old_insert text := $o$(v_my_ref, p_question_id, NULL, p_ref, v_parent_depth + 1, p_device_id, 'web', v_location_id);$o$;
  v_old_count  text := $o$    IF p_ref IS NOT NULL THEN
      UPDATE public.whatsapp_forward_chains
         SET child_stance_count = child_stance_count + 1
       WHERE id = p_ref;
    END IF;$o$;
begin
  select prosrc into v_src from pg_proc
   where oid = 'public.record_web_stance(text,uuid,smallint,text,text,text,text,uuid)'::regprocedure;
  v_src := replace(v_src, chr(13), '');

  if position(v_old_depth in v_src) = 0 or position(v_old_insert in v_src) = 0 or position(v_old_count in v_src) = 0 then
    raise exception 'record_web_stance: expected text not found; not patched';
  end if;

  v_new := replace(v_src, v_old_depth,
$n$    -- Epic AA-10: parent + depth + caps decided by resolve_forward_parent(),
    -- which also counts the parent's child. Roots are depth 0 (were 1).
    SELECT r.parent_id, r.depth INTO p_ref, v_parent_depth FROM public.resolve_forward_parent(p_ref) r;$n$);
  v_new := replace(v_new, v_old_insert,
    $n$(v_my_ref, p_question_id, NULL, p_ref, v_parent_depth, p_device_id, 'web', v_location_id);$n$);
  v_new := replace(v_new, v_old_count, $n$    -- (parent's child_stance_count is incremented by resolve_forward_parent)$n$);

  if position('resolve_forward_parent' in v_new) = 0 or position('v_parent_depth + 1' in v_new) > 0 then
    raise exception 'record_web_stance: patch did not apply cleanly';
  end if;

  execute format($f$create or replace function public.record_web_stance(
      p_ref text, p_question_id uuid, p_score smallint, p_device_id text DEFAULT NULL::text,
      p_country_code text DEFAULT NULL::text, p_state_name text DEFAULT NULL::text,
      p_city_name text DEFAULT NULL::text, p_rendition_id uuid DEFAULT NULL::uuid)
    returns json language plpgsql security definer set search_path to 'public' as %L$f$, v_new);
end
$mig$;

-- Existing data: parentless nodes are roots, so depth 0. On Dev on 23 Sep that
-- was 20 web nodes written at depth 1 by the old record_web_stance.
update public.whatsapp_forward_chains
   set depth = 0
 where parent_forward_chain_id is null and depth <> 0;
