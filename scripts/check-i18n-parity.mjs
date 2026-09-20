#!/usr/bin/env node
//
// PR 1.7 — EN/HI key parity.
//
// Fails CI when one locale gains a key the other lacks. Parity is currently
// perfect (434 = 434); this exists to hold that line, not to fix a backlog.
//
// WHAT THIS CANNOT CATCH, and why the DOM scan matters more:
//
//   t('home.' + section + '.title')      // key built at runtime
//   t('home.drawnFromAnswers', { ... })  // plural key selected by `count`
//
// The second one is not hypothetical. home.drawnFromAnswers exists in BOTH
// locales only as _one / _other. A call site that omitted `count` never
// resolved either variant, so i18next looked up the bare key, found nothing in
// hi OR en, and rendered the raw key string into the page — in English as well
// as Hindi. Parity was green throughout. Only looking at the rendered DOM finds
// that class of bug.
//
// Plural suffixes are normalised to their base key here so that a language
// needing more plural forms than another (Hindi and English both use one/other,
// but Arabic needs six) is not reported as asymmetry.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const LOCALES = ["en", "hi"];
const NAMESPACE = "common";

// Keys allowed to exist in one locale only. Every entry needs a reason; an
// empty list is the healthy state.
const ALLOWED_ASYMMETRY = new Set([
  // e.g. "debug.internalOnly",  // dev-only surface, never shown to users
]);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(obj, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v, key));
    else out.push(key);
  }
  return out;
}

const baseKey = (k) => k.replace(PLURAL_SUFFIX, "");

const sets = {};
for (const lng of LOCALES) {
  const path = resolve(root, "src/locales", lng, `${NAMESPACE}.json`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  sets[lng] = new Set(flatten(json).map(baseKey));
}

let failed = false;
for (const a of LOCALES) {
  for (const b of LOCALES) {
    if (a === b) continue;
    const missing = [...sets[a]]
      .filter((k) => !sets[b].has(k))
      .filter((k) => !ALLOWED_ASYMMETRY.has(k))
      .sort();
    if (missing.length) {
      failed = true;
      console.error(`\n[i18n-parity] ${missing.length} key(s) in "${a}" missing from "${b}":`);
      for (const k of missing) console.error(`  - ${k}`);
    }
  }
}

const counts = LOCALES.map((l) => `${l}=${sets[l].size}`).join(" ");
if (failed) {
  console.error(`\n[i18n-parity] FAIL (${counts})`);
  console.error("Add the missing key, or allowlist it in ALLOWED_ASYMMETRY with a reason.\n");
  process.exit(1);
}

console.log(`[i18n-parity] OK — base key sets match (${counts})`);
