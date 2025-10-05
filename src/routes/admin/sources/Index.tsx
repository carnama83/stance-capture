/* ==========================================
File: src/routes/admin/sources/Index.tsx
========================================== */
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Plus, RefreshCw } from "lucide-react";


export default function AdminSourcesPage() {
const supabase = React.useMemo(createSupabase, []);
const [items, setItems] = React.useState<any[]>([]);
const [loading, setLoading] = React.useState(false);
const [q, setQ] = React.useState("");


const load = React.useCallback(async () => {
setLoading(true);
const { data, error } = await supabase.from("topic_sources").select("*").order("last_polled_at", { ascending: false });
if (!error && data) setItems(data);
setLoading(false);
}, []);


React.useEffect(() => { load(); }, [load]);


const filtered = React.useMemo(() => {
if (!q) return items;
const qq = q.toLowerCase();
return items.filter(r => r.name.toLowerCase().includes(qq) || (r.endpoint ?? "").toLowerCase().includes(qq));
}, [q, items]);

