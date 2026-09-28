// scripts/print-report-pdf.mjs
//
// Epic Report R6: print a report (or a frozen report snapshot) to PDF the way
// a browser's "Save as PDF" does — print media, the page's own @page rules —
// after the report and its trend chart have rendered. Used to check English
// and Hindi PDFs before promoting.
//
//   node scripts/print-report-pdf.mjs <baseUrl> <questionId> <lang> <out.pdf> [printId]
//   e.g. node scripts/print-report-pdf.mjs http://localhost:8080 <qid> hi report-hi.pdf <printId>
//
// Uses the Playwright Chromium already installed for tests/i18n. Headless
// Chrome's own --print-to-pdf hangs against the Vite dev server (its HMR
// socket never lets the page go idle), which is why this waits for selectors.

import { chromium } from "playwright-core";

const [baseUrl, questionId, lang, out, printId] = process.argv.slice(2);
if (!baseUrl || !questionId || !lang || !out) {
  console.error("usage: node scripts/print-report-pdf.mjs <baseUrl> <questionId> <lang> <out.pdf> [printId]");
  process.exit(1);
}

const params = new URLSearchParams({ lang });
if (printId) params.set("print", printId);
const url = `${baseUrl.replace(/\/$/, "")}/#/q/${questionId}/report?${params}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("article h1", { timeout: 60_000 });
  // The trend chart only exists with 2+ groups; don't fail without it.
  await page.waitForSelector("article svg[role=img]", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    sections: [...document.querySelectorAll("article h2")].map((h) => h.textContent),
  }));
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log(JSON.stringify({ url, out, ...info }));
} finally {
  await browser.close();
}
