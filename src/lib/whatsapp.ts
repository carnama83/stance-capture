// src/lib/whatsapp.ts
//
// Shared WhatsApp Business number + wa.me link builder. Previously
// duplicated as a local WA_BUSINESS_NUMBER const in both WebOptInCard.tsx
// and HomeOptInPrompt.tsx — centralized here so a number change only needs
// updating in one place, and so new callers (e.g. the "Sign in via
// WhatsApp" button on Login.tsx) don't introduce a third copy.

export const WA_BUSINESS_NUMBER = "12014667244"; // +1 201-466-7244, digits only

export function buildWaHref(text: string): string {
  return `https://wa.me/${WA_BUSINESS_NUMBER}?text=${encodeURIComponent(text)}`;
}
