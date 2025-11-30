import * as React from "react";
import { Outlet, NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Library, Database, FileText, ChevronRight, LogOut, User } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { createSupabase } from "@/lib/createSupabase";

export default function AdminLayout() {
  const location = useLocation();
  const supabase = React.useMemo(createSupabase, []);
  const navigate = useNavigate();

  const [userEmail, setUserEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);
    })();
  }, [supabase]);

  const crumbs = React.useMemo(() => {
    const segs = location.pathname.split("/").filter(Boolean);
    const idx = segs.indexOf("admin");
    return idx >= 0 ? segs.slice(idx) : [];
  }, [location.pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen grid grid-cols-12 gap-6 px-6 py-6">
      {/* Sidebar */}
      <aside className="col-span-12 md:col-span-3 lg:col-span-2">
        <Card className="p-4 space-y-2 sticky top-6">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="text-sm font-semibold">Admin</div>
            <Link
              to="/admin"
              className="text-xs text-muted-foreground hover:underline"
            >
              Home
            </Link>
          </div>

          {/* Left Navigation */}
          <AdminLink
            to="/admin/sources"
            icon={<Library className="h-4 w-4" />}
            label="Sources"
          />
          <AdminLink
            to="/admin/ingestion"
            icon={<Database className="h-4 w-4" />}
            label="Ingestion"
          />
          <AdminLink
            to="/admin/drafts"
            icon={<FileText className="h-4 w-4" />}
            label="Drafts"
          />
          {/* NEW: AI Drafts (topics from AI pipeline) */}
          <AdminLink
            to="/admin/ai-drafts"
            icon={<FileText className="h-4 w-4" />}
            label="AI Drafts"
          />
          <AdminLink
            to="/admin/questions"
            icon={<FileText className="h-4 w-4" />}
            label="Questions"
          />
          <AdminLink
            to="/admin/live-questions"
            icon={<FileText className="h-4 w-4" />}
            label="Live Questions"
          />
          <AdminLink
            to="/admin/news"
            icon={<FileText className="h-4 w-4" />}
            label="News"
          />

          <Separator className="my-2" />
          <div className="px-2 text-xs text-muted-foreground">Epic B — Admin</div>
        </Card>
      </aside>

      {/* Main Content */}
      <main className="col-span-12 md:col-span-9 lg:col-span-10 space-y-4">
        <div className="flex items-center justify-between">
          <Breadcrumb crumbs={crumbs} />
          <UserMenu email={userEmail} onSignOut={handleSignOut} />
        </div>
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
    <NavLink to={to} className="block w-full" end>
      {({ isActive }) => (
        <Button
          variant={isActive ? "default" : "ghost"}
          className="w-full justify-start gap-2"
        >
          {icon}
          <span>{label}</span>
        </Button>
      )}
    </NavLink>
  );
}

function Breadcrumb({ crumbs }: { crumbs: string[] }) {
  if (!crumbs.length) return null;

  return (
    <nav aria-label="breadcrumb" className="flex items-center">
      {crumbs.map((seg, i) => {
        const href = "/" + crumbs.slice(0, i + 1).join("/");
        const isLast = i === crumbs.length - 1;
        const label = seg === "admin" ? "Admin" : humanize(seg);
        return (
          <span key={href} className="inline-flex items-center">
            {i > 0 && (
              <ChevronRight className="mx-2 h-4 w-4 text-muted-foreground" />
            )}
            {isLast ? (
              <span className="text-sm font-medium">{label}</span>
            ) : (
              <Link
                to={href}
                className="text-sm text-muted-foreground hover:underline"
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function humanize(s: string) {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function UserMenu({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => void;
}) {
  const initials = React.useMemo(() => {
    if (!email) return "AD";
    const id = email.split("@")[0];
    return id.slice(0, 2).toUpperCase();
  }, [email]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 px-2">
          <Avatar className="h-8 w-8">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline text-sm">
            {email ?? "Admin"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{email ?? "Admin"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
