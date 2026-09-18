-- =====================================================================
-- DEV backport, part 3: H-10 (composite assignment + timeouts), H-12 (swapped
-- content_type/content), H-14 (the admin schema was never swept).
--
-- Applied across BOTH `admin` and `public` in one pass, because Dev carries the
-- defects in both. Two details this pass gets right that earlier ones did not:
--
--  * CASE-INSENSITIVE. The original H-10 patch anchored on uppercase
--    'SELECT extensions.http((' and silently skipped admin.cron_cluster,
--    admin.cron_generate and admin.cron_ingest, which are written lowercase.
--
--  * BOTH CALL FORMS. The curl-timeout insertion must anchor on either
--    `select * from extensions.http((` (admin style) or
--    `v_resp := extensions.http((` (public style). Dev's public functions all
--    use the assignment form, so a select-only anchor would have silently
--    skipped every one of them while still reporting success.
--
-- Self-guarding: asserts exactly one call site per function, asserts the curl
-- insertion actually matched, and post-flight assertions require ZERO remaining
-- defects of all three kinds. One transaction - a failed assertion lands nothing.
-- =====================================================================
DO $mig$
DECLARE
  r          record;
  def        text;
  newdef     text;
  n_seen     int := 0;
  n_changed  int := 0;
  n_h10      int := 0;
  n_h12      int := 0;
  n_timeout  int := 0;
  leftover   int;
BEGIN
  FOR r IN
    SELECT p.oid, nsp.nspname, p.proname
    FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE p.prokind = 'f' AND nsp.nspname IN ('admin','public')
      AND p.prosrc ~* 'extensions\.http\(\('
    ORDER BY nsp.nspname, p.proname
  LOOP
    n_seen := n_seen + 1;
    def := pg_get_functiondef(r.oid);

    IF (SELECT count(*) FROM regexp_matches(def, 'extensions\.http\(\(', 'g')) <> 1 THEN
      RAISE EXCEPTION '%.%: expected exactly 1 http call site, refusing to patch', r.nspname, r.proname;
    END IF;

    newdef := def;

    -- (1) H-10: bare composite assignment -> SELECT * FROM. Case-insensitive.
    IF newdef ~* 'select\s+extensions\.http\(\(' THEN
      newdef := regexp_replace(newdef, 'select(\s+)extensions\.http\(\(', 'select\1* from extensions.http((', 'i');
      n_h10 := n_h10 + 1;
    END IF;

    -- (2) H-12: content_type / content passed in the wrong order.
    IF newdef ~ '''\{\}''::text,(\s*)''application/json''' THEN
      newdef := regexp_replace(newdef, '''\{\}''::text,(\s*)''application/json''', '''application/json'',\1''{}''::text');
      n_h12 := n_h12 + 1;
    END IF;

    -- (3) curl timeout. Anchor on EITHER call form.
    IF newdef !~ 'CURLOPT_TIMEOUT_MS' THEN
      newdef := regexp_replace(
        newdef,
        '((?:select\s+\*\s+from\s+|[a-zA-Z_][a-zA-Z0-9_]*\s*:=\s*)extensions\.http\(\()',
        'perform extensions.http_set_curlopt(''CURLOPT_TIMEOUT_MS'', ''45000'');' || chr(10) || '  \1',
        'i');
      IF newdef !~ 'CURLOPT_TIMEOUT_MS' THEN
        RAISE EXCEPTION '%.%: could not anchor the curl-timeout insertion - unrecognised call form, refusing',
          r.nspname, r.proname;
      END IF;
      n_timeout := n_timeout + 1;
    END IF;

    -- (3b) statement_timeout in the function's SET clauses.
    IF newdef !~ 'statement_timeout' THEN
      newdef := regexp_replace(newdef, '(\nAS \$function\$)', chr(10) || ' SET statement_timeout TO ''60s''\1');
    END IF;

    IF newdef <> def THEN
      EXECUTE newdef;
      n_changed := n_changed + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'dev sweep: seen=% changed=% h10=% h12=% timeout=%', n_seen, n_changed, n_h10, n_h12, n_timeout;

  SELECT count(*) INTO leftover
  FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
  WHERE p.prokind='f' AND nsp.nspname IN ('admin','public') AND p.prosrc ~* 'extensions\.http\(\('
    AND p.prosrc ~* 'select\s+extensions\.http\(\(';
  IF leftover <> 0 THEN RAISE EXCEPTION 'post-flight: % still use the bare composite assignment', leftover; END IF;

  SELECT count(*) INTO leftover
  FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
  WHERE p.prokind='f' AND nsp.nspname IN ('admin','public') AND p.prosrc ~* 'extensions\.http\(\('
    AND p.prosrc ~ '''\{\}''::text,\s*''application/json''';
  IF leftover <> 0 THEN RAISE EXCEPTION 'post-flight: % still pass content before content_type', leftover; END IF;

  SELECT count(*) INTO leftover
  FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
  WHERE p.prokind='f' AND nsp.nspname IN ('admin','public') AND p.prosrc ~* 'extensions\.http\(\('
    AND (p.prosrc !~ 'CURLOPT_TIMEOUT_MS' OR p.proconfig::text !~ 'statement_timeout');
  IF leftover <> 0 THEN RAISE EXCEPTION 'post-flight: % still lack a curl or statement timeout', leftover; END IF;
END
$mig$;
