"use client";

import { useActionState } from "react";
import { changePasswordAction, type SettingsFormState } from "@/lib/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/auth/submit-button";

const initialState: SettingsFormState = {};

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.global && (
        <Alert variant="destructive">
          <AlertDescription>{state.global}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="settings-new-password">New password</Label>
          <Input
            id="settings-new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
          {state.errors?.password && (
            <p className="text-sm text-destructive">{state.errors.password}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-confirm-password">Confirm new password</Label>
          <Input
            id="settings-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
          {state.errors?.confirmPassword && (
            <p className="text-sm text-destructive">{state.errors.confirmPassword}</p>
          )}
        </div>
      </div>
      <SubmitButton>Update password</SubmitButton>
    </form>
  );
}
