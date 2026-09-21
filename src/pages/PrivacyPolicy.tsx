/**
 * FILE PLACEMENT — place this file at:
 *
 *     src/pages/PrivacyPolicy.tsx
 *
 * Wrapped in <PageLayout> so the app header (AppTopBar) shows on this page,
 * exactly like Index.tsx and your other pages. The global <Footer /> mounted
 * in App.tsx renders below automatically.
 *
 * Route is already wired in App.tsx:
 *   <Route path="/privacy" element={<PrivacyPolicy />} />
 *
 * NOTE: This is a practical starter template, not legal advice. Review and
 * adapt it to how your service actually handles data before publishing.
 *
 * The contact address comes from src/lib/contact.ts, so the policy, the
 * footer and the About page cannot drift apart.
 *
 * LOCALIZATION — the clauses live in the i18n catalogue under `privacy.*`,
 * one key per clause. They are NOT split into fragments: a legal sentence has
 * to be re-orderable as a unit, and a reviewer has to be able to read each
 * clause end to end in both languages. Bold terms are a <b> slot inside the
 * clause so the emphasis can sit wherever the target language puts the term.
 *
 * The English text is the source of record. If you change a clause here,
 * change `privacy.*` in BOTH locales — `npm run test:i18n:parity` will catch a
 * missing key but cannot tell you a translation has gone stale.
 */

import { CSSProperties } from "react";
import { Trans, useTranslation } from "react-i18next";
import PageLayout from "@/components/PageLayout";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";

/** Source of record for the "Last updated" line; rendered in the UI locale. */
const LAST_UPDATED_ISO = "2026-09-20";

export default function PrivacyPolicy() {
  const { t, i18n } = useTranslation();

  // en-IN, not localeFor("en") — plain "en" formats this as "June 19, 2026",
  // and the date on a legal document must not silently change shape when the
  // page is refactored. en-IN reproduces the original "19 June 2026" exactly
  // and is the right variant for an India-based service. Scoped here rather
  // than changed in localeFor(), which would reformat every English date in
  // the app.
  const lastUpdated = new Intl.DateTimeFormat(
    i18n.language === "hi" ? "hi-IN" : "en-IN",
    { dateStyle: "long", timeZone: "UTC" },
  ).format(new Date(LAST_UPDATED_ISO + "T00:00:00Z"));

  /** A clause whose bold term has to move with the language. */
  const clause = (key: string) => (
    <li style={styles.li} key={key}>
      <Trans i18nKey={key} components={{ b: <strong /> }} />
    </li>
  );

  /** A clause with no bold term. */
  const plain = (key: string) => (
    <li style={styles.li} key={key}>
      {t(key)}
    </li>
  );

  return (
    <PageLayout>
      <div style={styles.page}>
        <article style={styles.card}>
          <p style={styles.eyebrow}>{t("privacy.eyebrow")}</p>
          <h1 style={styles.h1}>{t("privacy.title")}</h1>
          <p style={styles.updated}>{t("privacy.lastUpdated", { date: lastUpdated })}</p>

          <p style={styles.body}>{t("privacy.intro")}</p>

          <h2 style={styles.h2}>{t("privacy.s1.heading")}</h2>
          <p style={styles.subhead}>{t("privacy.s1.provided")}</p>
          <ul style={styles.list}>
            {["privacy.s1.stances", "privacy.s1.account", "privacy.s1.messages"].map(clause)}
          </ul>
          <p style={styles.subhead}>{t("privacy.s1.automatic")}</p>
          <ul style={styles.list}>
            {["privacy.s1.usage", "privacy.s1.location", "privacy.s1.cookies"].map(clause)}
          </ul>

          <h2 style={styles.h2}>{t("privacy.s2.heading")}</h2>
          <ul style={styles.list}>
            {[
              "privacy.s2.operate",
              "privacy.s2.aggregate",
              "privacy.s2.improve",
              "privacy.s2.communicate",
            ].map(plain)}
          </ul>

          <h2 style={styles.h2}>{t("privacy.s3.heading")}</h2>
          <ul style={styles.list}>
            {[
              "privacy.s3.aggregated",
              "privacy.s3.vendors",
              "privacy.s3.legal",
              "privacy.s3.transfers",
            ].map(clause)}
          </ul>
          <p style={styles.body}>{t("privacy.s3.noSale")}</p>

          <h2 style={styles.h2}>{t("privacy.s4.heading")}</h2>
          <p style={styles.body}>{t("privacy.s4.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s5.heading")}</h2>
          <p style={styles.body}>{t("privacy.s5.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s6.heading")}</h2>
          <p style={styles.body}>{t("privacy.s6.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s7.heading")}</h2>
          <p style={styles.body}>
            <Trans
              i18nKey="privacy.s7.body"
              values={{ email: CONTACT_EMAIL }}
              components={{ a: <a style={styles.link} href={CONTACT_MAILTO} /> }}
            />
          </p>

          <h2 style={styles.h2}>{t("privacy.s8.heading")}</h2>
          <p style={styles.body}>{t("privacy.s8.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s9.heading")}</h2>
          <p style={styles.body}>{t("privacy.s9.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s10.heading")}</h2>
          <p style={styles.body}>{t("privacy.s10.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s11.heading")}</h2>
          <p style={styles.body}>{t("privacy.s11.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s12.heading")}</h2>
          <p style={styles.body}>{t("privacy.s12.body")}</p>

          <h2 style={styles.h2}>{t("privacy.s13.heading")}</h2>
          <p style={styles.body}>
            {t("privacy.s13.org")}
            <br />
            {t("privacy.s13.address")}
            <br />
            {t("privacy.s13.emailLabel")}{" "}
            <a style={styles.link} href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </article>
      </div>
    </PageLayout>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#F8FAFC",
    padding: "clamp(1.5rem, 5vw, 3.5rem) 1rem",
    color: "#18181B",
  },
  card: {
    maxWidth: "720px",
    margin: "0 auto",
    background: "#FFFFFF",
    borderRadius: "16px",
    border: "1px solid rgba(15,23,42,0.06)",
    boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
    padding: "clamp(1.75rem, 4vw, 3rem)",
  },
  eyebrow: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#6D28D9",
  },
  h1: {
    margin: "0.5rem 0 0.5rem",
    fontSize: "clamp(1.9rem, 5vw, 2.6rem)",
    lineHeight: 1.1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  updated: {
    fontSize: "0.9rem",
    color: "#71717A",
    margin: "0 0 2rem",
  },
  h2: {
    fontSize: "1.25rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    margin: "2rem 0 0.85rem",
  },
  subhead: {
    fontSize: "1rem",
    fontWeight: 600,
    color: "#27272A",
    margin: "1rem 0 0.5rem",
  },
  body: {
    fontSize: "1.05rem",
    lineHeight: 1.7,
    color: "#3F3F46",
    marginBottom: "1.1rem",
  },
  list: {
    margin: "0 0 1.1rem",
    paddingLeft: "1.25rem",
    listStyleType: "disc",
  },
  li: {
    marginBottom: "0.6rem",
    fontSize: "1.05rem",
    lineHeight: 1.6,
    color: "#3F3F46",
  },
  link: {
    color: "#6D28D9",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
};
