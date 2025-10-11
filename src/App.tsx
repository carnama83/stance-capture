import * as React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";

// --- UI providers (keep what your project already uses) ---
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";


// imports for admin pages for Epic B
//import { Routes, Route } from "react-router-dom";
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
import { userMessageFromError } from "./lib/errors";
// ...
try {
  // RPC / query
} catch (e) {
  setMsg(userMessageFromError(e));
}



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

              {/* Auth */}
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Profile & Settings */}
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings/profile" element={<SettingsProfile />} />
              <Route path="/settings/security" element={<SettingsSecurity />} />
              <Route path="/settings/sessions" element={<SettingsSessions />} />


              // routes for Epic B for admin pages
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminSourcesPage />} />
                <Route path="sources" element={<AdminSourcesPage />} />
                <Route path="ingestion" element={<AdminIngestionPage />} />
                <Route path="drafts" element={<AdminDraftsPage />} />
              </Route>

              
              {/* Auth Ready Gate */}
              <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
              <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
              <Route path="/profile" element={<Protected><Profile /></Protected>} />

              
              {/* Admin */}
             // <Route path="/admin/identifiers" element={<AdminIdentifiers />} />

               <Route
                  path="/admin/identifiers"
                  element={
                    <Protected>
                      <AdminOnly><AdminIdentifiers /></AdminOnly>
                    </Protected>
                  }
                />
  
        
              
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
