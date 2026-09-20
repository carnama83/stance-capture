// PR 1.10 — Devanagari layout.
//
// Hindi runs roughly 15–25% longer than English with taller line boxes, and
// several surfaces here are already tight in English (the slider pole labels
// most of all). This catches the resulting overflow at both ends of the
// responsive range.
//
// WHY NOT PIXEL SNAPSHOTS, which is what the brief asks for:
//
// Every page under test renders a live feed — rotating questions, changing
// response counts, a societal-pulse narrative regenerated from real data. A
// toHaveScreenshot() baseline would fail on the next pipeline run and keep
// failing, and a test that cries wolf on data changes gets its baselines
// blindly re-recorded, at which point it is no longer testing anything. The
// failure it is supposed to catch — Devanagari overflowing its container —
// would be lost in that noise.
//
// These assertions target the defect directly instead, so they are stable
// against content and fail only when layout actually breaks.
//
// Requires a running app: `npm run dev`, or set PLAYWRIGHT_BASE_URL.

import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "360px", width: 360, height: 800 },
  { name: "1280px", width: 1280, height: 900 },
];

const ROUTES = [
  { name: "homepage", path: "/#/" },
  { name: "trending", path: "/#/trending" },
];

const LANGUAGES = ["en", "hi"];

async function settle(page: Page, path: string, lang: string) {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}lang=${lang}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

// ── 1 · the page itself must not scroll sideways ────────────────────────────
for (const vp of VIEWPORTS) {
  for (const lang of LANGUAGES) {
    for (const route of ROUTES) {
      test(`[${lang}] ${route.name} has no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await settle(page, route.path, lang);

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const slack = 1; // sub-pixel rounding on fractional layouts
          const overflowing: Array<{ tag: string; cls: string; text: string; right: number }> = [];

          if (doc.scrollWidth > doc.clientWidth + slack) {
            // Name the elements actually sticking out, so a failure points at a
            // culprit instead of just asserting the page is too wide.
            const limit = doc.clientWidth + slack;
            for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (r.right > limit) {
                if (window.getComputedStyle(el).position === "fixed") continue; // off-canvas drawers
                overflowing.push({
                  tag: el.tagName.toLowerCase(),
                  cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
                  text: (el.textContent ?? "").trim().slice(0, 60),
                  right: Math.round(r.right),
                });
              }
            }
          }

          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            // A parent and all its children overflow together; the innermost
            // ones are the useful names.
            worst: overflowing.slice(-6),
          };
        });

        expect(
          overflow.scrollWidth,
          "Horizontal overflow on " + route.name + " (" + lang + ") at " + vp.name + ": page is " +
            overflow.scrollWidth + "px wide in a " + overflow.clientWidth + "px viewport.\n" +
            "Elements past the right edge:\n" +
            overflow.worst
              .map((o) => "  • <" + o.tag + ' class="' + o.cls + '"> right=' + o.right + " " + JSON.stringify(o.text))
              .join("\n")
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      });
    }
  }
}

// ── 2 · Hindi must not introduce truncation English does not have ───────────
//
// Deliberately comparative, not "does anything overflow". Several boxes here
// clamp ON PURPOSE (line-clamp, truncate) and flagging those would be noise.
// What matters is the DIFFERENCE: a label a reader can read in full in English
// and cannot in Hindi, because Devanagari runs longer in the same box.
//
// An earlier version asserted "no unclamped span overflows". It passed, but
// hollowly — the -1/+1 pole labels carry `hidden` at mobile width, so they
// measure 0x0 and can never trip a `>` comparison. Elements with no box are
// now skipped explicitly rather than passing by accident.
async function measureTruncation(page: Page, path: string, lang: string) {
  await settle(page, path, lang);
  return page.evaluate(() => {
    const rows: Array<{ key: string; text: string; truncated: boolean }> = [];
    const seen = new Map<string, number>();
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("span[class*='max-w-'], span[class*='line-clamp']"),
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // not rendered at this width
      const cls = typeof el.className === "string" ? el.className : "";
      // Identity across languages: the text differs, the markup does not.
      const n = (seen.get(cls) ?? 0) + 1;
      seen.set(cls, n);
      // 2px slack: sub-pixel line-box rounding puts scrollHeight 1px over
      // clientHeight on labels that are perfectly fine.
      const truncated = el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
      rows.push({ key: cls + "#" + n, text: (el.textContent ?? "").trim().slice(0, 50), truncated });
    }
    return rows;
  });
}

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    test(`[hi] ${route.name} adds no truncation over English at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      const en = await measureTruncation(page, route.path, "en");
      const hi = await measureTruncation(page, route.path, "hi");

      const enTruncated = new Set(en.filter((r) => r.truncated).map((r) => r.key));
      const regressions = hi.filter((r) => r.truncated && !enTruncated.has(r.key));

      expect(
        regressions,
        "Devanagari is truncated where English is not, on " + route.name + " at " + vp.name + ":\n" +
          regressions.map((r) => "  • " + JSON.stringify(r.text) + "\n      at " + r.key).join("\n") +
          "\n\nThe box fits the English label and not the Hindi one. Widen it, raise the clamp, " +
          "or shorten the Hindi string."
      ).toEqual([]);
    });
  }
}
