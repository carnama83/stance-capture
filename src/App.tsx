import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import SettingsProfile from "./pages/SettingsProfile";
import SettingsSecurity from "./pages/SettingsSecurity";
import SettingsSessions from "./pages/SettingsSessions";
import AdminIdentifiers from "./pages/AdminIdentifiers";
import AuthReadyGate from "./components/AuthReadyGate";
// ...
<HashRouter>
  <AuthReadyGate>
    <Routes>
      {/* your routes unchanged */}
    </Routes>
  </AuthReadyGate>
</HashRouter>


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HashRouter>
        <Routes>
         // <Route path="/" element={<Navigate to="/signup" replace />} />
          <Route path="/" element={<Index />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings/profile" element={<SettingsProfile />} />
          <Route path="/settings/security" element={<SettingsSecurity />} />
          <Route path="/settings/sessions" element={<SettingsSessions />} />
          <Route path="/admin/identifiers" element={<AdminIdentifiers />} />
          {/* Keep Index if you want it separately */}
          <Route path="/index" element={<Index />} />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
