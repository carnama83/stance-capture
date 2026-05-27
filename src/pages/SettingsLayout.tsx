// src/pages/SettingsLayout.tsx
// UPDATED VERSION: Uses consistent AppTopBar via wrapper

import * as React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import AppTopBar from "@/components/AppTopBar";

export default function SettingsLayout() {
  return (
    <div className="min-h-screen bg-white">
      {/* ✅ Consistent header across all pages */}
      <AppTopBar />
      
      <div className="max-w-6xl mx-auto p-4">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage your account preferences and privacy settings
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Sidebar navigation */}
          <aside className="md:col-span-1">
            <nav className="space-y-1 text-sm">
              <SettingsLink to={ROUTES.SETTINGS_PROFILE} label="Profile" />
              <SettingsLink to={ROUTES.SETTINGS_SECURITY} label="Security" />
              <SettingsLink to={ROUTES.SETTINGS_SESSIONS} label="Sessions" />
              <SettingsLink to="/settings/location" label="Location" />
              <SettingsLink to="/settings/constituency" label="Election Constituency" />
              <SettingsLink to="/settings/notifications" label="Notifications" />
              <SettingsLink to="/settings/privacy" label="Privacy" />
              <SettingsLink to="/settings/account" label="Account & Data" />
            </nav>
            
            {/* Divider */}
            <div className="my-4 border-t" />
            
            {/* Secondary navigation */}
            <nav className="space-y-1 text-sm">
              <SettingsLink to="/me/stances" label="My Stances" />
            </nav>
          </aside>

          {/* Main content area */}
          <main className="md:col-span-3">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function SettingsLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block rounded px-3 py-2 transition-colors ${
          isActive 
            ? "bg-slate-100 font-medium text-slate-900" 
            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
        }`
      }
      end
    >
      {label}
    </NavLink>
  );
}
