// src/pages/NotFound.tsx
// UPDATED VERSION: Uses consistent PageLayout with AppTopBar

import * as React from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const NotFound: React.FC = () => {
  return (
    <PageLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-6xl font-bold text-slate-900">404</h1>
          <p className="text-xl text-slate-600">Oops! Page not found</p>
          <p className="text-sm text-slate-500">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <Link 
            to="/" 
            className="inline-block mt-4 px-6 py-3 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            Return to Home
          </Link>
        </div>
      </div>
    </PageLayout>
  );
};

export default NotFound;
