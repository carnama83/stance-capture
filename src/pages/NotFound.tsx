// src/pages/NotFound.tsx
// UPDATED VERSION: Uses consistent PageLayout with AppTopBar

import * as React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageLayout from "../components/PageLayout";

const NotFound: React.FC = () => {
  const { t } = useTranslation();
  return (
    <PageLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-6xl font-bold text-slate-900">404</h1>
          <p className="text-xl text-slate-600">{t("notFound.title")}</p>
          <p className="text-sm text-slate-500">
            {t("notFound.body")}
          </p>
          <Link 
            to="/" 
            className="inline-block mt-4 px-6 py-3 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            {t("notFound.returnHome")}
          </Link>
        </div>
      </div>
    </PageLayout>
  );
};

export default NotFound;
