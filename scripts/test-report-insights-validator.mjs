// scripts/test-report-insights-validator.mjs
//
// Epic Report R4: loads the validator from supabase/functions/question-report-insights
// (Deno bits stubbed) and feeds it deliberately bad summaries. Each case must
// produce the named violation. Run from the repo root before promoting:
//   node scripts/test-report-insights-validator.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const repo = process.cwd().split(path.sep).join("/");
const sp = fs.mkdtempSync(path.join(os.tmpdir(), "rpt-validator-")).split(path.sep).join("/");
let src = fs.readFileSync(`${repo}/supabase/functions/question-report-insights/index.ts`, "utf8");
src = src.replace(/import \{ serve \} from "[^"]+";/, "const serve = (_f: unknown) => {};");
src += "\nexport { validateEnglish, validateTranslation, buildPayload };\n";
fs.writeFileSync(`${sp}/r4_fn_copy.ts`, src);
execSync(`npx -y esbuild "${sp}/r4_fn_copy.ts" --format=esm --outfile="${sp}/r4_fn_copy.mjs" --log-level=error`);
globalThis.Deno = { env: { get: () => "" } };
const { validateEnglish, validateTranslation, buildPayload } = await import(`file:///${sp}/r4_fn_copy.mjs`);

const report = {
  question: { text: "Should funds be redirected?", summary: null, context: null, lowLabel: "Keep funds", highLabel: "Redirect funds", location: "Pune, India", topic: "Education" },
  responseSummary: { total: 9, signedIn: 0, anonymous: 9, strength: "early", distribution: [
    { score: -2, count: 1, percentage: 11 }, { score: -1, count: 1, percentage: 11 }, { score: 0, count: 1, percentage: 11 },
    { score: 1, count: 2, percentage: 22 }, { score: 2, count: 4, percentage: 44 }],
    mean: 0.78, median: 1, lean: { low: 2, neutral: 1, high: 6 }, firstResponseAt: "2026-08-22T11:02:09Z", lastResponseAt: "2026-09-27T13:20:28Z" },
  stanceDefinitions: null,
  trend: { bucket: "sequence", points: [
    { fromResponse: 1, toResponse: 3, bucketMean: -0.33, cumulativeMean: -0.33 },
    { fromResponse: 4, toResponse: 6, bucketMean: 1, cumulativeMean: 0.33 },
    { fromResponse: 7, toResponse: 9, bucketMean: 1.67, cumulativeMean: 0.78 }] },
  changes: [], preResponseEdits: 0, channels: [{ source: "web_forward", count: 9 }], geography: null, reasons: null,
};
const payload = buildPayload(report);
const good = {
  headline: "6 of 9 respondents lean toward redirecting funds.",
  what_people_are_voting_for: "6 of 9 respondents lean toward 'Redirect funds'; 2 lean toward 'Keep funds' and 1 is neutral.",
  why_they_may_feel_this_way: "Respondents choosing to redirect may be prioritising repairs; those keeping funds may be prioritising preparedness.",
  other_perspectives: "2 respondents lean toward keeping funds for emergencies.",
  trend_summary: "The group average moved from -0.33 for responses 1-3 to 1.67 for responses 7-9, an early signal.",
  what_people_appear_to_want: "Safe schools without losing the ability to respond to emergencies.",
  desired_outcomes: ["safe school buildings", "emergency readiness"],
  caveats: ["Only 9 responses: an early signal."],
};

const cases = [
  ["good summary passes", good, null],
  ["invented number", { ...good, headline: "67% of respondents lean toward redirecting." }, "67"],
  ["population language", { ...good, headline: "Pune citizens want funds redirected." }, "citizens"],
  ["winner", { ...good, headline: "Redirecting funds is the clear winner." }, "winner"],
  ["attribution without reasons", { ...good, why_they_may_feel_this_way: "Respondents said schools come first." }, "said"],
  ["invented quote", { ...good, other_perspectives: "One respondent wrote \"we need the money for floods\"." }, "quoted text"],
  ["invented change", { ...good, caveats: ["Answers may not be comparable because the wording changed."] }, "did not change"],
  ["group vs running average", { ...good, trend_summary: "The average moved from -0.33 to 0.78." }, "RUNNING"],
  ["missing key", { ...good, headline: "" }, "headline"],
];
let fail = 0;
for (const [name, ins, expect] of cases) {
  const v = validateEnglish(ins, payload);
  const ok = expect === null ? v.length === 0 : v.some((x) => x.includes(expect));
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${v.length ? "  ->  " + v.join(" | ") : ""}`);
}
// A disclosed change is required when one exists.
const changed = buildPayload({ ...report, changes: [{ kind: "wording", responsesBefore: 4, at: "2026-09-10T00:00:00Z" }] });
const v1 = validateEnglish(good, changed);
console.log(`${v1.some((x) => x.includes("mention the change")) ? "PASS" : "FAIL"}  undisclosed wording change  ->  ${v1.join(" | ")}`);
if (!v1.some((x) => x.includes("mention the change"))) fail++;
// The first Prod summary for the Pune question (context-only change after
// response 4, no reasons given). Each flaw must be caught; a corrected version
// must pass.
const pune = buildPayload({ ...report, changes: [{ kind: "context", responsesBefore: 4, at: "2026-09-27T02:23:44Z" }] });
const prodBad = {
  ...good,
  why_they_may_feel_this_way: "4 of 9 respondents lean toward meetings. Meanwhile, 2 respondents lean toward the authorities leading repairs, indicating concerns about accountability.",
  other_perspectives: "One respondent believes authorities must lead repairs, highlighting the need for immediate action.",
  caveats: ["This is an early signal with only 9 responses. Answers before and after the context change may not be directly comparable."],
};
const vp = validateEnglish(prodBad, pune);
for (const [name, needle] of [["Prod: motive stated as fact", "believes"], ["Prod: unhedged inference", "conditionally"], ["Prod: context change called incomparable", "only the background"]]) {
  const ok = vp.some((x) => x.includes(needle));
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
const prodFixed = {
  ...good,
  why_they_may_feel_this_way: "4 of 9 respondents lean toward meetings. 2 respondents lean toward the authorities leading repairs and may be prioritising clear accountability.",
  other_perspectives: "2 respondents lean toward authorities leading repairs; they may see official action as the faster route.",
  caveats: ["This is an early signal with only 9 responses. The background was updated after response 4; the wording and scale did not change."],
};
const vf = validateEnglish(prodFixed, pune);
console.log(`${vf.length === 0 ? "PASS" : "FAIL"}  Prod: corrected summary passes${vf.length ? "  ->  " + vf.join(" | ") : ""}`);
if (vf.length) fail++;
// Translation checks.
const hi = Object.fromEntries(Object.entries(good).map(([k, v]) => [k, Array.isArray(v) ? v.map(() => "सुरक्षित स्कूल") : "6 में से 9 उत्तरदाता"]));
const tv = validateTranslation({ ...hi, headline: "6 में से 9 respondents lean" }, good, "hi");
console.log(`${tv.some((x) => x.includes("untranslated")) ? "PASS" : "FAIL"}  translation with English words  ->  ${tv.join(" | ")}`);
if (!tv.some((x) => x.includes("untranslated"))) fail++;
const tv2 = validateTranslation({ ...hi, headline: "8 में से 9 उत्तरदाता" }, good, "hi");
console.log(`${tv2.some((x) => x.includes("number 8")) ? "PASS" : "FAIL"}  translation changed a number  ->  ${tv2.join(" | ")}`);
if (!tv2.some((x) => x.includes("number 8"))) fail++;
console.log(fail ? `${fail} FAILED` : "all passed");
process.exit(fail ? 1 : 0);
