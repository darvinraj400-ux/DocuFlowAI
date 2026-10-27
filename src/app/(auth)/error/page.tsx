import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthErrorMessage } from "@/components/auth/error-message";

export const metadata: Metadata = {
  title: "Link error · DocuFlow AI",
  robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <AuthErrorMessage />
    </Suspense>
  );
}
