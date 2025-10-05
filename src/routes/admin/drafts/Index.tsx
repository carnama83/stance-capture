import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { Pencil, SendHorizontal } from "lucide-react";

export default function AdminDraftsPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ai_question_drafts")
      .select("*")
      .eq("state", "draft")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) setRows(data);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle>AI Question Drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(r => <DraftRow key={r.id} row={r} onChanged={load} />)}
        {!rows.length && <div className="p-6 text-sm text-muted-foreground">No drafts at the moment.</div>}
      </CardContent>
    </Card>
  );
}

function DraftRow({ row, onChanged }: { row: any; onChanged: () => void }) {
  return (
    <div className="border rounded p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">{(row.lang ?? "en").toUpperCase()}</div>
          <h3 className="text-lg font-semibold">{row.title}</h3>
          {row.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {row.tags.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <EditDraftDialog row={row} onSaved={onChanged} />
          <PublishDraftDialog draftId={row.id} onPublished={onChanged} />
        </div>
      </div>
      {row.summary && <p className="mt-2 text-sm whitespace-pre-wrap">{row.summary}</p>}
      <div className="mt-2"><JsonViewer value={row.sources} /></div>
    </div>
  );
}

function EditDraftDialog({ row, onSaved }: { row: any; onSaved: () => void }) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    title: row.title ?? "",
    summary: row.summary ?? "",
    tags: (row.tags ?? []) as string[],
    sources: row.sources ?? [],
    lang: row.lang ?? "en",
  });

  const save = async () => {
    if (form.title.length < 8 || form.title.length > 140) {
      alert("Title must be 8–140 characters.");
      return;
    }
    if (!Array.isArray(form.sources) || form.sources.length === 0) {
      alert("Sources must be a non-empty JSON array.");
      return;
    }
    await supabase.from("ai_question_drafts").update(form).eq("id", row.id);
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Edit Draft</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Language</Label>
            <Input value={form.lang} onChange={e => setForm({ ...form, lang: e.target.value })} />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label>Summary</Label>
            <Textarea rows={4} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div>
            <Label>Tags (comma-separated)</Label>
            <Input
              value={form.tags.join(", ")}
              onChange={e => setForm({
                ...form,
                tags: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
              })}
            />
          </div>
          <div>
            <Label>Sources (JSON array)</Label>
            <Textarea
              rows={6}
              value={JSON.stringify(form.sources, null, 2)}
              onChange={e => {
                try { const v = JSON.parse(e.target.value); setForm({ ...form, sources: v }); }
                catch { /* ignore until valid JSON */ }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PublishDraftDialog({
  draftId,
  onPublished,
}: {
  draftId: string;
  onPublished: () => void;
}) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [regions, setRegions] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const publish = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_publish_draft", {
      p_draft_id: draftId,
      p_region_ids: regions,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setOpen(false);
    onPublished();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><SendHorizontal className="h-4 w-4 mr-1" /> Publish</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish Draft</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select regions (optional). Leave empty for global/no regional targeting.
          </p>
          <RegionMultiSelect value={regions} onChange={setRegions} />
        </div>
        <DialogFooter>
          <Button onClick={publish} disabled={busy}>Publish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
