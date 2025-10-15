// src/App.tsx — drop-in
import * as React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

// --- Auth wrappers / gates ---
import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";

// --- Public pages ---
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotFound from "./pages/NotFound";

// --- User pages (protected) ---
import Profile from "./pages/Profile";
import SettingsProfile from "./pages/SettingsProfile";
import SettingsSecurity from "./pages/SettingsSecurity";
import SettingsSessions from "./pages/SettingsSessions";

// --- Admin layout + pages ---
import AdminLayout from "./routes/admin/_layout";
import AdminSources from "./routes/admin/sources/Index";
import AdminIngestion from "./routes/admin/ingestion/Index";
import AdminDrafts from "./routes/admin/drafts/Index";

export default function App() {
  return (
    <HashRouter>
      {/* Gate ensures auth/session is fully resolved before guards run */}
      <AuthReadyGate>
        <Routes>
          {/* ---------- Public routes ---------- */}
          <Route path="/" element={<Index />} />

          <Route
            path="/login"
            element={
              <PublicOnly>
                <Login />
              </PublicOnly>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicOnly>
                <Signup />
              </PublicOnly>
            }
          />

          {/* ---------- Profile (protected) ---------- */}
          <Route
            path="/profile"
            element={
              <Protected>
                <Profile />
              </Protected>
            }
          />

          {/* ---------- Settings (protected) ---------- */}
          {/* Parent redirect covers buttons that navigate to /settings */}
          <Route
            path="/settings"
            element={
              <Protected>
                <Navigate to="/settings/profile" replace />
              </Protected>
            }
          />
          <Route
            path="/settings/profile"
            element={
              <Protected>
                <SettingsProfile />
              </Protected>
            }
          />
          <Route
            path="/settings/security"
            element={
              <Protected>
                <SettingsSecurity />
              </Protected>
            }
          />
          <Route
            path="/settings/sessions"
            element={
              <Protected>
                <SettingsSessions />
              </Protected>
            }
          />

          {/* ---------- Admin (nested, protected by AdminOnly) ---------- */}
          <Route
            path="/admin"
            element={
              <AdminOnly>
                <AdminLayout />
              </AdminOnly>
            }
          >
            {/* Default subpage for /#/admin */}
            <Route index element={<Navigate to="sources" replace />} />
            <Route path="sources" element={<AdminSources />} />
            <Route path="ingestion" element={<AdminIngestion />} />
            <Route path="drafts" element={<AdminDrafts />} />
          </Route>

          {/* ---------- 404 (keep LAST) ---------- */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthReadyGate>
    </HashRouter>
  );
}
