// src/hooks/useContributionAcknowledgement.ts
import { useEffect, useState } from "react";
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

  useEffect(() => {
    checkForAcknowledgement();
  }, []);

  const checkForAcknowledgement = async () => {
    setIsChecking(true);
    try {
      const supabase = getSupabase();
      if (!supabase) return;

      console.log("[Q5] Checking for acknowledgement...");

      const { data, error } = await supabase
        .rpc("check_for_acknowledgement")
        .single();

      if (error) {
        console.error("[Q5] Error checking acknowledgement:", error);
        return;
      }

      console.log("[Q5] Acknowledgement check result:", data);

      if (data && data.should_show) {
        setAcknowledgement(data as AcknowledgementData);

        // Mark as shown
        await supabase.rpc("mark_acknowledgement_shown", {
          p_trigger_type: data.trigger_type,
          p_context: data.context || {},
        });

        console.log("[Q5] Marked acknowledgement as shown");
      }
    } catch (err) {
      console.error("[Q5] Failed to check acknowledgement:", err);
    } finally {
      setIsChecking(false);
    }
  };

  const dismiss = async (ackId?: string) => {
    if (ackId) {
      try {
        const supabase = getSupabase();
        if (!supabase) return;

        await supabase.rpc("dismiss_acknowledgement", { p_ack_id: ackId });
        console.log("[Q5] Dismissed acknowledgement");
      } catch (err) {
        console.error("[Q5] Failed to dismiss:", err);
      }
    }

    setAcknowledgement(null);
  };

  return {
    acknowledgement,
    isChecking,
    dismiss,
  };
}
