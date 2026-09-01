// src/components/share/ShareButton.tsx
// Epic W — Social Sharing (W1 updated)
//
// Changes from original:
//   - W1: Added direct X (Twitter) post via API v2 when user has an authorized
//         X token stored in social_auth_tokens. Falls back to web intent
//         automatically when token is absent or expired.
//   - W2: OG image URL is now passed as a prop and included in the share card
//         context so the posted tweet renders a large image card.
//   - Added useXPostStatus hook to check whether the user has X write access.
//   - SharePanel now shows a "Connect X for richer sharing" nudge when no
//     token exists, linking to /settings/account.

import * as React from "react";
import {
  Share2, Twitter, Facebook, Link2, MessageCircle,
  Linkedin, Zap, Lock, ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSupabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { getMyForwardRef } from "@/lib/webStance";

type Platform = "twitter" | "twitter_direct" | "facebook" | "whatsapp" | "linkedin" | "copy" | "native";
type ShareType = "question" | "stance";

export interface ShareButtonProps {
  questionId: string;
  questionText: string;
  questionSummary?: string | null;
  /** OG image URL — passed from QuestionDetailPage via useOgMeta */
  ogImageUrl?: string | null;
  /**
   * Language the viewer is currently seeing this question in. Threaded into
   * the /s/<id>/<lang> path segment (see api/s/[slug].js) so the WhatsApp
   * link preview — and everything downstream through a forward chain —
   * renders in the right language instead of always English. Optional,
   * defaults to 'en': call sites that don't pass it keep behaving exactly
   * as before. Not yet wired at every ShareButton render site — only
   * QuestionDetailPage.tsx passes it today.
   */
  languageCode?: string;
  shareType?: ShareType;
  /** Compact icon-only mode for question cards */
  compact?: boolean;
  className?: string;
}

// ─── X token status hook ───────────────────────────────────────────────────────
//
// Checks whether the current user has a valid X (Twitter) OAuth token stored
// in social_auth_tokens with sufficient scopes for write access (tweet.write).
// Returns:
//   { hasToken: true,  tokenId: uuid }  — direct post available
//   { hasToken: false, tokenId: null }  — fall back to web intent

interface XTokenStatus {
  hasToken: boolean;
  tokenId: string | null;
  loading: boolean;
}

function useXPostStatus(): XTokenStatus {
  const [status, setStatus] = React.useState<XTokenStatus>({
    hasToken: false,
    tokenId: null,
    loading: true,
  });

  React.useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const { data, error } = await supabase
          .from("social_auth_tokens")
          .select("id, scopes, token_expires_at")
          .eq("provider", "twitter" as any) // social_provider enum
          .maybeSingle();

        if (cancelled) return;

        if (error || !data) {
          setStatus({ hasToken: false, tokenId: null, loading: false });
          return;
        }

        // Check token is not expired
        const expired =
          data.token_expires_at
            ? new Date(data.token_expires_at) < new Date()
            : false;

        // Check scopes include tweet.write
        const scopes: string[] = data.scopes ?? [];
        const hasWriteScope =
          scopes.includes("tweet.write") || scopes.includes("write");

        setStatus({
          hasToken: !expired && hasWriteScope,
          tokenId: data.id,
          loading: false,
        });
      } catch {
        if (!cancelled) setStatus({ hasToken: false, tokenId: null, loading: false });
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  return status;
}

// ─── Share URL builder ─────────────────────────────────────────────────────────

function buildShareUrl(
  questionId: string,
  platform: string,
  shareId: string,
  languageCode: string
): string {
  const base = window.location.origin;
  // Always route through /s/<id> — this is the endpoint (api/s/[slug].js) that
  // server-renders per-question OG tags for link crawlers (WhatsApp, FB, X,
  // iMessage). The old hash-route fallback (/#/q/<id>) was invisible to crawlers
  // since HashRouter content never reaches the server, so every share that
  // wasn't part of a forward chain showed the generic site-default card.
  //
  // Language segment: /s/<id>/<lang>, matching the vercel.json rewrite. 'en'
  // (the canonical default) deliberately produces no segment at all — see
  // the api/s/[slug].js header comment on why that matters: it keeps the
  // English link's cache identity exactly as it's always been, rather than
  // fragmenting it into a redundant "/en" variant.
  //
  // Web-forward chain: if THIS visitor has their own minted ref (they answered
  // anonymously via a forwarded link), carry their ref so the next hop is
  // parented to them. `via` keeps platform analytics in that case.
  const langSegment = languageCode && languageCode !== "en" ? `/${languageCode}` : "";
  const fwd = getMyForwardRef(questionId);
  const ref = fwd ?? platform;
  const via = fwd ? `&via=${platform}` : "";
  return `${base}/s/${questionId}${langSegment}?ref=${ref}${via}&sid=${shareId}`;
}

function buildShareText(questionText: string, questionSummary?: string | null): string {
  const truncated =
    questionText.length > 120 ? questionText.slice(0, 117) + "..." : questionText;
  return questionSummary
    ? `${truncated}\n\n${questionSummary.slice(0, 80)}`
    : truncated;
}

// Mirrors the whatsapp-send-link edge function's message body: full question
// (never truncated), an optional context/summary line, then the same CTA
// copy. Used for WhatsApp (quick-share button + native share, since that's
// the actual path to WhatsApp on desktop) — NOT for platforms with hard
// length limits like X, which keep the truncated buildShareText() above.
function buildWhatsAppText(questionText: string, questionSummary?: string | null): string {
  const question = (questionText || "").trim();
  const context = (questionSummary || "").trim();
  return (
    `${question}\n` +
    (context ? `\n${context}\n` : "") +
    `\nSee where people stand & add yours:️`
  );
}

// ─── Direct X post via Supabase RPC ───────────────────────────────────────────
//
// Calls the post-to-x Edge Function which uses the stored OAuth token to
// POST /2/tweets on behalf of the user. The Edge Function handles token
// refresh automatically.
//
// Returns { success: true, tweetId: string } on success,
//         { success: false, error: string }  on failure.

async function postDirectlyToX(
  questionId: string,
  questionText: string,
  shareUrl: string,
  ogImageUrl: string | null | undefined,
): Promise<{ success: boolean; tweetId?: string; error?: string }> {
  try {
    // Build tweet text — X limit is 280 chars; URL counts as 23
    const baseText = questionText.length > 200
      ? questionText.slice(0, 197) + "…"
      : questionText;
    const tweetText = `${baseText}\n\nWhat do you think? 👇\n${shareUrl}`;

    const { data, error } = await supabase.functions.invoke("post-to-x", {
      body: {
        tweet_text: tweetText,
        question_id: questionId,
        og_image_url: ogImageUrl ?? null,
      },
    });

    if (error) return { success: false, error: error.message };
    if (!data?.success) return { success: false, error: data?.error ?? "Post failed" };

    return { success: true, tweetId: data.tweet_id };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Unknown error" };
  }
}

// ─── Platform UI configs ───────────────────────────────────────────────────────

interface PlatformConfig {
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  badgeIcon?: React.ReactNode;
  bgClass: string;
  textClass: string;
  buildUrl: ((text: string, url: string) => string | null) | null;
}

function buildPlatformConfigs(hasXToken: boolean): Record<Platform, PlatformConfig> {
  return {
    twitter_direct: {
      label: "Post to X",
      sublabel: hasXToken ? "Posts with image card" : undefined,
      icon: (
        // X (Twitter) logo
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.857L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      badgeIcon: hasXToken
        ? <Zap className="h-3 w-3 text-amber-400" />
        : <Lock className="h-3 w-3 text-slate-400" />,
      bgClass: hasXToken ? "bg-black hover:bg-gray-800" : "bg-slate-200 hover:bg-slate-300",
      textClass: hasXToken ? "text-white" : "text-slate-500",
      buildUrl: null, // handled by custom logic
    },
    twitter: {
      label: "Share to X",
      sublabel: "Opens X in browser",
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.857L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      bgClass: "bg-slate-100 hover:bg-slate-200",
      textClass: "text-slate-600",
      buildUrl: (text, url) =>
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    },
    facebook: {
      label: "Facebook",
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
        </svg>
      ),
      bgClass: "bg-[#1877F2] hover:bg-[#166FE5]",
      textClass: "text-white",
      buildUrl: (_, url) =>
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    },
    whatsapp: {
      label: "WhatsApp",
      icon: (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      bgClass: "bg-[#25D366] hover:bg-[#20BA5C]",
      textClass: "text-white",
      buildUrl: (text, url) =>
        `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
    },
    linkedin: {
      label: "LinkedIn",
      icon: <Linkedin className="h-4 w-4" />,
      bgClass: "bg-[#0A66C2] hover:bg-[#0958A8]",
      textClass: "text-white",
      buildUrl: (_, url) =>
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    },
    copy: {
      label: "Copy link",
      icon: <Link2 className="h-4 w-4" />,
      bgClass: "bg-slate-100 hover:bg-slate-200",
      textClass: "text-slate-700",
      buildUrl: null,
    },
    native: {
      label: "More options",
      icon: <Share2 className="h-4 w-4" />,
      bgClass: "bg-slate-100 hover:bg-slate-200",
      textClass: "text-slate-700",
      buildUrl: null,
    },
  };
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ShareButton({
  questionId,
  questionText,
  questionSummary,
  ogImageUrl,
  languageCode = "en",
  shareType = "question",
  compact = false,
  className = "",
}: ShareButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState<Platform | null>(null);
  const [copied, setCopied] = React.useState(false);
  const { hasToken, loading: tokenLoading } = useXPostStatus();
  const { toast } = useToast();
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Positioning fix: the panel used to always open upward (bottom-full), which
  // clips off-screen when the trigger sits near the top of the viewport (e.g.
  // the topic-level Share button under the nav bar). When clipped, only the
  // bottom-most items (Copy link / More options) stay reachable — the
  // dedicated WhatsApp/Facebook/X/LinkedIn buttons above them become
  // unclickable, silently forcing people into the OS share sheet instead
  // (which drops rich text for WhatsApp). Measure available space on open and
  // flip to open downward when there isn't enough room above.
  const [openUpward, setOpenUpward] = React.useState(true);
  const ESTIMATED_PANEL_HEIGHT = 420; // header + optional X-nudge + up to 6 platform rows

  const PLATFORMS = React.useMemo(
    () => buildPlatformConfigs(hasToken),
    [hasToken],
  );

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function handleShare(platform: Platform) {
    setSharing(platform);
    try {
      // Record share event
      const { data: shareId, error: recordErr } = await supabase.rpc(
        "record_share",
        { p_question_id: questionId, p_platform: platform === "twitter_direct" ? "twitter" : platform, p_share_type: shareType },
      );
      if (recordErr) {
        console.warn("[ShareButton] record_share failed (non-fatal):", recordErr.message);
      }

      const sid = shareId ?? "unknown";
      const shareUrl = buildShareUrl(questionId, platform, sid, languageCode);
      const shareText = buildShareText(questionText, questionSummary);
      const whatsAppText = buildWhatsAppText(questionText, questionSummary);

      // ── Copy link ──────────────────────────────────────────────────────
      if (platform === "copy") {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        setOpen(false);
        toast({ title: "Link copied to clipboard" });
        return;
      }

      // ── Native share ───────────────────────────────────────────────────
      if (platform === "native" && navigator.share) {
        await navigator.share({ title: questionText, text: whatsAppText, url: shareUrl });
        setOpen(false);
        return;
      }

      // ── Direct X post (W1 — new) ───────────────────────────────────────
      if (platform === "twitter_direct") {
        if (!hasToken) {
          // Shouldn't be called when no token, but guard anyway
          toast({
            title: "Connect your X account first",
            description: "Go to Settings → Account to connect X for direct posting.",
          });
          return;
        }

        const result = await postDirectlyToX(questionId, questionText, shareUrl, ogImageUrl);

        if (result.success) {
          toast({
            title: "Posted to X ✓",
            description: result.tweetId
              ? `View your post: x.com/i/web/status/${result.tweetId}`
              : "Your stance has been shared.",
          });
          setOpen(false);
        } else {
          // On failure, offer web intent fallback
          toast({
            title: "Direct post failed",
            description: "Opening X in your browser instead.",
            variant: "destructive",
          });
          const intentUrl =
            `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
          window.open(intentUrl, "_blank", "noopener,noreferrer,width=600,height=500");
          setOpen(false);
        }
        return;
      }

      // ── Standard platform share ────────────────────────────────────────
      const cfg = PLATFORMS[platform];
      if (cfg?.buildUrl) {
        const textForPlatform = platform === "whatsapp" ? whatsAppText : shareText;
        const targetUrl = cfg.buildUrl(textForPlatform, shareUrl);
        if (targetUrl) {
          window.open(targetUrl, "_blank", "noopener,noreferrer,width=600,height=500");
          setOpen(false);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        toast({
          title: "Share failed",
          description: e?.message,
          variant: "destructive",
        });
      }
    } finally {
      setSharing(null);
    }
  }

  // Build platform list shown in the panel
  const showNative = typeof navigator !== "undefined" && !!navigator.share;
  // Always show twitter_direct first (it adapts its label/appearance based on token)
  const platformOrder: Platform[] = [
    "twitter_direct",
    "facebook",
    "whatsapp",
    "linkedin",
    "copy",
    ...(showNative ? (["native"] as Platform[]) : []),
  ];

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!open && panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect();
            const spaceAbove = rect.top;
            const spaceBelow = window.innerHeight - rect.bottom;
            setOpenUpward(
              spaceAbove >= ESTIMATED_PANEL_HEIGHT || spaceAbove >= spaceBelow,
            );
          }
          setOpen((v) => !v);
        }}
        className={[
          "flex items-center gap-1.5 rounded-lg transition-colors",
          compact
            ? "p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            : "px-3 py-1.5 text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50",
        ].join(" ")}
        aria-label="Share this question"
        title="Share"
      >
        <Share2 className={compact ? "h-4 w-4" : "h-3.5 w-3.5"} />
        {!compact && <span>Share</span>}
      </button>

      {/* Share panel */}
      {open && (
        <div
          className={[
            "absolute right-0 z-50 w-64 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden",
            openUpward ? "bottom-full mb-2" : "top-full mt-2",
          ].join(" ")}
        >
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Share this question
            </p>
          </div>

          {/* X connect nudge — only shown when no X token and not loading */}
          {!tokenLoading && !hasToken && (
            <a
              href="/settings/account"
              className="flex items-center gap-2.5 px-3 py-2 bg-amber-50 border-b border-amber-100 hover:bg-amber-100 transition-colors"
            >
              <div className="h-6 w-6 rounded bg-black flex items-center justify-center shrink-0">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="white" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.857L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-800">Connect X for richer posts</p>
                <p className="text-[11px] text-amber-600 truncate">Posts include image card & attribution</p>
              </div>
              <ExternalLink className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            </a>
          )}

          {/* Platform buttons */}
          <div className="p-2 space-y-1">
            {platformOrder.map((platform) => {
              const cfg = PLATFORMS[platform];
              const isCopy = platform === "copy";
              const isDirectX = platform === "twitter_direct";
              const isLoading = sharing === platform;
              const isDisabled = isLoading || (isDirectX && tokenLoading);

              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => handleShare(platform)}
                  disabled={isDisabled}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 text-left"
                >
                  {/* Icon */}
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-lg shrink-0 transition-colors",
                      cfg.textClass,
                      isCopy || platform === "native" ? "bg-slate-100" : cfg.bgClass,
                    ].join(" ")}
                  >
                    {isLoading ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
                      </svg>
                    ) : (
                      cfg.icon
                    )}
                  </span>

                  {/* Label */}
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-slate-800 text-sm">
                      {isCopy && copied ? "Copied!" : cfg.label}
                    </span>
                    {cfg.sublabel && (
                      <span className="block text-[11px] text-slate-400 mt-0.5">
                        {cfg.sublabel}
                      </span>
                    )}
                  </span>

                  {/* Badge (Zap for direct, Lock for locked) */}
                  {cfg.badgeIcon && (
                    <span className="shrink-0">{cfg.badgeIcon}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ShareButton;
