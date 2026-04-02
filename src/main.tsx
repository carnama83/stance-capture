// src/main.tsx — drop-in
import { handleOAuthHashRedirect } from "./lib/oauthHashHandler";

// Must run before React renders — rewrites /auth/callback#access_token into
// HashRouter-compatible /#/auth/callback#access_token so Supabase can parse it.
handleOAuthHashRedirect();

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// (optional) import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // sensible defaults; tweak as you like
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* <ReactQueryDevtools initialIsOpen={false} /> */}
    </QueryClientProvider>
  </React.StrictMode>
);
