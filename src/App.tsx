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
import { useShareClickTracker } from "@/hooks/useShareClickTracker";
import AdminTopicsPage from "@/routes/admin/topics/Index";

import TopicDetailPage from "./pages/TopicDetailPage";

import SearchResultsPage from "@/pages/SearchResultsPage";
import ForYouFeedPage from "@/pages/ForYouFeedPage";

// Public pages
import Index from "./pages/Index";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
// ✅ Option A: keep /profile route but redirect; Profile page no longer needed here
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
import ShareAnalyticsPage from "@/routes/admin/share-analytics/Index";
import EmbedPage from "@/pages/EmbedPage";
import PublisherPage from "@/pages/PublisherPage";
import EmbedAnalyticsPage from "@/routes/admin/embed-analytics/Index";
import AdminNewsIndex from "@/routes/admin/news/Index";
import AdminLiveQuestionsPage from "@/routes/admin/live-questions/Index";
import AdminLiveQuestionShowPage from "@/routes/admin/live-questions/Show";
import AdminAiDraftsPage from "@/routes/admin/ai-drafts/Index";
import AdminImpactDashboardPage from "@/routes/admin/impact-dashboard/Index";
import AdminCronJobsPage from "@/routes/admin/cron-jobs/Index";
import ScoringConfigPage from "@/routes/admin/ScoringConfigPage";

// Cognitive State Pages
import AdminCognitiveStatesPage from '@/routes/admin/cognitive-states';
import AdminModerationPage from '@/routes/admin/moderation/index';
import CognitiveInsightsPage from '@/routes/me/cognitive-insights';
import PersonalInsightsPage from '@/pages/PersonalInsightsPage';
import InsightsPage from '@/pages/InsightsPage';

// My stances
import MyStancesPage from "./pages/MyStancesPage";

import SettingsLayout from "./pages/SettingsLayout";
import SettingsLocation from "./pages/SettingsLocation";
import SettingsNotifications from "./pages/SettingsNotifications";
import SettingsPrivacy from "./pages/SettingsPrivacy";
import SettingsAccount from "./pages/SettingsAccount";
import CommunityPulsePage from "./pages/CommunityPulsePage";

import RouteDebug from "./components/RouteDebug";

// Admin stance metrics page
import AdminStanceMetricsPage from "./pages/AdminStanceMetricsPage";

// ✅ ADD: Bootstrap hook
import { useBootstrapUser } from "./hooks/useBootstrapUser";

const queryClient = new QueryClient();

const App: React.FC = () => {
  // ✅ ADD: run bootstrap on auth/session changes
  useBootstrapUser();

  // Dev expose Supabase once (unchanged)
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;

    import("@/lib/supabaseClient").then(({ getSupabase }) => {
      if (cancelled) return;
      (window as any).sb = getSupabase();
      console.log("%cSupabase client (window.sb)", "color: green;");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Router>
          <ShareClickTrackerMount />
          <AuthReadyGate>
            <RouteDebug />
            <Routes>
              {/* Epic T: Embed — no auth gate, no app chrome */}
              <Route path="/embed/:questionId" element={<EmbedPage />} />
              <Route path="/publisher" element={<PublisherPage />} />

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

              <Route path="/search" element={<SearchResultsPage />} />
              <Route path="/for-you" element={<Protected><ForYouFeedPage /></Protected>} />
              <Route path="/pulse" element={<CommunityPulsePage />} />
              <Route path="/insights" element={<InsightsPage />} />
              
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

              {/* Epic V: OAuth callback — no PublicOnly wrapper; handles both new and returning users */}
              <Route path="/auth/callback" element={<OAuthCallbackPage />} />

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
                <Route path="notifications" element={<SettingsNotifications />} />
                <Route path="privacy" element={<SettingsPrivacy />} />
                <Route path="account" element={<SettingsAccount />} />
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

              {/* ✅ NEW: Cognitive Insights (protected) */}
              <Route
                path="/me/cognitive-insights"
                element={
                  <Protected>
                    <CognitiveInsightsPage />
                  </Protected>
                }
              />

              {/* S1: Personal Opinion Intelligence dashboard */}
              <Route
                path="/me/insights"
                element={
                  <Protected>
                    <PersonalInsightsPage />
                  </Protected>
                }
              />

              {/* ✅ Option A: Profile route redirects to Settings Profile */}
              <Route
                path={ROUTES.PROFILE}
                element={
                  <Protected>
                    <Navigate to={ROUTES.SETTINGS_PROFILE} replace />
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
                <Route path="share-analytics" element={<ShareAnalyticsPage />} />
                <Route path="embed-analytics" element={<EmbedAnalyticsPage />} />
                <Route path="live-questions" element={<AdminLiveQuestionsPage />} />
                <Route
                  path="live-questions/:id"
                  element={<AdminLiveQuestionShowPage />}
                />
                <Route path="news" element={<AdminNewsIndex />} />
                <Route path="topics" element={<AdminTopicsPage />} />
                <Route path="impact-dashboard" element={<AdminImpactDashboardPage />} />
                <Route path="stance-metrics" element={<AdminStanceMetricsPage />} />
                <Route path="cron-jobs" element={<AdminCronJobsPage />} />
                <Route path="scoring-config" element={<ScoringConfigPage />} />
                
                {/* ✅ NEW: Cognitive States Admin */}
                <Route path="cognitive-states" element={<AdminCognitiveStatesPage />} />

                {/* H: Moderation queue */}
                <Route path="moderation" element={<AdminModerationPage />} />
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
