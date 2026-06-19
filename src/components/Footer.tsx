/**
 * FILE PLACEMENT — suggested location in your repo:
 *
 *     src/components/Footer.tsx
 *
 * This is a shared, reusable UI component, so it belongs under src/components/
 * (alongside your other shared components), not in src/routes/.
 * Adjust the folder name if yours differs.
 */

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
  return (
    <footer style={styles.footer}>
      <div style={styles.inner}>
        <div style={styles.brandCol}>
          <p style={styles.brand}>Stance Capture</p>
          <p style={styles.tagline}>
            A civic-technology platform for capturing public opinion and
            revealing how views compare and change over time.
          </p>
        </div>

        <nav style={styles.nav} aria-label="Footer">
          <a style={styles.navLink} href="#/about">
            About
          </a>
          <a style={styles.navLink} href="#/privacy">
            Privacy
          </a>
          <a style={styles.navLink} href="mailto:your-email@gmail.com">
            Contact
          </a>
        </nav>
      </div>

      <div style={styles.bottomBar}>
        <span>© {new Date().getFullYear()} Stance Capture</span>
        <span style={styles.dot}>·</span>
        <span>Bhopal, India</span>
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
