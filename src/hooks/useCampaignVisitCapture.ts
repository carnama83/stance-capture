// src/hooks/useCampaignVisitCapture.ts
// Mounted once in App (inside the HashRouter). Picks up a campaign landing
// from the hash query, records it (src/lib/campaignVisit.ts), and removes the
// campaign parameters from the URL so they are not carried along when the
// visitor shares the page onward.
//
//   /#/q/<id>?lang=hi&cv=<code>                        from /c/<code> (api/c/[code].js)
//   /#/q/<id>?ref=campaign&campaign_id=<uuid>&utm_...  Epic Y paid-ad URLs already live

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { recordCampaignVisit } from "@/lib/campaignVisit";

export function useCampaignVisitCapture() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("cv");
    const paid = params.get("ref") === "campaign" ? params.get("campaign_id") : null;
    if (!code && !paid) return;

    void recordCampaignVisit({ code, paidCampaignId: paid });

    params.delete("cv");
    if (paid) {
      params.delete("campaign_id");
      // ref=campaign is not a forward-chain ref; record_web_stance would discard it anyway.
      params.delete("ref");
    }
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : "" }, { replace: true });
  }, [location.search, location.pathname, navigate]);
}
