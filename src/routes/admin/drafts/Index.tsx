

/* ==========================================
File: src/routes/admin/drafts/Index.tsx
========================================== */
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RegionMultiSelect } from "@/components/admin/RegionMultiSelect";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { Pencil, SendHorizontal } from "lucide-react";


export default function AdminDraftsPage(){
const supabase = React.useMemo(createSupabase, []);
const [rows, setRows] = React.useState<any[]>([]);
const [loading, setLoading] = React.useState(false);


const load = React.useCallback(async()=>{
setLoading(true);
const { data, error } = await supabase
.from("ai_question_drafts")
.select("*")
.eq("state","draft")
.order("created_at", { ascending: false })
.limit(200);
if (!error && data) setRows(data);
setLoading(false);
},[]);

