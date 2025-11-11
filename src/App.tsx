// src/App.tsx
import * as React from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

// --- Auth gates (as in your project) ---
import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";

// --- Public pages (keep your existing ones) ---
import Index from "./pages/Index";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import SettingsProfile from "./pages/SettingsProfile";
import SettingsSecurity from "./pages/SettingsSecurity";
import SettingsSessions from "./pages/SettingsSessions";
import AdminIdentifiers from "./pages/AdminIdentifiers";
import NotFound from "./pages/NotFound";

// --- Admin (Epic B) ---
// NOTE: your file is named `layout.tsx` (not `_layout.tsx`)
import AdminLayout from "@/routes/admin/_layout";
import AdminSourcesPage from "@/routes/admin/sources/Index";
import AdminIngestionPage from "@/routes/admin/ingestion/Index";
import AdminDraftsPage from "@/routes/admin/drafts/Index";

// --- Topics route to fix Explore link ---
import TopicsIndex from "@/routes/topics/Index"; // this file is added below

const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <AuthReadyGate>
            <Routes>
              {/* ---------- Public ---------- */}
              <Route path="/" element={<Index />} />
              <Route path="/index" element={<Index />} />
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
              <Route
                path="/reset-password"
                element={
                  <PublicOnly>
                    <ResetPassword />
                  </PublicOnly>
                }
              />

              {/* ---------- Topics (Explore) ---------- */}
              <Route path="/topics" element={<TopicsIndex />} />
              <Route path="/explore" element={<Navigate to="/topics" replace />} />

              {/* ---------- Protected (user) ---------- */}
              <Route
                path="/profile"
                element={
                  <Protected>
                    <Profile />
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

              {/* ---------- Admin (nested) ---------- */}
              <Route
                path="/admin"
                element={
                  <Protected>
                    <AdminOnly>
                      <AdminLayout />
                    </AdminOnly>
                  </Protected>
                }
              >
                {/* index → Sources by default */}
                <Route index element={<AdminSourcesPage />} />
                <Route path="sources" element={<AdminSourcesPage />} />
                <Route path="ingestion" element={<AdminIngestionPage />} />
                <Route path="drafts" element={<AdminDraftsPage />} />
              </Route>

              {/* Optional admin identifiers page (non-nested if you want it separate) */}
              <Route
                path="/admin/identifiers"
                element={
                  <Protected>
                    <AdminOnly>
                      <AdminIdentifiers />
                    </AdminOnly>
                  </Protected>
                }
              />

              {/* ---------- 404 ---------- */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthReadyGate>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
