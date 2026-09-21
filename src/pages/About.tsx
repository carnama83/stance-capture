/**
 * FILE PLACEMENT — place this file at:
 *
 *     src/pages/About.tsx
 *
 * Wrapped in <PageLayout> so the app header (AppTopBar) shows on this page,
 * exactly like Index.tsx and your other pages. The global <Footer /> mounted
 * in App.tsx renders below automatically.
 *
 * Route is already wired in App.tsx:
 *   <Route path="/about" element={<About />} />
 *
 * TODO: replace the contact email below with a real, monitored address.
 */

import { CSSProperties } from "react";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";
import PageLayout from "@/components/PageLayout";
import { useTranslation } from "react-i18next";

export default function About() {
  const { t } = useTranslation();
  return (
    <PageLayout>
      <div style={styles.page}>
        <article style={styles.card}>
          <p style={styles.eyebrow}>{t("footer.about")}</p>
          <h1 style={styles.h1}>{t("about.stanceCapture")}</h1>

          <p style={styles.lead}>
            {t("about.stanceCaptureIsACivic")}
          </p>

          <p style={styles.body}>
            {t("about.publicOpinionIsUsuallyScattered")}
          </p>

          <h2 style={styles.h2}>{t("about.whatWeDo")}</h2>
          <ul style={styles.list}>
            <li style={styles.li}>
              {t("about.letYouWeighInOn")}
            </li>
            <li style={styles.li}>
              {t("about.showHowYourViewCompares")}
            </li>
            <li style={styles.li}>
              {t("about.trackHowOpinionsMoveOver")}
            </li>
            <li style={styles.li}>
              {t("about.helpYouBuildAPersonal")}
            </li>
          </ul>

          <h2 style={styles.h2}>{t("footer.contact")}</h2>
          <p style={styles.body}>
            {t("about.forQuestionsFeedbackOrPress")}{" "}
            <a style={styles.link} href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>

          <hr style={styles.rule} />
          <p style={styles.meta}>{t("about.stanceCaptureBhopalIndia")}</p>
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
    margin: "0.5rem 0 1.25rem",
    fontSize: "clamp(1.9rem, 5vw, 2.6rem)",
    lineHeight: 1.1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  lead: {
    fontSize: "clamp(1.05rem, 2.5vw, 1.25rem)",
    lineHeight: 1.6,
    color: "#27272A",
    marginBottom: "1.5rem",
  },
  body: {
    fontSize: "1.05rem",
    lineHeight: 1.7,
    color: "#3F3F46",
    marginBottom: "1.25rem",
  },
  h2: {
    fontSize: "1.3rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    margin: "2.25rem 0 1rem",
  },
  list: {
    margin: "0 0 1.25rem",
    paddingLeft: "1.25rem",
    listStyleType: "disc",
  },
  li: {
    marginBottom: "0.75rem",
    fontSize: "1.05rem",
    lineHeight: 1.6,
    color: "#3F3F46",
  },
  link: {
    color: "#6D28D9",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  rule: {
    border: "none",
    borderTop: "1px solid #E4E4E7",
    margin: "2.5rem 0 1.25rem",
  },
  meta: {
    fontSize: "0.9rem",
    color: "#71717A",
    margin: 0,
  },
};
