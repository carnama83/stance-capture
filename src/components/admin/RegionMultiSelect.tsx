import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { createSupabase } from "@/lib/createSupabase";
import { Loader2, Globe2 } from "lucide-react";

export type Region = {
  id: string;
  type: "city" | "county" | "state" | "country" | "global";
  name: string;
  iso_code: string | null;
};

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
    return regions.filter(
      r => r.name.toLowerCase().includes(qq) || (r.iso_code ?? "").toLowerCase().includes(qq)
    );
  }, [q, regions]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-start gap-2">
          <Globe2 className="h-4 w-4" />
          {value.length
            ? `${value.length} region${value.length > 1 ? "s" : ""}`
            : placeholder ?? "Select regions (optional)"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex items-center gap-2 mb-2">
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search regions..." />
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="max-h-72 overflow-auto space-y-2">
          {filtered.map(r => {
            const checked = value.includes(r.id);
            return (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={c => {
                    if (c) onChange([...value, r.id]);
                    else onChange(value.filter(x => x !== r.id));
                  }}
                />
                <span className="w-20 text-muted-foreground uppercase text-xs">{r.type}</span>
                <span className="font-medium">{r.name}</span>
                {r.iso_code && <Badge variant="secondary" className="ml-auto">{r.iso_code}</Badge>}
              </label>
            );
          })}
        </div>
        {value.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {value.map(id => {
              const r = regions.find(rr => rr.id === id);
              if (!r) return null;
              return <Badge key={id} variant="outline">{r.name}</Badge>;
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
