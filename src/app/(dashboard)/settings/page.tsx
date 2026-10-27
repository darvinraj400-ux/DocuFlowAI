import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProcessingSettings } from "@/lib/settings/processing";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Settings · DocuFlow AI",
};

// This authenticated page blocks on the request (see `connection()` below),
// so navigations into it are intentionally non-instant. Opt out of Instant
// Navigation validation for this segment.
export const instant = false;

export default async function SettingsPage() {
  // Request-time only: reads the session cookie and must never be cached.
  await connection();

  let email: string | null = null;
  let configured = true;

  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    email = user?.email ?? null;
  } catch {
    configured = false;
  }

  if (configured && !email) redirect("/login");

  const processing = getProcessingSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account and the processing configuration for this deployment.
        </p>
      </div>

      {!configured && (
        <Alert>
          <AlertTitle>Setup required</AlertTitle>
          <AlertDescription>
            Supabase is not configured, so account settings are unavailable. Follow
            the README to add the environment variables.
          </AlertDescription>
        </Alert>
      )}

      {configured && (
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>The email address used to sign in.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{email}</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {configured && (
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Choose a new password for this account. You stay signed in after updating.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Processing configuration</CardTitle>
          <CardDescription>
            Read-only values from the server environment. These are not editable in the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {processing ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={processing.provider === "mock" ? "warning" : "secondary"}>
                  {processing.providerLabel}
                </Badge>
                {processing.provider === "mock" && (
                  <span className="text-xs text-muted-foreground">
                    Extractions are simulated and labelled in the review screen.
                  </span>
                )}
              </div>
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">Model</dt>
                <dd>{processing.model}</dd>
                <dt className="text-muted-foreground">Max PDF pages</dt>
                <dd>{processing.maxPdfPages}</dd>
                <dt className="text-muted-foreground">Concurrent jobs per user</dt>
                <dd>{processing.maxConcurrentProcessing}</dd>
                <dt className="text-muted-foreground">Accepted file types</dt>
                <dd>{processing.acceptedFormats}</dd>
                <dt className="text-muted-foreground">Max upload size</dt>
                <dd>{processing.maxUploadMb} MB</dd>
              </dl>
              <p className="mt-4 text-xs text-muted-foreground">
                These values come from deployment environment variables. Never enter
                API keys or secrets into this page.
              </p>
            </>
          ) : (
            <Alert variant="info">
              <AlertTitle>Configuration unavailable</AlertTitle>
              <AlertDescription>
                The processing configuration could not be read. Check the server
                environment variables in the README.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
