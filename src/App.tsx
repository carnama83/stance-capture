// src/App.tsx
import * as React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";

// ----- UI providers (keep exactly as in your project) -----
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";     // if you use shadcn Toaster
import { Sonner } from "@/components/ui/sonner";       // if you use Sonner

// ----- Auth readiness gate (prevents first-paint redirect races) -----
import AuthReadyGate from "./components/AuthReadyGate";

// ----- Pages -----
import Index from "./pages/Index";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import SettingsProfile from "./pages/SettingsProfile";
import SettingsSecurity from "./pages/SettingsSecurity";
import SettingsSessions from "./pages/SettingsSessions";
import AdminIdentifiers from "./pages/AdminIdentifiers";
import NotFound from "./pages/NotFound"; // keep your existing 404

// If you already create the client elsewhere, reuse it.
const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />

        <HashRouter>
          {/* Wait for Supabase INITIAL_SESSION before rendering routes */}
          <AuthReadyGate>
            <Routes>
              {/* Home / Index */}
              <Route path="/" element={<Index />} />
              <Route path="/index" element={<Index />} />

              {/* Auth */}
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Profile & Settings */}
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings/profile" element={<SettingsProfile />} />
              <Route path="/settings/security" element={<SettingsSecurity />} />
              <Route path="/settings/sessions" element={<SettingsSessions />} />

              {/* Admin */}
              <Route path="/admin/identifiers" element={<AdminIdentifiers />} />

              {/* Fallback */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthReadyGate>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
