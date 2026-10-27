"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthFormState } from "@/lib/auth/actions";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";
import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form";

const initialState: AuthFormState = {};

export function RegisterForm() {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Start processing invoices with DocuFlow AI.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.success && (
          <>
            <Alert variant="success" className="mb-4">
              <AlertTitle>Almost there</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
            <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Didn\u2019t receive it? Resend a confirmation link.
              </p>
              <ResendConfirmationForm initialEmail={state.values?.email ?? ""} />
            </div>
          </>
        )}
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
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
            {state.errors?.password && <p className="text-sm text-destructive">{state.errors.password}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            {state.errors?.confirmPassword && <p className="text-sm text-destructive">{state.errors.confirmPassword}</p>}
          </div>
          <SubmitButton className="w-full">Create account</SubmitButton>
        </form>
      </CardContent>
      <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
        <span>Already have an account?</span>
        <Link href="/login" className={buttonVariants({ variant: "link", className: "h-auto p-0" })}>
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
