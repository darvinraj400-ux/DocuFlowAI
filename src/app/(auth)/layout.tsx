import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Brand } from "@/components/layout/brand";

export const metadata: Metadata = {
  title: "Authentication · DocuFlow AI",
  description: "Sign in or create a DocuFlow AI account.",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-12">
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
