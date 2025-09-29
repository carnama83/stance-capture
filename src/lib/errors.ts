// src/lib/errors.tsx
export function userMessageFromError(e: unknown): string {
  const msg = (e && typeof e === "object" && "message" in e) ? (e as any).message as string : String(e ?? "Error");
  const m = msg.toLowerCase();

  if (m.includes("not authenticated") || m.includes("jwt")) return "Please log in to continue.";
  if (m.includes("username") && m.includes("reserved")) return "That username is reserved.";
  if (m.includes("username") && (m.includes("taken") || m.includes("exists"))) return "That username is taken.";
  if (m.includes("quota") || m.includes("limit") || m.includes("too many")) return "You’ve reached the change limit. Try again later.";
  if (m.includes("mfa") || m.includes("totp") || m.includes("code")) return "Invalid code. Try again.";
  if (m.includes("rls") || m.includes("not authorized")) return "You don’t have permission for this action.";
  return "Something went wrong. Please try again.";
}
