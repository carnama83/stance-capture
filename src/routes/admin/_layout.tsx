import * as React from "react";
import { Outlet, NavLink } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Library, Database, FileText } from "lucide-react";

export default function AdminLayout() {
  return (
    <div className="min-h-screen grid grid-cols-12 gap-6 px-6 py-6">
      {/* Sidebar */}
      <aside className="col-span-12 md:col-span-3 lg:col-span-2">
        <Card className="p-4 space-y-2 sticky top-6">
          <div className="text-sm font-semibold tracking-wide px-2 mb-2">Admin</div>
          <AdminLink to="/admin/sources" icon={<Library className="h-4 w-4" />} label="Sources" />
          <AdminLink to="/admin/ingestion" icon={<Database className="h-4 w-4" />} label="Ingestion" />
          <AdminLink to="/admin/drafts" icon={<FileText className="h-4 w-4" />} label="Drafts" />
          <Separator className="my-2" />
          <div className="px-2 text-xs text-muted-foreground">Epic B — Admin</div>
        </Card>
      </aside>

      {/* Content */}
      <main className="col-span-12 md:col-span-9 lg:col-span-10">
        <Outlet />
      </main>
    </div>
  );
}

function AdminLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <NavLink to={to} className={() => `block w-full`}>
      {({ isActive }) => (
        <Button variant={isActive ? "default" : "ghost"} className="w-full justify-start gap-2">
          {icon}
          <span>{label}</span>
        </Button>
      )}
    </NavLink>
  );
}
