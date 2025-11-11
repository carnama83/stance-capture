// src/App.tsx — cleaned & extended with /topics + /explore redirect (no functionality dropped)
import * as React from "react";
import {
  HashRouter,
  Routes as RouterRoutes,
  Route,
  Navigate,
} from "react-router-dom";

// --- UI providers ---
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

// --- Auth & guards ---
import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";

// --- Pages ---
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

// --- Admin (Epic B) pages ---
import AdminLayout from "@/routes/admin/_layout";
import AdminSourcesPage from "@/routes/admin/sources/Index";
import AdminIngestionPage from "@/routes/admin/ingestion/Index";
import AdminDraftsPage from "@/routes/admin/drafts/Index";

// --- Topics page (NEW route to fix 404 when clicking "Explore Topics") ---
import TopicsIndex from "@/routes/topics/Index";

const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          <AuthReadyGate>
            <RouterRoutes>
              {/* ---------- Public routes ---------- */}
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

              {/* ---------- Topics (fixes Explore Topics 404) ---------- */}
              <Route path="/topics" element={<TopicsIndex />} />
              {/* Safety redirect if older links/buttons use /explore */}
              <Route path="/explore" element={<Navigate to="/topics" replace />} />

              {/* ---------- Protected (user) routes ---------- */}
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

              {/* ---------- Admin (Epic B) routes ---------- */}
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
                <Route index element={<AdminSourcesPage />} />
                <Route path="sources" element={<AdminSourcesPage />} />
                <Route path="ingestion" element={<AdminIngestionPage />} />
                <Route path="drafts" element={<AdminDraftsPage />} />
              </Route>

              {/* Optional admin identifiers page */}
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

              {/* ---------- Fallback ---------- */}
              <Route path="*" element={<NotFound />} />
            </RouterRoutes>
          </AuthReadyGate>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
