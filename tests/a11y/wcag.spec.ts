import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Pages to audit — expand as the platform grows
const PAGES = [
  { name: "Home",             path: "/" },
  { name: "QuestionDetail",   path: "/q/test-question-id" },
  { name: "OnboardingFlow",   path: "/onboarding" },
  { name: "SettingsProfile",  path: "/settings/profile" },
];

for (const page of PAGES) {
  test(`${page.name} — WCAG 2.1 AA`, async ({ page: pw }) => {
    await pw.goto(page.path);

    // Wait for meaningful content to render
    await pw.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page: pw })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    // Filter to critical and serious violations only
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );

    // Write results to accessibility_tests table (optional — remove
    // if you don't want CI writing to DB)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await sb.from("accessibility_tests").insert({
        test_date:        new Date().toISOString(),
        component:        page.name,
        tool:             "axe-core-playwright",
        violations_count: results.violations.length,
        severity:         blocking.length > 0 ? "critical" : "minor",
        violation_detail: results.violations,
        resolved:         false,
      });
    }

    // Assert — blocking violations fail the PR
    expect(blocking, `${page.name} has ${blocking.length} critical/serious WCAG 2.1 AA violation(s):\n` +
      blocking.map(v => `  • [${v.impact}] ${v.id}: ${v.description}`).join("\n")
    ).toHaveLength(0);
  });
}
