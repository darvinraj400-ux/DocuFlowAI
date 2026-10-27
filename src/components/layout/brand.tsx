import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <FileText className="size-4" aria-hidden="true" />
      </span>
      <span className="text-base font-semibold tracking-tight">
        DocuFlow <span className="text-muted-foreground">AI</span>
      </span>
    </Link>
  );
}
