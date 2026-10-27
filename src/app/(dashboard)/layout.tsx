import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "@/components/layout/brand";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const instant = false;

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Force request-time rendering: this shell serves authenticated, user-specific
  // content and must never be statically cached or shared across users.
  await connection();

  let email: string | undefined;
  let configured = true;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    email = data.user?.email;
  } catch {
    configured = false;
  }

  if (configured && !email) {
    redirect("/login");
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex min-h-[100dvh]">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-muted/30 md:block">
          <div className="flex h-16 items-center border-b border-border px-4">
            <Brand href="/dashboard" />
          </div>
          <DashboardNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-border px-4 md:px-6">
            <div className="flex items-center gap-3 md:hidden">
              <Brand href="/dashboard" />
            </div>
            <div className="hidden md:block" />
            <div className="flex items-center gap-3">
              {configured && email ? (
                <UserMenu email={email} />
              ) : (
                <Alert variant="info" className="py-1.5">
                  <AlertTitle className="text-xs">Setup required</AlertTitle>
                  <AlertDescription className="text-xs">
                    Supabase is not configured. See README.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </header>

          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
