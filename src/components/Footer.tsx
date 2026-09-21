/**
 * FILE PLACEMENT — suggested location in your repo:
 *
 *     src/components/Footer.tsx
 *
 * This is a shared, reusable UI component, so it belongs under src/components/
 * (alongside your other shared components), not in src/routes/.
 * Adjust the folder name if yours differs.
 */

import { useTranslation } from "react-i18next";
import { CONTACT_MAILTO } from "@/lib/contact";
import { CSSProperties } from "react";

/**
 * Site footer for Stance Capture.
 *
 * Drop <Footer /> at the bottom of your app layout so it appears on every page.
 * Links use hash routes (#/about, #/privacy) to match HashRouter. If you use
 * react-router's <Link>, swap the <a> tags accordingly.
 *
 * TODO: replace the contact email below with a real, monitored address.
 */
export default function Footer() {
  const { t } = useTranslation();
  return (
    <footer style={styles.footer}>
      <div style={styles.inner}>
        <div style={styles.brandCol}>
          <p style={styles.brand}>{t("about.stanceCapture")}</p>
          <p style={styles.tagline}>
            {t("footer.tagline")}
          </p>
        </div>

        <nav style={styles.nav} aria-label={t("footer.footer")}>
          <a style={styles.navLink} href="#/about">
            {t("footer.about")}
          </a>
          <a style={styles.navLink} href="#/privacy">
            {t("footer.privacy")}
          </a>
          <a style={styles.navLink} href={CONTACT_MAILTO}>
            {t("footer.contact")}
          </a>
        </nav>
      </div>

      <div style={styles.bottomBar}>
        <span>© {new Date().getFullYear()} {t("about.stanceCapture")}</span>
        <span style={styles.dot}>·</span>
        <span>{t("footer.location")}</span>
      </div>
    </footer>
  );
}

const styles: Record<string, CSSProperties> = {
  footer: {
    borderTop: "1px solid #E4E4E7",
    background: "#FAFAFA",
    padding: "2.5rem 1.25rem 1.75rem",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: "#3F3F46",
  },
  inner: {
    maxWidth: "1024px",
    margin: "0 auto",
    display: "flex",
    flexWrap: "wrap",
    gap: "1.5rem 3rem",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  brandCol: {
    maxWidth: "420px",
  },
  brand: {
    margin: "0 0 0.4rem",
    fontSize: "1.1rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "#18181B",
  },
  tagline: {
    margin: 0,
    fontSize: "0.92rem",
    lineHeight: 1.6,
    color: "#52525B",
  },
  nav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "1.25rem",
  },
  navLink: {
    fontSize: "0.92rem",
    fontWeight: 500,
    color: "#6D28D9",
    textDecoration: "none",
  },
  bottomBar: {
    maxWidth: "1024px",
    margin: "1.75rem auto 0",
    paddingTop: "1.25rem",
    borderTop: "1px solid #ECECEE",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.85rem",
    color: "#71717A",
  },
  dot: {
    color: "#A1A1AA",
  },
};
