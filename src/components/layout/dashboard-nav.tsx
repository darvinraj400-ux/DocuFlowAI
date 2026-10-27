"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileUp, FileText, Settings, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: FileUp },
  { href: "/invoices", label: "Invoices", icon: FileText },
];

const SETTINGS = { label: "Settings", href: "/settings", icon: Settings };

export function DashboardNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="flex flex-col gap-1 p-3">
      <span className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Workspace
      </span>
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <span className="mt-4 px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Preferences
      </span>
      <Link
        href={SETTINGS.href}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive(SETTINGS.href)
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        <SETTINGS.icon className="size-4" aria-hidden="true" />
        {SETTINGS.label}
      </Link>
      <div className="mt-6 flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Upload your first invoice to begin the extraction and review workflow.
        </span>
      </div>
    </nav>
  );
}
