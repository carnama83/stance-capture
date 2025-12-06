import * as React from "react";
import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";
import { ROUTES } from "@/routes/paths";
import AdminTopicsPage from "@/routes/admin/topics/Index";

import TopicDetailPage from "./pages/TopicDetailPage";

// Public pages
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

// Question detail page (user-facing)
import QuestionDetailPage from "./pages/QuestionDetailPage";

// Topics
import TopicsIndex from "@/routes/topics/Index";

// Admin Pages
import AdminLayout from "@/routes/admin/_layout";
import AdminSourcesPage from "@/routes/admin/sources/Index";
import AdminIngestionPage from "@/routes/admin/ingestion/Index";
import AdminDraftsPage from "@/routes/admin/drafts/Index";
import AdminQuestionsPage from "@/routes/admin/questions/Index";
import AdminNewsIndex from "@/routes/admin/news/Index";
import AdminLiveQuestionsPage from "@/routes/admin/live-questions/Index";
import AdminLiveQuestionShowPage from "@/routes/admin/live-questions/Show";
// NEW: AI Drafts admin page
import AdminAiDraftsPage from "@/routes/admin/ai-drafts/Index";

// My stances
import MyStancesPage from "./pages/MyStancesPage";

import SettingsLayout from "./pages/SettingsLayout";

// NEW: Settings → Location page
import SettingsLocation from "./pages/SettingsLocation";

import RouteDebug from "./components/RouteDebug";

const queryClient = new QueryClient();

const App: React.FC = () => {
  // Dev expose Supabase
  if (import.meta.env.DEV) {
    import("@/lib/createSupabase").then(({ createSupabase }) => {
      (window as any).sb = createSupabase();
      console.log("%cSupabase client (window.sb)", "color: green;");
    });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <AuthReadyGate>
            <RouteDebug />
            <Routes>
              {/* Public */}
              <Route path={ROUTES.HOME} element={<Index />} />
              <Route path={ROUTES.INDEX} element={<Index />} />

              <Route
                path={ROUTES.LOGIN}
                element={
                  <PublicOnly>
                    <Login />
                  </PublicOnly>
                }
              />

              <Route
                path={ROUTES.SIGNUP}
                element={
                  <PublicOnly>
                    <Signup />
                  </PublicOnly>
                }
              />

              <Route
                path={ROUTES.RESET_PASSWORD}
                element={
                  <PublicOnly>
                    <ResetPassword />
                  </PublicOnly>
                }
              />

              {/* Question detail (user-facing) */}
              <Route path="/q/:id" element={<QuestionDetailPage />} />

              {/* Topics */}
              <Route path={ROUTES.TOPICS} element={<TopicsIndex />} />
              <Route
                path={ROUTES.EXPLORE}
                element={<Navigate to={ROUTES.TOPICS} replace />}
              />

              {/* Settings (protected) */}
              <Route
                path="/settings"
                element={
                  <Protected>
                    <SettingsLayout />
                  </Protected>
                }
              >
                <Route
                  index
                  element={<Navigate to={ROUTES.SETTINGS_PROFILE} replace />}
                />
                <Route path="profile" element={<SettingsProfile />} />
                <Route path="security" element={<SettingsSecurity />} />
                <Route path="sessions" element={<SettingsSessions />} />
                <Route path="location" element={<SettingsLocation />} />
              </Route>

              <Route
                path="/topics/:id"
                element={
                  <Protected>
                    <TopicDetailPage />
                  </Protected>
                }
              />

              {/* My stances (protected) */}
              <Route
                path="/me/stances"
                element={
                  <Protected>
                    <MyStancesPage />
                  </Protected>
                }
              />

              {/* Profile (protected) */}
              <Route
                path={ROUTES.PROFILE}
                element={
                  <Protected>
                    <Profile />
                  </Protected>
                }
              />

              {/* Admin (protected + admin-only) */}
              <Route
                path={ROUTES.ADMIN_ROOT}
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
                <Route path="ai-drafts" element={<AdminAiDraftsPage />} />
                <Route path="questions" element={<AdminQuestionsPage />} />
                <Route
                  path="live-questions"
                  element={<AdminLiveQuestionsPage />}
                />
                <Route
                  path="live-questions/:id"
                  element={<AdminLiveQuestionShowPage />}
                />
                <Route path="news" element={<AdminNewsIndex />} />

                {/* NEW: Admin Topics Page */}
                <Route path="topics" element={<AdminTopicsPage />} />
              </Route>

              {/* Admin special page */}
              <Route
                path={ROUTES.ADMIN_IDENTIFIERS}
                element={
                  <Protected>
                    <AdminOnly>
                      <AdminIdentifiers />
                    </AdminOnly>
                  </Protected>
                }
              />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthReadyGate>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
