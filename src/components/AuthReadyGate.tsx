
// // src/components/AuthReadyGate.tsx
// import * as React from "react";
// import { getSupabase } from "../lib/supabaseClient";
// import { AuthReadyCtx } from "../auth/AuthContext";

// /**
//  * Prevents first-paint redirects by waiting until Supabase auth state
//  * is known. It resolves "ready" immediately after getSession() returns,
//  * and also listens for subsequent auth changes.
//  */
// export default function AuthReadyGate({ children }: { children: React.ReactNode }) {
//   const sb = React.useMemo(getSupabase, []);
//   const [ready, setReady] = React.useState(false);

//   React.useEffect(() => {
//     if (!sb) {
//       // If Supabase is not available in this environment, don't block rendering.
//       setReady(true);
//       return;
//     }

//     let unsub: { unsubscribe: () => void } | undefined;

//     // 1) Prime with current session (avoids blank screen if INITIAL_SESSION doesn't arrive)
//     sb.auth
//       .getSession()
//       .then(() => {
//         // Whether session is null or not, we now know the initial state.
//         setReady(true);
//       })
//       .catch(() => {
//         // Even if this fails, don't hard-block the app.
//         setReady(true);
//       })
//       .finally(() => {
//         // 2) Also listen for subsequent changes (INITIAL_SESSION / SIGNED_IN / SIGNED_OUT)
//         const sub = sb.auth.onAuthStateChange(() => {
//           // If a guard cares about changes, they'll re-read session now.
//           // We keep "ready" true once flipped.
//           setReady(true);
//         });
//         unsub = sub.data?.subscription;
//       });

//     return () => {
//       unsub?.unsubscribe?.();
//     };
//   }, [sb]);

//   if (!ready) {
//     // Minimal skeleton so users see *something* while auth initializes
//     return (
//       <AuthReadyCtx.Provider value={false}>
//         <div style={{ padding: 12, fontSize: 14, color: "#475569" }}>Loading…</div>
//       </AuthReadyCtx.Provider>
//     );
//   }

//   return <AuthReadyCtx.Provider value={true}>{children}</AuthReadyCtx.Provider>;
// }

// src/components/AuthReadyGate.tsx  (temporary test)
export default function AuthReadyGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>; // <-- TEMP: no redirects, no gating
}
