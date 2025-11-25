// src/pages/SettingsLayout.tsx
import * as React from "react";
import { Outlet, NavLink, Link } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import { Button } from "@/components/ui/button";

export default function SettingsLayout() {
  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Header with Home action */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Link to={ROUTES.HOME}>
          <Button variant="outline" className="h-auto px-3 py-1.5 text-sm">
            Home
          </Button>
        </Link>
      </div>

      <div className="grid md:grid-cols-4 gap-6">
        <aside className="md:col-span-1">
          <nav className="space-y-1 text-sm">
            <SettingsLink to={ROUTES.SETTINGS_PROFILE} label="Profile" />
            <SettingsLink to={ROUTES.SETTINGS_SECURITY} label="Security" />
            <SettingsLink to={ROUTES.SETTINGS_SESSIONS} label="Sessions" />
            {/* NEW: Location */}
            <SettingsLink to="/settings/location" label="Location" />
            {/* My stances */}
            <SettingsLink to="/me/stances" label="My Stances" />
          </nav>
        </aside>

        <main className="md:col-span-3">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SettingsLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded px-3 py-2 hover:bg-slate-50 ${
          isActive ? "bg-slate-100 font-medium" : "text-slate-700"
        }`
      }
      end
    >
      {label}
    </NavLink>
  );
}
