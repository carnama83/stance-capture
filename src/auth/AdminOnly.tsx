// src/auth/AdminOnly.tsx
import * as React from "react";
import { useAuthReady } from "./AuthContext";
import { useSession } from "./route-guards";

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();
  if (!ready) return null;

  const role =
    (session?.user?.app_metadata?.role as string | undefined) ||
    (session?.user?.user_metadata?.role as string | undefined) ||
    "";

  if (role !== "admin") {
    return (
      <div className="mx-auto max-w-lg p-6 text-sm text-slate-700">
        <h2 className="text-base font-semibold mb-2">No access</h2>
        <p>Ask an administrator to grant you access to admin pages.</p>
      </div>
    );
  }
  return <>{children}</>;
}
