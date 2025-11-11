// src/pages/SettingsLayout.tsx
import * as React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ROUTES } from "@/routes/paths";

export default function SettingsLayout() {
  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-4">Settings</h1>
      <div className="grid md:grid-cols-4 gap-6">
        <aside className="md:col-span-1">
          <nav className="space-y-1 text-sm">
            <SettingsLink to={ROUTES.SETTINGS_PROFILE} label="Profile" />
            <SettingsLink to={ROUTES.SETTINGS_SECURITY} label="Security" />
            <SettingsLink to={ROUTES.SETTINGS_SESSIONS} label="Sessions" />
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
