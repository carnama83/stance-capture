// Single source of truth for the public contact address.
//
// It was previously written out in three places with two different values:
// a `your-email@gmail.com` placeholder in PrivacyPolicy.tsx and in the
// site-wide Footer, and a real address hardcoded in About.tsx — and in
// About's case the address itself had been captured as an i18n key, so it sat
// in the catalogue in both locales and would have had to be "translated" to
// change. An email address is not translatable content.
//
// NOTE: the privacy policy (§7) directs users here to exercise access and
// deletion rights, so this mailbox has to be monitored and replyable
// regardless of what it is called.
export const CONTACT_EMAIL = "no-reply@stance-capture.com";

/** `mailto:` href for CONTACT_EMAIL. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
