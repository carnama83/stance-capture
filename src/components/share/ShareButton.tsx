// src/components/share/ShareButton.tsx
// Epic W — Social Sharing (W1)
//
// Renders a share icon that opens a bottom-sheet style target selector.
// Records the share event via RPC and builds a tracked share URL.
// Works on question cards and question detail pages.

import * as React from "react";
import { Share2, Twitter, Facebook, Link2, MessageCircle, Linkedin, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Platform = "twitter" | "facebook" | "whatsapp" | "linkedin" | "copy" | "native";
type ShareType = "question" | "stance";

interface ShareButtonProps {
  questionId: string;
  questionText: string;
  questionSummary?: string | null;
  shareType?: ShareType;
  /** Compact icon-only mode for question cards */
  compact?: boolean;
  className?: string;
}

// ─── Share URL builder ─────────────────────────────────────────────────────────

function buildShareUrl(questionId: string, platform: Platform, shareId: string): string {
  const base = window.location.origin;
  return `${base}/#/q/${questionId}?ref=${platform}&sid=${shareId}`;
}

function buildShareText(questionText: string, questionSummary?: string | null): string {
  const truncated = questionText.length > 120
    ? questionText.slice(0, 117) + "..."
    : questionText;
  return questionSummary
    ? `${truncated}\n\n${questionSummary.slice(0, 80)}`
    : truncated;
}

// ─── Platform configs ──────────────────────────────────────────────────────────

interface PlatformConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  buildUrl: (text: string, shareUrl: string) => string | null; // null = use Web Share API
}

const PLATFORMS: Record<Platform, PlatformConfig> = {
  twitter: {
    label: "X (Twitter)",
    icon: <Twitter className="h-4 w-4" />,
    color: "text-black",
    bgColor: "bg-black hover:bg-gray-800",
    buildUrl: (text, url) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  facebook: {
    label: "Facebook",
    icon: <Facebook className="h-4 w-4" />,
    color: "text-[#1877F2]",
    bgColor: "bg-[#1877F2] hover:bg-[#166FE5]",
    buildUrl: (_, url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  whatsapp: {
    label: "WhatsApp",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
    color: "text-[#25D366]",
    bgColor: "bg-[#25D366] hover:bg-[#20BA5C]",
    buildUrl: (text, url) =>
      `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
  },
  linkedin: {
    label: "LinkedIn",
    icon: <Linkedin className="h-4 w-4" />,
    color: "text-[#0A66C2]",
    bgColor: "bg-[#0A66C2] hover:bg-[#0958A8]",
    buildUrl: (_, url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  copy: {
    label: "Copy link",
    icon: <Link2 className="h-4 w-4" />,
    color: "text-slate-700",
    bgColor: "bg-slate-100 hover:bg-slate-200",
    buildUrl: () => null, // handled specially
  },
  native: {
    label: "More options",
    icon: <Share2 className="h-4 w-4" />,
    color: "text-slate-700",
    bgColor: "bg-slate-100 hover:bg-slate-200",
    buildUrl: () => null, // handled via Web Share API
  },
};

// Which platforms to show and in what order
const PLATFORM_ORDER: Platform[] = ["twitter", "facebook", "whatsapp", "linkedin", "copy"];

// ─── Main component ────────────────────────────────────────────────────────────

export function ShareButton({
  questionId,
  questionText,
  questionSummary,
  shareType = "question",
  compact = false,
  className = "",
}: ShareButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState<Platform | null>(null);
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();
  const panelRef = React.useRef<HTMLDivElement>(null);

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
      // Record the share event and get a tracking ID
      const { data: shareId, error } = await supabase.rpc("record_share", {
        p_question_id: questionId,
        p_platform: platform,
        p_share_type: shareType,
      });

      if (error) {
        console.warn("[ShareButton] record_share failed (non-fatal):", error.message);
      }

      const sid = shareId ?? "unknown";
      const shareUrl = buildShareUrl(questionId, platform, sid);
      const shareText = buildShareText(questionText, questionSummary);

      if (platform === "copy") {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        setOpen(false);
        toast({ title: "Link copied to clipboard" });
        return;
      }

      if (platform === "native" && navigator.share) {
        await navigator.share({ title: questionText, text: shareText, url: shareUrl });
        setOpen(false);
        return;
      }

      const cfg = PLATFORMS[platform];
      const targetUrl = cfg.buildUrl(shareText, shareUrl);
      if (targetUrl) {
        window.open(targetUrl, "_blank", "noopener,noreferrer,width=600,height=500");
        setOpen(false);
      }
    } catch (e: any) {
      // User cancelled native share — not an error
      if (e?.name !== "AbortError") {
        toast({ title: "Share failed", description: e?.message, variant: "destructive" });
      }
    } finally {
      setSharing(null);
    }
  }

  // Show native share if supported, otherwise show all platforms
  const showNative = typeof navigator !== "undefined" && !!navigator.share;
  const platforms = showNative
    ? [...PLATFORM_ORDER, "native" as Platform]
    : PLATFORM_ORDER;

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
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
        <div className="absolute right-0 bottom-full mb-2 z-50 w-56 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Share this question</p>
          </div>

          <div className="p-2 space-y-1">
            {platforms.map((platform) => {
              const cfg = PLATFORMS[platform];
              const isCopy = platform === "copy";
              return (
                <button
                  key={platform}
                  type="button"
                  onClick={() => handleShare(platform)}
                  disabled={sharing === platform}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 text-left"
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white shrink-0 ${
                    isCopy || platform === "native" ? "bg-slate-200 text-slate-600" : cfg.bgColor
                  }`}>
                    {cfg.icon}
                  </span>
                  <span className="font-medium">
                    {isCopy && copied ? "Copied!" : cfg.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
