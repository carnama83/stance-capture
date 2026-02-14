//src/components/PageLayout.tsx
import * as React from "react";
import AppTopBar from "./AppTopBar";

export default function PageLayout({
  rightSlot,
  children,
}: {
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* v0-style sticky, frosted header wrapper (AppTopBar internals unchanged) */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-md">
        <AppTopBar rightSlot={rightSlot} />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
