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
