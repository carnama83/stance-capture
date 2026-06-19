/**
 * FILE PLACEMENT — suggested location in your repo:
 *
 *     src/routes/About.tsx
 *
 * Your repo keeps route-level pages under src/routes/ (e.g.
 * src/routes/admin/manifesto-promises/Index.tsx), so this page belongs there.
 * Adjust the folder name if yours differs.
 */

import { CSSProperties } from "react";

/**
 * About page for Stance Capture.
 *
 * Wire it into your router, e.g. (HashRouter):
 *   <Route path="/about" element={<About />} />
 * then link to it with  href="#/about"  (see Footer.tsx).
 *
 * TODO: replace the contact email below with a real, monitored address.
 */
export default function About() {
  return (
    <main style={styles.page}>
      <article style={styles.container}>
        <p style={styles.eyebrow}>About</p>
        <h1 style={styles.h1}>Stance Capture</h1>

        <p style={styles.lead}>
          Stance Capture is a civic-technology platform where people take a
          position on the issues shaping public life — and instantly see how
          their views compare with others across their region, country, and the
          world.
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
        <p style={styles.meta}>Stance Capture · Bhopal, India</p>
      </article>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#FFFFFF",
    color: "#18181B",
    padding: "clamp(2rem, 6vw, 5rem) 1.25rem",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  container: {
    maxWidth: "680px",
    margin: "0 auto",
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
    fontSize: "clamp(2rem, 5vw, 2.75rem)",
    lineHeight: 1.1,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  lead: {
    fontSize: "clamp(1.1rem, 2.5vw, 1.3rem)",
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
    fontSize: "1.35rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    margin: "2.5rem 0 1rem",
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
    margin: "3rem 0 1.25rem",
  },
  meta: {
    fontSize: "0.9rem",
    color: "#71717A",
    margin: 0,
  },
};
