//src/auth/AuthContext.tsx

import * as React from "react";

/**
 * A simple boolean context telling the app whether the initial Supabase
 * auth state is known (i.e., the gate is "ready").
 */
export const AuthReadyCtx = React.createContext<boolean>(false);

export function useAuthReady(): boolean {
  return React.useContext(AuthReadyCtx);
}
