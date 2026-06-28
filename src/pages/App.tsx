import * as React from "react";
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

import AuthReadyGate from "./components/AuthReadyGate";
import { Protected, PublicOnly } from "./auth/route-guards";
import AdminOnly from "./auth/AdminOnly";
import ModeratorOnly from "./auth/moderatoronly";
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
import SettingsProfile from "./pages/SettingsProfile";
import SettingsSecurity from "./pages/SettingsSecurity";
import SettingsSessions from "./pages/SettingsSessions";
import AdminIdentifiers from "./pages/AdminIdentifiers";
import NotFound from "./pages/NotFound";
import { recordWebStance } from "@/lib/webStance";

// Public legal/about pages + site footer
import About from "./pages/About";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Footer from "./components/Footer";

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
import AdminUGQQueuePage from "@/routes/admin/ugq-queue/Index";
import AdminProposerPage from "@/routes/admin/proposers/Index";
import ShareAnalyticsPage from "@/routes/admin/share-analytics/Index";
import AdminIngestionReviewPage from "@/routes/admin/ingestion-review/Index";
import AdminPipelineRunsPage from "@/routes/admin/pipeline-runs/Index";
import EmbedPage from "@/pages/EmbedPage";
import PublisherPage from "@/pages/PublisherPage";
import EmbedAnalyticsPage from "@/routes/admin/embed-analytics/Index";
import AdminNewsIndex from "@/routes/admin/news/Index";
import AdminLiveQuestionsPage from "@/routes/admin/live-questions/Index";
import AdminLiveQuestionShowPage from "@/routes/admin/live-questions/Show";
import AdminAiDraftsPage from "@/routes/admin/ai-drafts/index";
import AdminPromptsPage from "@/routes/admin/prompts/Index";
import AdminImpactDashboardPage from "@/routes/admin/impact-dashboard/Index";
import AdminCronJobsPage from "@/routes/admin/cron-jobs/Index";
import ScoringConfigPage from "@/routes/admin/ScoringConfigPage";
import AdminCuratedFeedPage from "@/routes/admin/curated-feed/Index";

// FIX 3: Publisher approval queue
import AdminPublishersPage from "@/routes/admin/publishers/Index";

// Cognitive State Pages
import AdminCognitiveStatesPage from '@/routes/admin/cognitive-states';
// Epic EL — Election Intelligence
import AdminElectionsPage from '@/routes/admin/elections/Index';
import AdminElectionNewPage from '@/routes/admin/elections/New';
import AdminPartiesPage from '@/routes/admin/parties/Index';
import AdminCandidatesPage from '@/routes/admin/candidates/Index';
import AdminManifestoPromisesPage from '@/routes/admin/manifesto-promises/Index';
import AdminElectionReviewPage from '@/routes/admin/election-review/Index';
import ConstituencySetupPage from '@/pages/settings/ConstituencySetup';
import AdminModerationPage from '@/routes/admin/moderation/index';
// Epic AA — WhatsApp admin pages
import AdminWhatsAppSettingsPage from '@/routes/admin/whatsapp/Index';
import AdminWhatsAppBroadcastsPage from '@/routes/admin/whatsapp/Broadcasts';
import AdminWhatsAppBroadcastDetailPage from '@/routes/admin/whatsapp/BroadcastDetail';
import AdminWhatsAppContactsPage from '@/routes/admin/whatsapp/Contacts';
import CognitiveInsightsPage from '@/routes/me/cognitive-insights';
import PersonalInsightsPage from '@/pages/PersonalInsightsPage';
import InsightsPage from '@/pages/InsightsPage';

// My stances
import MyStancesPage from "./pages/MyStancesPage";
import MyProposalsPage from "./pages/MyProposalsPage";

import SettingsLayout from "./pages/SettingsLayout";
import SettingsLocation from "./pages/SettingsLocation";
import SettingsNotifications from "./pages/SettingsNotifications";
import SettingsPrivacy from "./pages/SettingsPrivacy";
import SettingsAccount from "./pages/SettingsAccount";
import CommunityPulsePage from "./pages/CommunityPulsePage";

// Forces CommunityPulsePage to fully remount when the authenticated user changes.
// This prevents stale per-user data (region options, question selections, cached
// regional comparison) from leaking across user sessions.
function UserKeyedPulsePage() {
  const [userKey, setUserKey] = React.useState<string>("init");
  React.useEffect(() => {
    const sb = (window as any).sb ?? (() => { try { const { getSupabase } = require("@/lib/supabaseClient"); return getSupabase(); } catch { return null; } })();
    if (!sb) return;
    const { data: { subscription } } = sb.auth.onAuthStateChange((_: any, session: any) => {
      const uid = session?.user?.id ?? "anon";
      setUserKey(uid);
    });
    // Set initial key
    sb.auth.getUser().then(({ data: { user } }: any) => {
      setUserKey(user?.id ?? "anon");
    });
    return () => subscription.unsubscribe();
  }, []);
  return <CommunityPulsePage key={userKey} />;
}

import RouteDebug from "./components/RouteDebug";

// Admin stance metrics page
import AdminStanceMetricsPage from "./pages/AdminStanceMetricsPage";

import { useBootstrapUser } from "./hooks/useBootstrapUser";

const queryClient = new QueryClient();

function ShareClickTrackerMount() {
  useShareClickTracker();
  return null;
}

// Renders the global footer on every page EXCEPT the chrome-free embed and
// publisher pages, where a footer would break the embedded layout.
function SiteFooter() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/embed") || pathname === "/publisher") return null;
  return <Footer />;
}

const App: React.FC = () => {
  useBootstrapUser();

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
              <Route path="/pulse" element={<UserKeyedPulsePage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              
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
                <Route path="constituency" element={<ConstituencySetupPage />} />
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

              {/* Cognitive Insights (protected) */}
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

              {/* Epic UGQ: my proposals (protected) */}
              <Route
                path="/profile/proposals"
                element={
                  <Protected>
                    <MyProposalsPage />
                  </Protected>
                }
              />

              {/* Profile route redirects to Settings Profile */}
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
                <Route path="pipeline-runs" element={<AdminPipelineRunsPage />} />
                <Route path="ingestion-review" element={<AdminIngestionReviewPage />} />
                <Route path="prompts" element={<AdminPromptsPage />} />
                <Route path="questions" element={<AdminQuestionsPage />} />
                <Route path="share-analytics" element={<ShareAnalyticsPage />} />
                <Route path="embed-analytics" element={<EmbedAnalyticsPage />} />
                <Route path="live-questions" element={<AdminLiveQuestionsPage />} />
                <Route path="ugq-queue" element={<AdminUGQQueuePage />} />
                <Route path="proposers" element={<AdminProposerPage />} />
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
                <Route path="curated-feed" element={<AdminCuratedFeedPage />} />
                <Route path="cognitive-states" element={<AdminCognitiveStatesPage />} />
                {/* FIX 3: Publisher approval queue */}
                <Route path="publishers" element={<AdminPublishersPage />} />
                {/* Epic EL — Election Intelligence */}
                <Route path="elections" element={<AdminElectionsPage />} />
                <Route path="elections/new" element={<AdminElectionNewPage />} />
                <Route path="parties" element={<AdminPartiesPage />} />
                <Route path="candidates" element={<AdminCandidatesPage />} />
                <Route path="election-review" element={<AdminElectionReviewPage />} />
                <Route path="manifesto-promises" element={<AdminManifestoPromisesPage />} />
                {/* Epic AA — WhatsApp */}
                <Route path="whatsapp" element={<AdminWhatsAppSettingsPage />} />
                <Route path="whatsapp/broadcasts" element={<AdminWhatsAppBroadcastsPage />} />
                <Route path="whatsapp/broadcasts/:id" element={<AdminWhatsAppBroadcastDetailPage />} />
                <Route path="whatsapp/contacts" element={<AdminWhatsAppContactsPage />} />
              </Route>

              {/* Moderation — accessible to admins AND moderators */}
              <Route
                path="/admin/moderation"
                element={
                  <Protected>
                    <ModeratorOnly>
                      <AdminLayout />
                    </ModeratorOnly>
                  </Protected>
                }
              >
                <Route index element={<AdminModerationPage />} />
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
            <SiteFooter />
          </AuthReadyGate>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
