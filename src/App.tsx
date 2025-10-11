import * as React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";

// --- UI providers (keep what your project already uses) ---
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

// Admin pages for Epic B
import AdminLayout from "@/routes/admin/_layout";
import AdminSourcesPage from "@/routes/admin/sources/Index";
import AdminIngestionPage from "@/routes/admin/ingestion/Index";
import AdminDraftsPage from "@/routes/admin/drafts/Index";

// --- Gate to avoid initial auth race ---
import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";

// --- Pages (adjust paths if yours differ) ---
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

const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <HashRouter>
          {/* Wait for Supabase to resolve initial auth state BEFORE rendering any routes */}
          <AuthReadyGate>
            <Routes>
              {/* Home / Index */}
              <Route path="/" element={<Index />} />
              <Route path="/index" element={<Index />} />

              {/* Auth (guarded appropriately) */}
              <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
              <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
              <Route path="/reset-password" element={<PublicOnly><ResetPassword /></PublicOnly>} />

              {/* Profile & Settings (protected) */}
              <Route path="/profile" element={<Protected><Profile /></Protected>} />
              <Route path="/settings/profile" element={<Protected><SettingsProfile /></Protected>} />
              <Route path="/settings/security" element={<Protected><SettingsSecurity /></Protected>} />
              <Route path="/settings/sessions" element={<Protected><SettingsSessions /></Protected>} />

              {/* Admin (Epic B) */}
              {/* Admin shell with nested pages */}
              <Route path="/admin" element={<Protected><AdminLayout /></Protected>}>
                {/* Optional admin landing: show Sources by default */}
                <Route index element={<AdminOnly><AdminSourcesPage /></AdminOnly>} />
                <Route path="sources" element={<AdminOnly><AdminSourcesPage /></AdminOnly>} />
                <Route path="ingestion" element={<AdminOnly><AdminIngestionPage /></AdminOnly>} />
                <Route path="drafts" element={<AdminOnly><AdminDraftsPage /></AdminOnly>} />
                {/* Existing admin page example */}
                <Route path="identifiers" element={<AdminOnly><AdminIdentifiers /></AdminOnly>} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthReadyGate>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
