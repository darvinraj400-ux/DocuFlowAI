"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";
import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form";

const initialState: AuthFormState = {};

export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back. Sign in to your workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.global && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.global}</AlertDescription>
          </Alert>
        )}
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
            {state.errors?.email && <p className="text-sm text-destructive">{state.errors.email}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground">
                Forgot password?
              </Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
            {state.errors?.password && <p className="text-sm text-destructive">{state.errors.password}</p>}
          </div>
          <SubmitButton className="w-full">Sign in</SubmitButton>
        </form>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-4">
        <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
          <span>No account?</span>
          <Link href="/register" className={buttonVariants({ variant: "link", className: "h-auto p-0" })}>
            Create one
          </Link>
        </div>
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Didn\u2019t receive a confirmation email?
          </summary>
          <div className="mt-3">
            <ResendConfirmationForm />
          </div>
        </details>
      </CardFooter>
    </Card>
  );
}
