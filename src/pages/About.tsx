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
import PageLayout from "@/components/PageLayout";

export default function About() {
  return (
    <PageLayout>
      <div style={styles.page}>
        <article style={styles.card}>
          <p style={styles.eyebrow}>About</p>
          <h1 style={styles.h1}>Stance Capture</h1>

          <p style={styles.lead}>
            Stance Capture is a civic-technology platform where people take a
            position on the issues shaping public life &mdash; and instantly see
            how their views compare with others across their region, country, and
            the world.
          </p>

          <p style={styles.body}>
            Public opinion is usually scattered, anecdotal, and hard to read. We
            turn it into something clear and structured: a way for individuals to
            understand where they stand, and a way for communities to see how
            collective sentiment forms and shifts over time.
          </p>

          <h2 style={styles.h2}>What we do</h2>
          <ul style={styles.list}>
            <li style={styles.li}>
              Let you weigh in on real issues and questions, one stance at a time.
            </li>
            <li style={styles.li}>
              Show how your view compares with your region, your country, and the
              world.
            </li>
            <li style={styles.li}>
              Track how opinions move over time, so shifts in sentiment become
              visible.
            </li>
            <li style={styles.li}>
              Help you build a personal stance profile that is yours to revisit.
            </li>
          </ul>

          <h2 style={styles.h2}>Contact</h2>
          <p style={styles.body}>
            For questions, feedback, or press enquiries, reach us at{" "}
            <a style={styles.link} href="mailto:no-reply@stance-capture.com">
              no-reply@stance-capture.com
            </a>
            .
          </p>

          <hr style={styles.rule} />
          <p style={styles.meta}>Stance Capture &middot; Bhopal, India</p>
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
