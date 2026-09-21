import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";
import { useTranslation } from "react-i18next";

// Gate for routes accessible to admins OR moderators.
// Checks is_admin_me() OR is_moderator() — passes if either is true.
// Used for /admin/moderation so moderators can triage reports
// without accessing the full admin area.
export default function ModeratorOnly({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const sb = React.useMemo(getSupabase, []);
  const [loading, setLoading] = React.useState(true);
  const [allowed, setAllowed] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase not initialized");
        const [adminRes, modRes] = await Promise.all([
          sb.rpc("is_admin_me"),
          sb.rpc("is_moderator"),
        ]);
        if (adminRes.error) throw adminRes.error;
        if (modRes.error)   throw modRes.error;
        if (alive) setAllowed(!!adminRes.data || !!modRes.data);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Failed to check access");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sb]);

  if (loading) return null;
  if (err) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold mb-2">{t("moderatoronly.error")}</h2>
        <p>{err}</p>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold mb-2">{t("moderatoronly.noAccess")}</h2>
        <p>{t("moderatoronly.youNeedModeratorOrAdministrator")}</p>
      </div>
    );
  }
  return <>{children}</>;
}
