import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Plus, RefreshCw } from "lucide-react";

export default function AdminSourcesPage() {
  const supabase = React.useMemo(createSupabase, []);
  const [items, setItems] = React.useState<any[]>([]);
  const [q, setQ] = React.useState("");

  const load = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("topic_sources")
      .select("*")
      .order("last_polled_at", { ascending: false });
    if (!error && data) setItems(data);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = React.useMemo(() => {
    if (!q) return items;
    const qq = q.toLowerCase();
    return items.filter(
      r => r.name.toLowerCase().includes(qq) || (r.endpoint ?? "").toLowerCase().includes(qq)
    );
  }, [q, items]);

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Topic Sources</CardTitle>
        <div className="flex items-center gap-2">
          <Input placeholder="Search name or endpoint" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
          <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <NewSourceDialog onCreated={load} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 divide-y">
          <div className="grid grid-cols-12 text-xs text-muted-foreground py-2">
            <div className="col-span-2">Name</div>
            <div>Kind</div>
            <div className="col-span-3">Endpoint</div>
            <div>Enabled</div>
            <div>Last Status</div>
            <div>Success</div>
            <div>Failure</div>
            <div className="col-span-2 text-right pr-2">Actions</div>
          </div>
          <Separator />
          {filtered.map(row => (
            <Row key={row.id} row={row} onChanged={load} supabase={supabase} />
          ))}
          {!filtered.length && (
            <div className="p-6 text-sm text-muted-foreground">No sources found.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ row, supabase, onChanged }: { row: any; supabase: any; onChanged: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const toggle = async () => {
    setBusy(true);
    await supabase.from("topic_sources").update({ is_enabled: !row.is_enabled }).eq("id", row.id);
    setBusy(false); onChanged();
  };
  return (
    <div className="grid grid-cols-12 items-center py-3 text-sm">
      <div className="col-span-2 font-medium">{row.name}</div>
      <div><Badge variant="secondary">{row.kind}</Badge></div>
      <div className="col-span-3 truncate" title={row.endpoint}>{row.endpoint}</div>
      <div>
        <Button size="sm" variant={row.is_enabled ? "default" : "outline"} onClick={toggle} disabled={busy}>
          {row.is_enabled ? "Enabled" : "Disabled"}
        </Button>
      </div>
      <div>
        {row.last_status ? (
          <Badge variant={row.last_status === "ok" ? "default" : "destructive"}>{row.last_status}</Badge>
        ) : <span className="text-muted-foreground">—</span>}
        {row.last_error && (
          <div className="text-xs text-destructive mt-1 max-w-64 truncate" title={row.last_error}>
            {row.last_error}
          </div>
        )}
      </div>
      <div>{row.success_count}</div>
      <div>{row.failure_count}</div>
      <div className="col-span-2 flex justify-end gap-2 pr-2">
        <EditSourceDialog row={row} onSaved={onChanged} />
        <DeleteSourceButton id={row.id} supabase={supabase} onDeleted={onChanged} />
      </div>
    </div>
  );
}

function DeleteSourceButton({
  id,
  supabase,
  onDeleted,
}: {
  id: string;
  supabase: any;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabase.from("topic_sources").delete().eq("id", id);
        setBusy(false);
        onDeleted();
      }}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function EditSourceDialog({ row, onSaved }: { row: any; onSaved: () => void }) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: row.name, kind: row.kind, endpoint: row.endpoint });
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true);
    await supabase.from("topic_sources").update(form).eq("id", row.id);
    setBusy(false);
    setOpen(false);
    onSaved();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="h-4 w-4 mr-1" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Source</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Kind</Label>
            <select
              className="w-full border rounded h-9 px-2"
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value })}
            >
              <option value="rss">rss</option>
              <option value="api">api</option>
              <option value="social">social</option>
            </select>
          </div>
          <div>
            <Label>Endpoint</Label>
            <Input value={form.endpoint} onChange={e => setForm({ ...form, endpoint: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSourceDialog({ onCreated }: { onCreated: () => void }) {
  const supabase = React.useMemo(createSupabase, []);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", kind: "rss", endpoint: "", is_enabled: true });
  const [busy, setBusy] = React.useState(false);
  const create = async () => {
    setBusy(true);
    await supabase.from("topic_sources").insert(form);
    setBusy(false);
    setOpen(false);
    onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1" /> New Source</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New Source</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Kind</Label>
            <select
              className="w-full border rounded h-9 px-2"
              value={form.kind}
              onChange={e => setForm({ ...form, kind: e.target.value })}
            >
              <option value="rss">rss</option>
              <option value="api">api</option>
              <option value="social">social</option>
            </select>
          </div>
          <div>
            <Label>Endpoint</Label>
            <Input value={form.endpoint} onChange={e => setForm({ ...form, endpoint: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="en"
              type="checkbox"
              className="accent-current"
              checked={form.is_enabled}
              onChange={e => setForm({ ...form, is_enabled: e.target.checked })}
            />
            <Label htmlFor="en">Enabled</Label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={busy}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
