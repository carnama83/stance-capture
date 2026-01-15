//src/components/PageLayout.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import AppTopBar from "./AppTopBar";
import { SearchBar } from "./search/SearchBar";

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

    
  );
}
