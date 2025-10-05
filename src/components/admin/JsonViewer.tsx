/* =====================================
File: src/components/admin/JsonViewer.tsx
===================================== */
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";


export const JsonViewer: React.FC<{ value: unknown; initiallyOpen?: boolean; className?: string }>
= ({ value, initiallyOpen = false, className }) => {
const [open, setOpen] = React.useState(initiallyOpen);
return (
<div className={className ?? "text-sm"}>
<button className="flex items-center gap-1 mb-1" onClick={() => setOpen(o => !o)}>
{open ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
<span className="font-medium">JSON</span>
</button>
{open && (
<pre className="rounded bg-muted p-3 overflow-x-auto text-xs leading-relaxed">
{JSON.stringify(value, null, 2)}
</pre>
)}
</div>
);
};
