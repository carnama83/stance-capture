// src/routes/admin/topics/Index.tsx
import * as React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AdminTopicMergePanel } from "@/components/admin/AdminTopicMergePanel";

export default function AdminTopicsPage() {
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Topics</CardTitle>
          <p className="text-sm text-muted-foreground">
            Manage canonical topics and merge near-duplicates. Merging keeps the
            topic list clean while preserving all underlying questions and region
            coverage.
          </p>
        </CardHeader>
        <CardContent>
          <AdminTopicMergePanel />
        </CardContent>
      </Card>
    </div>
  );
}
