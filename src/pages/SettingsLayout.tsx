// src/pages/SettingsLayout.tsx
// UPDATED VERSION: Uses consistent AppTopBar via wrapper

import * as React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import AppTopBar from "@/components/AppTopBar";
import { useTranslation } from "react-i18next";

export default function SettingsLayout() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-white">
      {/* ✅ Consistent header across all pages */}
      <AppTopBar />
      
      <div className="max-w-6xl mx-auto p-4">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">{t("settingsLayout.settings")}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {t("settingsLayout.manageYourAccountPreferencesAnd")}
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Sidebar navigation */}
          <aside className="md:col-span-1">
            <nav className="space-y-1 text-sm">
              <SettingsLink to={ROUTES.SETTINGS_PROFILE} label={t("nav.profile")} />
              <SettingsLink to={ROUTES.SETTINGS_SECURITY} label={t("settingsSecurity.security")} />
              <SettingsLink to={ROUTES.SETTINGS_SESSIONS} label={t("settingsSessions.sessions")} />
              <SettingsLink to="/settings/location" label={t("nav.location")} />
              <SettingsLink to="/settings/constituency" label={t("constituency.electionConstituency")} />
              <SettingsLink to="/settings/notifications" label={t("settingsNotif.notifications")} />
              <SettingsLink to="/settings/privacy" label={t("nav.privacy")} />
              <SettingsLink to="/settings/account" label={t("settingsAccount.accountData")} />
            </nav>
            
            {/* Divider */}
            <div className="my-4 border-t" />
            
            {/* Secondary navigation */}
            <nav className="space-y-1 text-sm">
              <SettingsLink to="/me/stances" label={t("nav.myStances")} />
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
