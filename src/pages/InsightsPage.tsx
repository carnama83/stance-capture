// src/pages/InsightsPage.tsx
// Placeholder for Epic E & F - Personal Analytics & Community Pulse
// This is where users see alignment vs majority, regional comparisons, cognitive change

import * as React from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { Card } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, MapPin } from "lucide-react";

export default function InsightsPage() {
  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Insights
          </h1>
          <p className="text-slate-600">
            Discover how your views align with your community and how they've evolved over time.
          </p>
        </div>

        {/* Coming Soon Cards */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-50 rounded-lg">
                <BarChart3 className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">
                  Stance History
                </h3>
                <p className="text-sm text-slate-600 mb-3">
                  See how your positions have changed over time with visual timelines and sparklines.
                </p>
                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">
                  Coming Soon
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-50 rounded-lg">
                <Users className="h-6 w-6 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">
                  You vs Community
                </h3>
                <p className="text-sm text-slate-600 mb-3">
                  Compare your stances with others in your city, state, and country.
                </p>
                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">
                  Coming Soon
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-50 rounded-lg">
                <MapPin className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">
                  Regional Comparisons
                </h3>
                <p className="text-sm text-slate-600 mb-3">
                  Discover how different regions view the same questions differently.
                </p>
                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">
                  Coming Soon
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-orange-50 rounded-lg">
                <TrendingUp className="h-6 w-6 text-orange-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">
                  Cognitive Change
                </h3>
                <p className="text-sm text-slate-600 mb-3">
                  Track moments when your views shifted and understand what prompted change.
                </p>
                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded">
                  Coming Soon
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* CTA to capture stances */}
        <Card className="p-8 text-center bg-gradient-to-br from-slate-50 to-white">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">
            Start Building Your Insights
          </h2>
          <p className="text-slate-600 mb-4">
            The more questions you answer, the richer your insights become.
          </p>
          <Link
            to="/topics"
            className="inline-flex items-center justify-center px-6 py-3 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors font-medium"
          >
            Answer Questions
          </Link>
        </Card>
      </div>
    </PageLayout>
  );
}
