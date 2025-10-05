/* ============================================
File: src/routes/admin/ingestion/Index.tsx
============================================ */
import * as React from "react";
import { createSupabase } from "@/lib/createSupabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JsonViewer } from "@/components/admin/JsonViewer";
import { RefreshCw } from "lucide-react";


export default function AdminIngestionPage() {
const supabase = React.useMemo(createSupabase, []);
const [rows, setRows] = React.useState<any[]>([]);
const [count, setCount] = React.useState<number|undefined>();
const [loading, setLoading] = React.useState(false);
const [page, setPage] = React.useState(1);
const pageSize = 25;


const [status, setStatus] = React.useState<string|undefined>();
const [lang, setLang] = React.useState<string>("");
const [sourceId, setSourceId] = React.useState<string|undefined>();
const [sources, setSources] = React.useState<any[]>([]);
const [dateFrom, setDateFrom] = React.useState("");
const [dateTo, setDateTo] = React.useState("");


const loadSources = React.useCallback(async()=>{
const { data } = await supabase.from("topic_sources").select("id, name").order("name");
setSources(data ?? []);
}, []);


const load = React.useCallback(async () => {
setLoading(true);
let q = supabase
