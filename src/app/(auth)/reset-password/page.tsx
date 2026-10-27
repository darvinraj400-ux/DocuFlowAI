import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Set new password · DocuFlow AI",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
