// PR 1.8 — the Hindi-mode DOM scan.
//
// This is the PRIMARY regression instrument for localization, not the key
// parity check. Parity compares two JSON files and was green throughout the
// entire drawnFromAnswers bug, where a raw i18n key rendered into the page in
// BOTH languages because the call site omitted `count` and neither plural
// variant resolved. Only looking at what actually reached the DOM finds that.
//
// It also replaces grepping source for JSX string literals, which rots as soon
// as components move and cannot see text assembled at runtime.
//
// Two independent assertions:
//
//   1. Latin-script leakage, Hindi mode only, Class-4 content exempt.
//   2. Raw i18n keys, BOTH languages, NOTHING exempt. A key like
//      "home.drawnFromAnswers" in the DOM is always a bug.
//
// Requires a running app: `npm run dev`, or set PLAYWRIGHT_BASE_URL.

import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// ── fixture discovery for the D1 fallback test ──────────────────────────────
//
// The homepage variant of the fallback check below can only run when the feed
// HAPPENS to surface a question with no Hindi rendition. That is coverage by
// ranking, and the summary defect found in PR 3.4 was live for exactly as long
// as a green scan bounded by what the feed chose to show. So this discovers a
// question that provably has no published Hindi rendition and goes straight to
// it, instead of hoping one turns up.
//
// Reads the same .env Vite reads rather than taking a hardcoded id, so the test
// finds a valid fixture on Dev, UAT and Prod instead of passing on one and
// erroring on the others.
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [".env", ".env.development"]) {
    const fp = path.resolve(process.cwd(), f);
    if (!fs.existsSync(fp)) continue;
    for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/** A live question with NO published Hindi rendition, or null if none exists. */
async function findQuestionWithoutHindi(): Promise<string | null> {
  const env = readEnv();
  const url = (env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;

  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const [qRes, rRes] = await Promise.all([
    fetch(`${url}/rest/v1/questions?select=id&status=eq.active&limit=300`, { headers: h }),
    fetch(
      `${url}/rest/v1/question_renditions?select=question_id` +
        `&language_code=eq.hi&lifecycle_status=eq.published&limit=1000`,
      { headers: h },
    ),
  ]);
  if (!qRes.ok || !rRes.ok) return null;

  const questions = (await qRes.json()) as Array<{ id: string }>;
  const hindi = new Set(
    ((await rRes.json()) as Array<{ question_id: string }>).map((r) => r.question_id),
  );
  return questions.find((q) => !hindi.has(q.id))?.id ?? null;
}

/**
 * Never translated (content Class 5). Keep this list SHORT and specific.
 *
 * Every addition weakens the test, so the bar is "this is a proper noun that a
 * Hindi page would legitimately render in Latin script" — not "this string is
 * currently failing and I want green". In particular the English-language
 * indicator chip must NOT be added: it renders as अंग्रेज़ी में in Hindi mode
 * (PR 1.9), and allowlisting "English" here would hand-wave a real leak.
 */
/**
 * Brand wordmarks that must match the text node EXACTLY.
 *
 * The logo renders the single word "Stance". Putting that in the substring
 * allowlist below would also silence "Your Stance", "Stance history" and every
 * other real leak containing the word — so short brand marks are matched whole
 * and nothing else is affected.
 */
const EXACT_ALLOWLIST = ["Stance"];

const PROPER_NOUN_ALLOWLIST = [
  "Stance Capture",
  "Reuters",
  "BBC",
  "CNN",
  "The Hindu",
  "OpenAI",
  "Microsoft",
  "US",
  "S&P",
  "OPT",
  "PPI",
  "F-1",
];

/** Routes to scan. HashRouter, so language rides in the hash query string. */
const ROUTES: Array<{ name: string; path: string }> = [
  { name: "homepage", path: "/#/" },
  { name: "trending", path: "/#/trending" },
  { name: "my-stances", path: "/#/my-stances" },
];

type Finding = { text: string; tag: string; path: string };

async function collectFindings(page: Page, lang: string): Promise<{
  latin: Finding[];
  rawKeys: Finding[];
  pendingCount: number;
  fallbackBlocks: number;
  indicators: number;
  properNouns: Finding[];
}> {
  return page.evaluate(({ allowlist, exact, uiLang }: { allowlist: string[]; exact: string[]; uiLang: string }) => {
    const isSuspiciousLatin = (text: string): boolean => {
      const t = text.trim();
      if (!t || t.length < 3) return false;
      if (exact.includes(t)) return false;
      // Substring allowlist is matched against the NODE only.
      //
      // An earlier revision also matched it against several levels of ancestor
      // text to catch brand names split across elements. That silently gutted
      // the test: short entries like "US", "PPI" and "F-1" appear somewhere in
      // almost any large ancestor's combined text, so nearly every leak was
      // suppressed and the suite went from 7 findings to 1 without a single
      // string being translated. A scan that passes by going blind is worse
      // than one that fails honestly. Split brand marks are handled by
      // EXACT_ALLOWLIST instead.
      if (allowlist.some((n) => t.includes(n))) return false;
      // Pure numbers, dates, percentages and punctuation are script-neutral.
      if (/^[\d\s.,:%+\-–—/()]+$/.test(t)) return false;
      const latin = (t.match(/[A-Za-z]/g) || []).length;
      const deva = (t.match(/[ऀ-ॿ]/g) || []).length;
      return latin > deva;
    };

    // "a.b" or "a.b.c" with no spaces — the shape of an unresolved i18n key.
    const isRawI18nKey = (text: string): boolean =>
      /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(text.trim());

    const describe = (el: Element | null): string => {
      const parts: string[] = [];
      let cur = el;
      let hops = 0;
      while (cur && hops < 4) {
        const id = cur.id ? `#${cur.id}` : "";
        const cls =
          typeof cur.className === "string" && cur.className
            ? `.${cur.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        parts.unshift(`${cur.tagName.toLowerCase()}${id}${cls}`);
        cur = cur.parentElement;
        hops++;
      }
      return parts.join(" > ");
    };

    const latin: Array<{ text: string; tag: string; path: string }> = [];
    const properNouns: Array<{ text: string; tag: string; path: string }> = [];
    const rawKeys: Array<{ text: string; tag: string; path: string }> = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node.textContent ?? "").trim();
      if (!text) continue;

      const parent = node.parentElement;
      if (!parent) continue;

      // Skip anything not actually rendered.
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      if (parent.closest("script, style, noscript, template")) continue;

      const entry = { text, tag: parent.tagName.toLowerCase(), path: describe(parent) };

      // Raw keys are checked everywhere, with no exemptions at all.
      if (isRawI18nKey(text)) rawKeys.push(entry);

      // Class-4 derived content is not localized until PR 3. The attribute must
      // sit on the Class-4 container itself, never a section or page wrapper —
      // otherwise it hides unrelated English chrome from this test.
      if (parent.closest("[data-i18n-pending]")) continue;

      // Class-2 instrument text under the D1 labelled fallback. When a question
      // has no rendition in the reader language the original is shown instead,
      // so the question wording and pole labels are LEGITIMATELY in another
      // language. The element declares which one.
      //
      // This is narrower than it looks: the attribute sits on the rendition-
      // derived elements themselves (the headline button, the slider root), not
      // on the card — chrome beside them is still scanned. And a fallback with
      // no declaration still fails, which is the point.
      // Class 5. A name that has no translation -- a state, a city, a masthead
      // -- is permanently and CORRECTLY in its own script, which is a different
      // claim from data-i18n-pending's "not localized yet". It is skipped here
      // and then checked separately: the companion test asserts these elements
      // hold short NAMES, so the attribute cannot quietly become the exemption
      // that data-i18n-pending was.
      if (parent.closest("[data-proper-noun]")) {
        properNouns.push(entry);
        continue;
      }

      const declared = parent.closest("[data-instrument-language]");
      if (declared) {
        const lang = declared.getAttribute("data-instrument-language") ?? "";
        if (lang && lang.split("-")[0].toLowerCase() !== uiLang.split("-")[0].toLowerCase()) continue;
      }

      if (isSuspiciousLatin(text)) latin.push(entry);
    }

    return {
      latin,
      rawKeys,
      pendingCount: document.querySelectorAll("[data-i18n-pending]").length,
      // A fallback that is not labelled is a silent mixed-language page, which
      // is exactly what D1 chose against.
      fallbackBlocks: Array.from(document.querySelectorAll("[data-instrument-language]"))
        .map((el) => el.getAttribute("data-instrument-language") ?? "")
        .filter((l) => l && l.split("-")[0].toLowerCase() !== uiLang.split("-")[0].toLowerCase()).length,
      indicators: document.querySelectorAll("[data-content-language-indicator]").length,
      properNouns,
    };
  }, { allowlist: PROPER_NOUN_ALLOWLIST, exact: EXACT_ALLOWLIST, uiLang: lang });
}

async function settle(page: Page, path: string, lang: string) {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}lang=${lang}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  // Feeds resolve after first paint; give the localized RPCs a beat to land.
  await page.waitForTimeout(1500);
}

const fmt = (f: Finding[]) =>
  f.map((x) => `  • ${JSON.stringify(x.text.slice(0, 80))}\n      at ${x.path}`).join("\n");

for (const route of ROUTES) {
  test(`[hi] no Latin-script chrome leaks on ${route.name}`, async ({ page }) => {
    await settle(page, route.path, "hi");
    const { latin } = await collectFindings(page, "hi");
    expect(
      latin,
      `Untranslated Latin-script text in Hindi mode on ${route.name}:\n${fmt(latin)}\n\n` +
        `Fix by adding an i18n key, or — only for Class-4 derived content — by ` +
        `putting data-i18n-pending="<what>" on that content's own container.`
    ).toEqual([]);
  });

  for (const lang of ["en", "hi"]) {
    test(`[${lang}] no raw i18n keys in the DOM on ${route.name}`, async ({ page }) => {
      await settle(page, route.path, lang);
      const { rawKeys } = await collectFindings(page, lang);
      expect(
        rawKeys,
        `Unresolved i18n key rendered on ${route.name} (${lang}):\n${fmt(rawKeys)}\n\n` +
          `A dotted lowercase string in the DOM means t() resolved nothing. ` +
          `Check for a dynamically built key, or a plural key called without \`count\`.`
      ).toEqual([]);
    });
  }
}

// PR 3.1 — ENABLED. Every Class-4 exemption is gone, because the only content
// holding one (the societal-pulse narrative) turned out to be deterministic
// template selection rather than generated prose: the server now sends a state
// and the client renders it from an i18n template. This asserts none creeps
// back in.
test("PR 3: no data-i18n-pending exemptions remain", async ({ page }) => {
  await settle(page, ROUTES[0].path, "hi");
  const { pendingCount } = await collectFindings(page, "hi");
  expect(pendingCount).toBe(0);
});

// D1 — a fallback must be LABELLED, never silent.
//
// The exemption above lets declared instrument text through. This is the check
// that stops that exemption becoming a loophole: if any block declares itself
// to be in a language other than the reader's, the content-language indicator
// has to be on the page saying so. Declaring a fallback and not labelling it
// is precisely the silent mixed-language page D1 chose against.
test("[hi] every content-language fallback is labelled", async ({ page }) => {
  await settle(page, ROUTES[0].path, "hi");
  const { fallbackBlocks, indicators } = await collectFindings(page, "hi");

  if (fallbackBlocks === 0) {
    test.skip(true, "no fallback content on this render — nothing to label");
    return;
  }

  expect(
    indicators,
    `${fallbackBlocks} block(s) declare non-Hindi instrument text but no ` +
      `content-language indicator is rendered. A fallback the reader cannot ` +
      `see is a silent mixed-language page.`
  ).toBeGreaterThan(0);
});

// A proper-noun declaration covers a NAME. This stops it covering a sentence.
//
// data-i18n-pending started as a narrow exemption too, and by the time PR 3
// removed it, it was sitting on containers wide enough to hide real chrome. The
// difference here is enforced rather than promised: anything declared a proper
// noun has to LOOK like a name, so the attribute cannot be widened into a way
// of silencing this scan.
test("[hi] proper-noun declarations cover names, not prose", async ({ page }) => {
  // Scans the question page, where the declarations actually live. Pointing
  // this at the homepage passed for the wrong reason: it found no declared
  // elements at all and asserted nothing.
  const qid = await findQuestionWithoutHindi();
  await settle(page, qid ? `/#/q/${qid}` : ROUTES[0].path, "hi");
  const { properNouns } = await collectFindings(page, "hi");

  // Proves the check is looking at something. If nothing is declared, this
  // test is asserting over an empty list and would pass however broken the
  // mechanism is.
  expect(
    properNouns.length,
    "no data-proper-noun elements rendered, so this check proves nothing",
  ).toBeGreaterThan(0);

  const prose = properNouns.filter(
    (f) => f.text.length > 60 || /[.!?।]\s/.test(f.text) || f.text.split(/\s+/).length > 8,
  );

  expect(
    prose,
    "data-proper-noun is for names that have no translation (a state, a city, " +
      "a masthead). These look like sentences, and a sentence behind that " +
      "attribute is hidden from the scan rather than exempt from translation:\n" +
      fmt(prose),
  ).toEqual([]);
});

// ── §3.5 / D1: the fallback branch, tested deterministically ────────────────
//
// The check above skips when the homepage happens to show only questions that
// already have a Hindi rendition, which on Dev is most renders. A guarantee
// that is only exercised when the feed cooperates is not a guarantee — PR 3.4
// found a live mixed-language defect sitting behind exactly that kind of
// luck-dependent green.
//
// So this picks a question that provably has NO published Hindi rendition and
// goes directly to it. Playwright is anonymous, and wording_for grants the
// permissive branch to anonymous readers unconditionally, so the fallback is
// guaranteed to fire — which the first assertion confirms before the second one
// is allowed to mean anything.
test("[hi] a question with no Hindi rendition falls back, and says so", async ({ page }) => {
  const qid = await findQuestionWithoutHindi();
  if (!qid) {
    test.skip(true, "every active question has a published Hindi rendition — no fallback exists to label");
    return;
  }

  await settle(page, `/#/q/${qid}`, "hi");
  const { fallbackBlocks, indicators, latin } = await collectFindings(page, "hi");

  // Guards the test against itself: if the fallback did not actually happen,
  // the labelling assertion below would pass for the wrong reason.
  expect(
    fallbackBlocks,
    `Fixture question ${qid} has no published Hindi rendition, so its wording must have been declared as fallback content. Nothing declared itself — ` +
      `either the instrument is not carrying data-instrument-language, or the ` +
      `page did not render the question.`,
  ).toBeGreaterThan(0);

  expect(
    indicators,
    `${fallbackBlocks} block(s) on /q/${qid} declare non-Hindi instrument text ` +
      `but no content-language indicator is rendered. D1 chose a LABELLED ` +
      `fallback; an unlabelled one is the silent mixed-language page it ` +
      `rejected.`,
  ).toBeGreaterThan(0);

  // The declared instrument may legitimately be English here. Everything else
  // on the page may not: the exemption covers the fallback, not the chrome
  // around it.
  expect(
    latin,
    `Latin-script text outside the declared fallback on /q/${qid}:
${fmt(latin)}`,
  ).toEqual([]);
});
