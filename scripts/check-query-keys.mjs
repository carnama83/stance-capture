// scripts/check-query-keys.mjs
//
// PR 3 §3.7 — a cached response must not outlive the language it was fetched in.
//
// TanStack serves from cache on a key hit. So a query whose queryFn sends a
// language but whose queryKey does not mention one will hand the reader the
// PREVIOUS language's payload after a switch, with no refetch and no error —
// the page simply stays half-translated until something else evicts it.
//
// This is a static check because the failure is invisible at runtime: the data
// is well-formed, the request count looks right, and only a human who reads
// both languages notices. It is also a check that must keep running, since the
// defect arrives with any newly added query and never announces itself.
//
// WHAT COUNTS AS LANGUAGE-DEPENDENT. Two signals:
//   1. the queryFn calls a function whose signature takes a language argument,
//   2. or the queryFn itself sends p_language_code / language_code /
//      Accept-Language.
//
// WHAT IS DELIBERATELY NOT FLAGGED. A query whose CACHED PAYLOAD is
// language-independent, even though the hook around it localizes. usePlaceLabels
// caches a label -> ISO-code map and localizes in the selector, outside the
// cache; sharing that entry across languages is correct, and forcing a language
// into the key would just duplicate an identical 15-row map per locale.
//
// ON THE BRACE MATCHING. An earlier version of this scan read a fixed window of
// lines around queryKey and reported six findings, every one of which was the
// NEIGHBOURING query's queryFn bleeding into the window. Options objects are
// extracted by brace matching for that reason — a line window cannot tell two
// adjacent useQuery calls apart, and a scan that cries wolf gets muted.
//
// CONTROLS. Inverting the final condition lists the language-aware queries that
// ARE correctly keyed; that list must not be empty, or the scan is passing
// because it detects nothing. Removing languageCode from a known-good key must
// produce exactly one finding. Both were run when this was written: 6 correctly
// keyed, and the sabotaged key was caught.

import fs from "node:fs";
import path from "node:path";
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/[.](ts|tsx)$/.test(e.name)) files.push(p);
  }
})("src");
const src = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

const langFns = new Set();
const SIG = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)|const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>/g;
for (const [, s] of src) {
  let m; SIG.lastIndex = 0;
  while ((m = SIG.exec(s))) {
    const name = m[1] || m[3], params = m[2] || m[4] || "";
    if (/language|lang\b|locale/i.test(params)) langFns.add(name);
  }
  let cur = null;
  for (const line of s.split("\n")) {
    const d = /(?:async\s+)?function\s+([A-Za-z0-9_]+)|const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/.exec(line);
    if (d) cur = d[1] || d[2];
    if (cur && /p_language_code|["']language_code["']|Accept-Language/i.test(line)) langFns.add(cur);
  }
}

// full object of each useQuery( { ... } ) by brace matching
function objectsFor(s, callName) {
  const out = []; let i = 0;
  while ((i = s.indexOf(callName + "(", i)) !== -1) {
    let j = s.indexOf("{", i);
    if (j === -1) break;
    let depth = 0, k = j;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === "{" || c === "(" || c === "[") depth++;
      else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0) break; }
    }
    out.push({ start: j, text: s.slice(j, k + 1) });
    i = k + 1;
  }
  return out;
}
function prop(obj, name) {
  const i = obj.indexOf(name);
  if (i === -1) return "";
  let k = obj.indexOf(":", i) + 1, depth = 0, out = "";
  for (; k < obj.length; k++) {
    const c = obj[k];
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0 && out.trim().length) break;
    out += c;
  }
  return out;
}

const LANG_IN_KEY = /languageCode|language_code|["']language["']|locale|i18n/i;
const findings = [];
for (const [f, s] of src) {
  for (const o of [...objectsFor(s, "useQuery"), ...objectsFor(s, "useInfiniteQuery")]) {
    const key = prop(o.text, "queryKey"), fn = prop(o.text, "queryFn");
    if (!key || !fn) continue;
    const calls = [...fn.matchAll(/([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
    const hit = calls.filter((c) => langFns.has(c));
    const sends = /p_language_code|["']language_code["']|Accept-Language/i.test(fn);
    if (!hit.length && !sends) continue;
    if (LANG_IN_KEY.test(key)) continue;
    findings.push({
      file: f.split(path.sep).join("/"),
      line: s.slice(0, o.start).split("\n").length,
      key: key.trim().replace(/\s+/g, " ").slice(0, 100),
      fn: fn.trim().replace(/\s+/g, " ").slice(0, 100),
      why: hit.length ? "calls " + hit.join(",") : "sends language itself",
    });
  }
}
for (const x of findings) console.log(x.file + ":" + x.line + "\n    key: " + x.key + "\n    fn : " + x.fn + "\n    why: " + x.why + "\n");
console.log("[check-query-keys] scanned " + src.size + " files; " + langFns.size + " language-aware functions; " + findings.length + " finding(s).");

if (findings.length) {
  console.error(
    "[check-query-keys] FAIL - " +
      findings.length +
      " language-dependent quer(ies) with a language-free cache key. " +
      "After a language switch these serve the previous language from cache."
  );
  process.exit(1);
}
console.log("[check-query-keys] OK - no language-dependent query has a language-free cache key.");
