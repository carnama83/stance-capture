/* ==============================================
File: src/components/admin/RegionMultiSelect.tsx
============================================== */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { createSupabase } from "@/lib/createSupabase";
import { Loader2, Globe2 } from "lucide-react";


export type Region = { id: string; type: "city"|"county"|"state"|"country"|"global"; name: string; iso_code: string | null };


export const RegionMultiSelect: React.FC<{
value: string[];
onChange: (ids: string[]) => void;
placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
const supabase = React.useMemo(createSupabase, []);
const [open, setOpen] = React.useState(false);
const [loading, setLoading] = React.useState(false);
const [regions, setRegions] = React.useState<Region[]>([]);
const [q, setQ] = React.useState("");


React.useEffect(() => {
(async () => {
setLoading(true);
const { data, error } = await supabase
.from("locations")
.select("id, type, name, iso_code")
.order("type")
.order("name")
.limit(500);
if (!error && data) setRegions(data as any);
setLoading(false);
})();
}, []);


const filtered = React.useMemo(() => {
if (!q) return regions;
const qq = q.toLowerCase();
return regions.filter(r => r.name.toLowerCase().includes(qq) || (r.iso_code ?? "").toLowerCase().includes(qq));
}, [q, regions]);


return (
<Popover open={open} onOpenChange={setOpen}>
<PopoverTrigger asChild>
<Button variant="outline" size="sm" className="justify-start gap-2">
<Globe2 className="h-4 w-4"/>
{value.length ? `${value.length} region${value.length>1?"s":""}` : (placeholder ?? "Select regions (optional)")}
</Button>
</PopoverTrigger>
<PopoverContent className="w-96">
