// src/components/RouteDebug.tsx
import * as React from "react";
import { useLocation } from "react-router-dom";

export default function RouteDebug() {
  const loc = useLocation();

  React.useEffect(() => {
    // Logs every route change once
    // Look for unexpected jumps to "/"
    // If you see an immediate jump after visiting /settings/profile,
    // something is calling navigate("/") or rendering a <Navigate to="/" />
    // Check the component that renders for that path.
    // eslint-disable-next-line no-console
    console.log("[RouteDebug] location", {
      pathname: loc.pathname,
      search: loc.search,
      hash: window.location.hash,
    });
  }, [loc]);

  return null;
}
