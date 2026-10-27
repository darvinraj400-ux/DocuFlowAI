"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import {
  resendConfirmationAction,
  type ResendConfirmationState,
} from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const COOLDOWN_SECONDS = 30;

const initialState: ResendConfirmationState = {};

export function ResendConfirmationForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [state, formAction] = useActionState(resendConfirmationAction, initialState);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(COOLDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  return (
    <div className="space-y-3">
      {state.success && (
        <Alert variant="success">
          <MailCheck className="size-4" aria-hidden="true" />
          <AlertTitle>Confirmation link sent</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.global && (
        <Alert variant="destructive">
          <AlertDescription>{state.global}</AlertDescription>
        </Alert>
      )}

      <form
        action={formAction}
        className="space-y-2"
        onSubmit={() => startCooldown()}
        noValidate
      >
        <Label htmlFor="resend-email">Email</Label>
        <div className="flex gap-2">
          <Input
            id="resend-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={initialEmail}
            required
            disabled={cooldown > 0}
          />
          <Button type="submit" disabled={cooldown > 0} className="shrink-0">
            {cooldown > 0 ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {cooldown}s
              </>
            ) : (
              "Resend"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
