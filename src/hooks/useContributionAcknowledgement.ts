// src/hooks/useContributionAcknowledgement.ts
// Phase 4 — expose checkForAcknowledgement so it can be called imperatively
// after a stance is saved on the homepage, not just on page mount.

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabaseClient";

type AcknowledgementData = {
  should_show: boolean;
  trigger_type?: string;
  message?: string;
  secondary_text?: string;
  context?: {
    topic_title: string;
    region: string;
  };
  reason?: string;
};

export function useContributionAcknowledgement() {
  const [acknowledgement, setAcknowledgement] = useState<AcknowledgementData | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkForAcknowledgement = useCallback(async () => {
    setIsChecking(true);
    try {
      const supabase = getSupabase();
      if (!supabase) return null;

      const { data, error } = await supabase
        .rpc("check_for_acknowledgement")
        .single();

      if (error) {
        console.error("[Q5] Error checking acknowledgement:", error);
        return null;
      }

      if (data && data.should_show) {
        setAcknowledgement(data as AcknowledgementData);

        // Mark as shown immediately so cooldown activates
        await supabase.rpc("mark_acknowledgement_shown", {
          p_trigger_type: data.trigger_type,
          p_context: data.context || {},
        });

        return data as AcknowledgementData;
      }

      return null;
    } catch (err) {
      console.error("[Q5] Failed to check acknowledgement:", err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Still check on mount for MyStancesPage fallback
  useEffect(() => {
    checkForAcknowledgement();
  }, [checkForAcknowledgement]);

  const dismiss = useCallback(async (ackId?: string) => {
    if (ackId) {
      try {
        const supabase = getSupabase();
        if (!supabase) return;
        await supabase.rpc("dismiss_acknowledgement", { p_ack_id: ackId });
      } catch (err) {
        console.error("[Q5] Failed to dismiss:", err);
      }
    }
    setAcknowledgement(null);
  }, []);

  return {
    acknowledgement,
    isChecking,
    checkForAcknowledgement,  // exposed for imperative use post-save
    dismiss,
  };
}
