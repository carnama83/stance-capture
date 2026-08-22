// src/auth/WhatsAppSignInButton.tsx
//
// The missing piece for WhatsApp-created accounts: they have no password
// and no real, deliverable email (the synthetic wa-<uuid>@phone.stance
// capture.internal address exists only so Supabase's magic-link machinery
// has something to anchor to — see getOrCreateWhatsAppSigninLink in
// whatsapp-flow-webhook). The ONLY way back into the account was ever the
// one-time link in the original SUBSCRIBE confirmation — once used or
// expired, on a new device, with cleared storage, there was no way back at
// all, and nothing on the site ever told anyone this was even a concern.
//
// getOrCreateWhatsAppSigninLink already mints a fresh sign-in token on
// EVERY SUBSCRIBE, existing account or not — the repeatable mechanism
// already existed, it just had no discoverable entry point outside of
// already being mid-conversation with the bot. This button is that entry
// point: same wa.me / SUBSCRIBE pattern WebOptInCard.tsx and
// HomeOptInPrompt.tsx already use, just reachable from the actual login
// page instead of only after staging an answer.
//
// No device_id here (unlike those two callers) — a login-page visit has
// nothing staged to attach.
import * as React from "react";
import { buildWaHref } from "@/lib/whatsapp";

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.48 1.32 5L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2Zm5.8 14.03c-.24.68-1.4 1.33-1.93 1.4-.5.08-1.12.11-1.8-.11-.42-.13-.95-.31-1.64-.6-2.88-1.24-4.76-4.13-4.9-4.32-.14-.19-1.17-1.56-1.17-2.98 0-1.41.74-2.11 1-2.4.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.02 1.12.99 2.06 1.31 2.35 1.46.29.14.46.12.63-.08.17-.19.72-.84.91-1.13.19-.29.38-.24.64-.14.26.1 1.66.78 1.94.92.29.14.48.22.55.34.07.13.07.72-.17 1.4Z"
      />
    </svg>
  );
}

export default function WhatsAppSignInButton() {
  return (
    <a
      href={buildWaHref("SUBSCRIBE")}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "w-full flex items-center justify-center gap-3 rounded-lg border px-4 py-2.5",
        "text-sm font-medium transition-colors",
        "bg-[#25D366] hover:bg-[#20BD5A]",
        "text-white border-transparent",
      ].join(" ")}
      aria-label="Sign in via WhatsApp"
    >
      <WhatsAppIcon />
      <span>Sign in via WhatsApp</span>
    </a>
  );
}
