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

// Tiny error boundary so a crashing page doesn't blank the app
class RouteBoundary extends React.Component<{ children: React.ReactNode }, { err?: any }> {
  state = { err: undefined as any };
  static getDerivedStateFromError(err: any) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16 }}>
          <h2>Something went wrong on this page.</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {String(this.state.err?.stack || this.state.err?.message || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children as any;
  }
}

export default function App() {
  return (
    <HashRouter>
      <AuthReadyGate>
        <RouteBoundary>
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

            {/* ---------- Admin (nested, admin-only) ---------- */}
            <Route
              path="/admin"
              element={
                <AdminOnly>
                  <AdminLayout />
                </AdminOnly>
              }
            >
              <Route index element={<Navigate to="sources" replace />} />
              <Route path="sources" element={<AdminSources />} />
              <Route path="ingestion" element={<AdminIngestion />} />
              <Route path="drafts" element={<AdminDrafts />} />
            </Route>

            {/* ---------- 404 (keep LAST) ---------- */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </RouteBoundary>
      </AuthReadyGate>
    </HashRouter>
  );
}
