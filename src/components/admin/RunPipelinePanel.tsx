//src/components/admin/RunPipelinePanel.tsx
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { useSupabaseClient } from "@supabase/auth-helpers-react"; // adjust if you use a different hook

type PipelineResult = {
  ok: boolean;
  duration_ms?: number;
  error?: string | null;
  result?: unknown;
};

export function RunPipelinePanel() {
  const supabase = useSupabaseClient(); // or import your supabase browser client directly
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("admin-run-pipeline", {
        body: {}, // no payload needed
      });

      if (error) {
        setResult({
          ok: false,
          error: error.message,
        });
      } else {
        setResult(data as PipelineResult);
      }
    } catch (err: any) {
      setResult({
        ok: false,
        error: err?.message ?? String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  const statusColor =
    result == null
      ? ""
      : result.ok
      ? "text-emerald-600"
      : "text-red-600";

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Run Pipeline
        </CardTitle>
        <CardDescription>
          Manually run ingest → cluster → generate using <code>run_ingestion_pipeline()</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button onClick={handleRun} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Running..." : "Run pipeline now"}
          </Button>
          {result && (
            <span className={`text-sm ${statusColor}`}>
              {result.ok
                ? `Success in ${result.duration_ms ?? "?"} ms`
                : `Error: ${result.error ?? "Unknown error"}`}
            </span>
          )}
        </div>

        {result?.result && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(result.result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
