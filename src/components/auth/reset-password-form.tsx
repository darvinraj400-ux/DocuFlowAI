"use client";

import { useActionState } from "react";
import { updatePasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initialState);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose a strong password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.global && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{state.global}</AlertDescription>
          </Alert>
        )}
        <form action={formAction} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
            {state.errors?.password && <p className="text-sm text-destructive">{state.errors.password}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            {state.errors?.confirmPassword && <p className="text-sm text-destructive">{state.errors.confirmPassword}</p>}
          </div>
          <SubmitButton className="w-full">Update password</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
