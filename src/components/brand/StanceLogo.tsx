// src/components/brand/StanceLogo.tsx
// The Stance Capture mark (same drawing as AppTopBar's inline logo), for pages
// that render without AppTopBar — e.g. the Question Insight Report and its PDF.

import * as React from "react";

const GRADIENT_STOPS = [
  { offset: "0", color: "#6366F1" },
  { offset: "0.55", color: "#8B5CF6" },
  { offset: "1", color: "#EC4899" },
];

function markBody(gradientId: string): string {
  return `<rect width="100" height="100" rx="26" fill="url(#${gradientId})"/>
<rect x="22" y="45.5" width="56" height="9" rx="4.5" fill="#fff" opacity="0.5"/>
<g fill="#fff" opacity="0.45">
<rect x="20.5" y="42" width="3" height="16" rx="1.5"/><rect x="34.5" y="42" width="3" height="16" rx="1.5"/>
<rect x="48.5" y="42" width="3" height="16" rx="1.5"/><rect x="62.5" y="42" width="3" height="16" rx="1.5"/>
<rect x="76.5" y="42" width="3" height="16" rx="1.5"/>
</g>
<circle cx="64" cy="50" r="12" fill="#fff"/>`;
}

function gradientDef(gradientId: string): string {
  return `<linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">${GRADIENT_STOPS.map(
    (s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`,
  ).join("")}</linearGradient>`;
}

/**
 * The mark as a data: URI, sized in px. For places only CSS can reach, such as
 * the @page margin boxes that repeat a header on every printed page.
 */
export function stanceLogoDataUri(sizePx: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 100 100"><defs>${gradientDef(
    "g",
  )}</defs>${markBody("g")}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function StanceLogo({ className }: { className?: string }) {
  // Unique per instance: two logos on one page must not share a gradient id.
  const gradientId = `scLogo${React.useId().replace(/:/g, "")}`;
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: `<defs>${gradientDef(gradientId)}</defs>${markBody(gradientId)}` }}
    />
  );
}
