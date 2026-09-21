// src/lib/errors.tsx
import i18n from "@/lib/i18n";
export function userMessageFromError(e: unknown): string {
  const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message as string : String(e ?? "Error");
  const m = msg.toLowerCase();

  if (m.includes("not authenticated") || m.includes("jwt")) return i18n.t("errors.pleaseLogIn");
  if (m.includes("username") && m.includes("reserved")) return i18n.t("errors.usernameReserved");
  if (m.includes("username") && (m.includes("taken") || m.includes("exists"))) return i18n.t("errors.usernameTaken");
  if (m.includes("quota") || m.includes("limit") || m.includes("too many")) return i18n.t("errors.changeLimitReached");
  if (m.includes("mfa") || m.includes("totp") || m.includes("code")) return i18n.t("errors.invalidCode");
  if (m.includes("rls") || m.includes("not authorized")) return i18n.t("errors.noPermission");
  return i18n.t("errors.somethingWentWrong");
}
