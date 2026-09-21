// src/components/share/SocialIngestionDisclosure.tsx
// W5 — First-share ingestion disclosure
//
// Shown ONCE per user (localStorage key: 'share_disclosure_seen').
// Displayed inside ShareButton when the user first opens the share sheet.
// Informs users that X replies may be captured as stances.
// Links to /settings/privacy for opt-out.
//
// Usage — add to ShareButton before the platform list renders:
//   <SocialIngestionDisclosure />

import * as React from "react";
import { Info, X } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const STORAGE_KEY = "share_disclosure_seen";

export function SocialIngestionDisclosure() {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 mb-3">
      <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
      <p className="text-[11px] text-blue-700 leading-snug flex-1">
        {t("socialIngestionDisclosure.repliesToPostsSharedOn")}{" "}
        <Link
          to="/settings/privacy"
          className="underline hover:text-blue-900"
          onClick={dismiss}
        >
          {t("socialIngestionDisclosure.manageInPrivacySettings")}
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("auth.dismiss")}
        className="text-blue-400 hover:text-blue-600 shrink-0"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
