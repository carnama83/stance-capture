// src/routes/admin/sources/Index.tsx
import * as React from "react";

export default function AdminSourcesIndex() {
  React.useEffect(() => {
    console.log("[/admin/sources] mounted");
  }, []);
  return (
    <div style={{ padding: 16 }}>
      <h1>Sources</h1>
      <p>If you can see this, the route and import are fine.</p>
    </div>
  );
}
