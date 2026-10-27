"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>Enter the email tied to your account and we will send a reset link.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.success && (
          <Alert variant="success" className="mb-4">
            <AlertTitle>Check your inbox</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
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
          <SubmitButton className="w-full">Send reset link</SubmitButton>
        </form>
      </CardContent>
      <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
        <span>Remembered your password?</span>
        <Link href="/login" className={buttonVariants({ variant: "link", className: "h-auto p-0" })}>
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
