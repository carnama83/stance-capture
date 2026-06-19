/**
 * FILE PLACEMENT — suggested location in your repo:
 *
 *     src/routes/PrivacyPolicy.tsx
 *
 * Your repo keeps route-level pages under src/routes/ (e.g.
 * src/routes/admin/manifesto-promises/Index.tsx), so this page belongs there.
 * Adjust the folder name if yours differs.
 */

import { CSSProperties } from "react";

/**
 * Privacy Policy page for Stance Capture.
 *
 * Wire it into your router, e.g. (HashRouter):
 *   <Route path="/privacy" element={<PrivacyPolicy />} />
 * then link to it with  href="#/privacy"  (see Footer.tsx).
 *
 * NOTE: This is a practical starter template, not legal advice. Review and
 * adapt it to how your service actually handles data before publishing, and
 * have a professional check it if you can.
 *
 * TODO: replace the contact email below with a real, monitored address.
 */
export default function PrivacyPolicy() {
  return (
    <main style={styles.page}>
      <article style={styles.container}>
        <p style={styles.eyebrow}>Legal</p>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.updated}>Last updated: 19 June 2026</p>

        <p style={styles.body}>
          Stance Capture (&ldquo;Stance Capture,&rdquo; &ldquo;we,&rdquo;
          &ldquo;us&rdquo;) operates the Stance Capture platform, including our
          website and services delivered through messaging channels such as
          WhatsApp. This Privacy Policy explains what information we collect, how
          we use it, and the choices you have.
        </p>

        <h2 style={styles.h2}>1. Information we collect</h2>
        <p style={styles.subhead}>Information you provide</p>
        <ul style={styles.list}>
          <li style={styles.li}>
            <strong>Stances and responses</strong> — the positions you take on
            questions, including any text you add.
          </li>
          <li style={styles.li}>
            <strong>Account information</strong> — if you create an account,
            details such as your name, email address, and login credentials.
          </li>
          <li style={styles.li}>
            <strong>Messages</strong> — when you interact with us through
            WhatsApp or other messaging channels, the content of those
            interactions.
          </li>
        </ul>
        <p style={styles.subhead}>Information collected automatically</p>
        <ul style={styles.list}>
          <li style={styles.li}>
            <strong>Usage and device data</strong> — pages viewed, actions
            taken, approximate location (such as region or country), browser and
            device type, and similar log data.
          </li>
          <li style={styles.li}>
            <strong>Cookies and similar technologies</strong> — used to keep you
            signed in and to understand how the service is used.
          </li>
        </ul>

        <h2 style={styles.h2}>2. How we use information</h2>
        <ul style={styles.list}>
          <li style={styles.li}>
            To operate the service — recording your stance and showing how it
            compares with others.
          </li>
          <li style={styles.li}>
            To produce aggregated, de-identified insights about how groups and
            regions respond.
          </li>
          <li style={styles.li}>To improve and secure the platform.</li>
          <li style={styles.li}>
            To communicate with you about the service, including through
            WhatsApp where you have engaged with us there.
          </li>
        </ul>

        <h2 style={styles.h2}>3. How we share information</h2>
        <ul style={styles.list}>
          <li style={styles.li}>
            <strong>Aggregated insights</strong> — we may publish or share
            aggregated, de-identified statistics that do not identify you.
          </li>
          <li style={styles.li}>
            <strong>Service providers</strong> — vendors who process data on our
            behalf (such as hosting, analytics, and messaging delivery) under
            appropriate confidentiality obligations.
          </li>
          <li style={styles.li}>
            <strong>Legal reasons</strong> — where required by law or to protect
            rights, safety, and security.
          </li>
          <li style={styles.li}>
            <strong>Business transfers</strong> — in connection with a merger,
            acquisition, or sale of assets.
          </li>
        </ul>
        <p style={styles.body}>We do not sell your personal information.</p>

        <h2 style={styles.h2}>4. WhatsApp and messaging</h2>
        <p style={styles.body}>
          We deliver some questions and collect some stances through the
          WhatsApp Business Platform, provided by Meta. When you interact with us
          on WhatsApp, your use is also governed by WhatsApp&rsquo;s own terms and
          privacy policy. We use these channels only to send questions you have
          opted into and to record the stances you choose to share. You can stop
          receiving WhatsApp messages at any time by replying STOP.
        </p>

        <h2 style={styles.h2}>5. Cookies</h2>
        <p style={styles.body}>
          We use cookies and similar technologies to keep you signed in, remember
          preferences, and measure usage. You can control cookies through your
          browser settings; disabling them may affect parts of the service.
        </p>

        <h2 style={styles.h2}>6. Data retention</h2>
        <p style={styles.body}>
          We keep personal information for as long as needed to provide the
          service and for legitimate business or legal purposes. Aggregated,
          de-identified data may be kept indefinitely.
        </p>

        <h2 style={styles.h2}>7. Your rights and choices</h2>
        <p style={styles.body}>
          Depending on where you live, you may have the right to access, correct,
          or delete your personal information, or to object to or restrict certain
          processing. To make a request, email us at{" "}
          <a style={styles.link} href="mailto:your-email@gmail.com">
            your-email@gmail.com
          </a>
          .
        </p>

        <h2 style={styles.h2}>8. Children&rsquo;s privacy</h2>
        <p style={styles.body}>
          Stance Capture is not directed to children under 16, and we do not
          knowingly collect personal information from them. If you believe a child
          has provided us information, contact us and we will delete it.
        </p>

        <h2 style={styles.h2}>9. Data location</h2>
        <p style={styles.body}>
          We are based in India and may process and store information in India and
          in other countries where we or our service providers operate.
        </p>

        <h2 style={styles.h2}>10. Security</h2>
        <p style={styles.body}>
          We use reasonable technical and organizational measures to protect your
          information. No method of transmission or storage is completely secure,
          and we cannot guarantee absolute security.
        </p>

        <h2 style={styles.h2}>11. Changes to this policy</h2>
        <p style={styles.body}>
          We may update this Privacy Policy from time to time. We will post the
          updated version here and revise the &ldquo;Last updated&rdquo; date
          above.
        </p>

        <h2 style={styles.h2}>12. Contact us</h2>
        <p style={styles.body}>
          Stance Capture
          <br />
          Bhopal, India
          <br />
          Email:{" "}
          <a style={styles.link} href="mailto:your-email@gmail.com">
            your-email@gmail.com
          </a>
        </p>
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
    margin: "0.5rem 0 0.5rem",
    fontSize: "clamp(2rem, 5vw, 2.75rem)",
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
    fontSize: "1.3rem",
    fontWeight: 700,
    letterSpacing: "-0.01em",
    margin: "2.25rem 0 0.85rem",
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
