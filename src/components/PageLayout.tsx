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
    <div className="min-h-screen bg-white">
      <AppTopBar rightSlot={rightSlot} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
