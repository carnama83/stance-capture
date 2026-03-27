// src/pages/InsightsPage.tsx
// Hub page linking to Epic E (My Stances) and Epic F (Community Pulse)

import * as React from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { Card } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, MapPin, ArrowRight } from "lucide-react";

export default function InsightsPage() {
  return (
    <PageLayout>
      <div className="max-w-4xl mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Insights</h1>
          <p className="text-slate-600">
            Discover how your views align with your community and how they've evolved over time.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">

          <Link to="/me/stances" className="group">
            <Card className="p-6 h-full transition-shadow group-hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <BarChart3 className="h-6 w-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-1">
                    My Stances
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </h3>
                  <p className="text-sm text-slate-600">
                    See how your positions have changed over time. View stance history, edit rationale, and export your data.
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/pulse" className="group">
            <Card className="p-6 h-full transition-shadow group-hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-indigo-50 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-1">
                    Community Pulse
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </h3>
                  <p className="text-sm text-slate-600">
                    Explore aggregated community sentiment across questions, regions, and time with macro trend charts.
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/pulse" className="group">
            <Card className="p-6 h-full transition-shadow group-hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-green-50 rounded-lg">
                  <MapPin className="h-6 w-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-1">
                    Regional Comparisons
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </h3>
                  <p className="text-sm text-slate-600">
                    Compare stance distributions across city, state, country, and global — side by side.
                  </p>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/pulse" className="group">
            <Card className="p-6 h-full transition-shadow group-hover:shadow-md">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-purple-50 rounded-lg">
                  <Users className="h-6 w-6 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-1">
                    Demographic Breakdown
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </h3>
                  <p className="text-sm text-slate-600">
                    See how stance distributions vary by gender across questions.
                  </p>
                </div>
              </div>
            </Card>
          </Link>

        </div>

        {/* CTA — preserved from original */}
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
