-- Sep 2026, NEW: helper for stub_question_renditions() below — decides whether a
-- piece of free-text (location_label / topic title / etc.) plausibly refers to
-- India, so editorial (non-UGQ) Hindi renditions only get generated for
-- India-relevant questions instead of unconditionally for everything. UGQ
-- questions are unaffected by this function (they always stub, see below) —
-- the proposer's own language is already a much stronger relevance signal there.
create or replace function public.text_mentions_india(p_text text)
returns boolean
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  keywords text[] := array[
    'india','bharat','hindustan',
    'andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa','gujarat',
    'haryana','himachal pradesh','jharkhand','karnataka','kerala','madhya pradesh',
    'maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','punjab','rajasthan',
    'sikkim','tamil nadu','telangana','tripura','uttar pradesh','uttarakhand','west bengal',
    'andaman and nicobar islands','chandigarh','dadra and nagar haveli and daman and diu',
    'delhi','jammu and kashmir','ladakh','lakshadweep','puducherry',
    'mumbai','bengaluru','bangalore','hyderabad','ahmedabad','chennai','kolkata','surat',
    'pune','jaipur','lucknow','kanpur','nagpur','indore','bhopal','visakhapatnam','patna',
    'vadodara','ghaziabad','ludhiana','agra','nashik','faridabad','meerut','rajkot',
    'varanasi','srinagar','amritsar','noida','gurugram','gurgaon'
  ];
  kw text;
  tok text;
  lower_text text;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;

  lower_text := lower(p_text);

  -- Layer 1: substring match — handles multi-word keywords (e.g. "Rajasthan,
  -- India") and casing typos already seen in production data (e.g. "INdia").
  foreach kw in array keywords loop
    if lower_text like '%' || kw || '%' then
      return true;
    end if;
  end loop;

  -- Layer 2: per-word fuzzy match (pg_trgm, already installed on this project)
  -- for genuine misspellings a substring check would miss (e.g. "Karnatka").
  -- Single-word keywords only — a multi-word keyword can't usefully match one
  -- token, and layer 1 already covers those via substring.
  for tok in select regexp_split_to_table(lower_text, '[^a-z]+') loop
    if length(tok) < 3 then
      continue;
    end if;
    foreach kw in array keywords loop
      if position(' ' in kw) = 0 and similarity(tok, kw) > 0.55 then
        return true;
      end if;
    end loop;
  end loop;

  return false;
end;
$function$;

-- Sep 2026, NEW: only stub a hi rendition for an editorial (source <> 'community')
-- question when text_mentions_india() matches its location fields or its topic —
-- UGQ (source = 'community') questions are unaffected, always stub, unchanged from
-- before. Forward-only: existing question_renditions rows are untouched regardless
-- of their question's relevance, this only changes behavior for future inserts.
create or replace function public.stub_question_renditions()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  insert into public.question_renditions (question_id, language_code, transform_status, generation_reason)
  select
    new.id,
    l.language_code,
    'pending',
    case when new.source = 'community' then 'community_proposer' else 'editorial_pipeline' end
  from public.languages l
  where l.is_active_for_ugq = true
    and l.language_code <> new.canonical_language
    and (
      new.source = 'community'
      or public.text_mentions_india(new.location_label)
      or public.text_mentions_india(new.origin_location_label)
      or public.text_mentions_india(new.audience_location_label)
      or exists (
        select 1 from public.topics t
        where t.id = new.topic_id
          and (public.text_mentions_india(t.title) or public.text_mentions_india(t.location_label))
      )
    )
  on conflict (question_id, language_code) do nothing;

  return new;
end;
$function$;
;
