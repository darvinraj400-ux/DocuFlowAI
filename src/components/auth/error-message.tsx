"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

const MESSAGES: Record<string, { title: string; body: string }> = {
  "invalid-link": {
    title: "Invalid link",
    body: "This confirmation or reset link is missing information and cannot be processed.",
  },
  "invalid-or-expired": {
    title: "Link expired",
    body: "This link is invalid or has expired. Request a new confirmation or reset link.",
  },
  "not-configured": {
    title: "Not configured",
    body: "Supabase is not configured on this deployment yet. See the README to set it up.",
  },
};

export function AuthErrorMessage() {
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason") ?? "";
  const info = MESSAGES[reason] ?? MESSAGES["invalid-link"];

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        <Alert variant="destructive">
          <AlertTitle>{info.title}</AlertTitle>
          <AlertDescription>{info.body}</AlertDescription>
        </Alert>
        <div className="mt-4 flex gap-3">
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Back to sign in
          </Link>
          <Link href="/forgot-password" className={buttonVariants()}>
            Request a new link
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
