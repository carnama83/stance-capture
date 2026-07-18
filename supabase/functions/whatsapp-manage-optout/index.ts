// supabase/functions/whatsapp-manage-optout/index.ts
// Epic AA — AA5.1
//
// Called by SettingsPrivacy when an authenticated user toggles the
// WhatsApp messages setting on/off.
//
// Actions:
//   opt_out — upserts whatsapp_optouts with is_active=true keyed on the
//             user's verified_phone_hash. Noop if no verified phone.
//   opt_in  — sets whatsapp_optouts.is_active=false for the user's hash.
//             Noop if no verified phone or no existing optout row.
//
// Auth: requires valid JWT (authenticated user) — reads verified_phone_hash
// from their profile using service-role to avoid RLS stack.
//
// Note: profiles.whatsapp_flow_enabled is updated directly by the frontend
// (supabase.from("profiles").update(...)) — this function only manages
// the whatsapp_optouts table which is keyed by phone_hash.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS
    });
  }
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // ── Authenticate the calling user ────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const userJwt = authHeader.replace("Bearer ", "").trim();
    if (!userJwt) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // Verify JWT and extract user id
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: `Bearer ${userJwt}`
        }
      }
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: "Invalid or expired token"
      }), {
        status: 401,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Parse action ─────────────────────────────────────────────────────
    const body = await req.json().catch(()=>({}));
    const action = body?.action;
    if (action !== "opt_out" && action !== "opt_in") {
      return new Response(JSON.stringify({
        error: "action must be 'opt_out' or 'opt_in'"
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Look up the user's verified phone hash ────────────────────────────
    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await service.from("profiles").select("verified_phone_hash").eq("user_id", user.id).maybeSingle();
    const phoneHash = profile?.verified_phone_hash;
    if (!phoneHash) {
      // No verified phone on profile — nothing to manage in optouts table.
      // The frontend already updated profiles.whatsapp_flow_enabled, so this
      // is a soft noop: return success so the UI doesn't show an error.
      return new Response(JSON.stringify({
        ok: true,
        noop: true,
        reason: "no_verified_phone"
      }), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Update whatsapp_optouts ───────────────────────────────────────────
    if (action === "opt_out") {
      // Upsert: create or reactivate optout row
      const { error } = await service.from("whatsapp_optouts").upsert({
        phone_hash: phoneHash,
        opted_out_at: new Date().toISOString(),
        is_active: true
      }, {
        onConflict: "phone_hash"
      });
      if (error) {
        console.error("optout upsert error:", error.message);
        return new Response(JSON.stringify({
          error: "Failed to record opt-out"
        }), {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        });
      }
      console.log("Opt-out recorded via settings for hash:", phoneHash.substring(0, 8));
    } else {
      // opt_in: deactivate any existing optout row
      const { error } = await service.from("whatsapp_optouts").update({
        is_active: false,
        opted_in_at: new Date().toISOString()
      }).eq("phone_hash", phoneHash);
      if (error) {
        console.error("opt-in update error:", error.message);
        return new Response(JSON.stringify({
          error: "Failed to record opt-in"
        }), {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        });
      }
      console.log("Opt-in recorded via settings for hash:", phoneHash.substring(0, 8));
    }
    return new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("whatsapp-manage-optout error:", err);
    return new Response(JSON.stringify({
      error: "Internal error"
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  }
});
