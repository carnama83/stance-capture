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

      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link to="/" className="font-bold text-lg text-slate-900">
            Stance
          </Link>
          
      
          {/* Navigation links */}
          <nav className="flex items-center gap-4">
            <Link to="/for-you" className="text-sm text-slate-700 hover:text-slate-900">
              For You
            </Link>
            <Link to="/topics" className="text-sm text-slate-700 hover:text-slate-900">
              Topics
            </Link>
          </nav>
        </div>
      </header>
      
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
