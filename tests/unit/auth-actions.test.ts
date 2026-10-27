import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const auth = {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    resend: vi.fn(),
  };
  const createClient = vi.fn();
  const redirectCalls: string[] = [];
  return { auth, createClient, redirectCalls };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirectCalls.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
}));

import {
  forgotPasswordAction,
  resendConfirmationAction,
  signInAction,
  signOutAction,
  signUpAction,
  updatePasswordAction,
} from "@/lib/auth/actions";

function makeForm(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirectCalls.length = 0;
  mocks.createClient.mockResolvedValue({ auth: mocks.auth });
});

describe("authentication server actions", () => {
  describe("signInAction", () => {
    it("signs in and redirects to the dashboard on success", async () => {
      mocks.auth.signInWithPassword.mockResolvedValue({ error: null });
      await expect(
        signInAction({}, makeForm({ email: "alice@example.com", password: "password123" })),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirectCalls).toContain("/dashboard");
    });

    it("gives a useful email-not-confirmed message", async () => {
      mocks.auth.signInWithPassword.mockResolvedValue({
        error: { status: 400, message: "Email not confirmed" },
      });
      const state = await signInAction(
        {},
        makeForm({ email: "alice@example.com", password: "password123" }),
      );
      expect(state.global).toContain("confirm your email");
      expect(mocks.redirectCalls).toHaveLength(0);
    });

    it("gives a rate-limit message", async () => {
      mocks.auth.signInWithPassword.mockResolvedValue({
        error: { status: 429, message: "Too many requests" },
      });
      const state = await signInAction(
        {},
        makeForm({ email: "alice@example.com", password: "password123" }),
      );
      expect(state.global).toContain("Too many attempts");
    });

    it("never reveals whether an account exists on invalid credentials", async () => {
      mocks.auth.signInWithPassword.mockResolvedValue({
        error: new Error("Invalid login credentials"),
      });
      const state = await signInAction(
        {},
        makeForm({ email: "unknown@example.com", password: "wrong-pass" }),
      );
      expect(state.global).toBeTruthy();
      expect(state.global).not.toContain("does not exist");
      expect(state.global).not.toContain("registered");
    });

    it("reports a missing-configuration error", async () => {
      mocks.createClient.mockRejectedValue(new Error("env missing"));
      const state = await signInAction(
        {},
        makeForm({ email: "alice@example.com", password: "password123" }),
      );
      expect(state.global).toContain("Supabase is not configured");
    });
  });

  describe("signUpAction", () => {
    it("asks to confirm email when identities are empty", async () => {
      mocks.auth.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
      const state = await signUpAction(
        {},
        makeForm({ email: "new@example.com", password: "password123", confirmPassword: "password123" }),
      );
      expect(state.success).toBe(true);
      expect(state.message).toContain("confirmation link");
      expect(mocks.redirectCalls).toHaveLength(0);
    });

    it("sends a confirmation email to the confirm route with a dashboard next", async () => {
      mocks.auth.signUp.mockResolvedValue({ data: { user: { identities: [{ id: "1" }] } }, error: null });
      await expect(
        signUpAction(
          {},
          makeForm({ email: "new@example.com", password: "password123", confirmPassword: "password123" }),
        ),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirectCalls).toContain("/dashboard");
      const signUpCall = mocks.auth.signUp.mock.calls[0][0];
      expect(signUpCall.options.emailRedirectTo).toContain("/auth/confirm?next=/dashboard");
    });

    it("handles an error without leaking account status", async () => {
      mocks.auth.signUp.mockResolvedValue({ data: null, error: new Error("Signup failed") });
      const state = await signUpAction(
        {},
        makeForm({ email: "new@example.com", password: "password123", confirmPassword: "password123" }),
      );
      expect(state.global).toBeTruthy();
      expect(state.global).not.toContain("already registered");
    });
  });

  describe("forgotPasswordAction", () => {
    it("sends a recovery link to the confirm route with a reset-password next", async () => {
      mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
      const state = await forgotPasswordAction(
        {},
        makeForm({ email: "alice@example.com" }),
      );
      expect(state.success).toBe(true);
      const call = mocks.auth.resetPasswordForEmail.mock.calls[0];
      expect(call[0]).toBe("alice@example.com");
      expect(call[1].redirectTo).toContain("/auth/confirm?next=/reset-password");
    });

    it("never reveals whether an email is registered", async () => {
      mocks.auth.resetPasswordForEmail.mockRejectedValue(new Error("User not found"));
      const state = await forgotPasswordAction(
        {},
        makeForm({ email: "nobody@example.com" }),
      );
      expect(state.success).toBe(true);
      expect(state.message).not.toContain("not");
      // The message must be ambiguous about whether THIS email exists.
      expect(state.message).not.toMatch(/We found|no account|does not exist/);
    });
  });

  describe("updatePasswordAction", () => {
    it("redirects to dashboard on success", async () => {
      mocks.auth.updateUser.mockResolvedValue({ error: null });
      await expect(
        updatePasswordAction({}, makeForm({ password: "newpassword123", confirmPassword: "newpassword123" })),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirectCalls).toContain("/dashboard");
    });

    it("gives an actionable message for an expired/used link", async () => {
      mocks.auth.updateUser.mockResolvedValue({ error: new Error("Session expired") });
      const state = await updatePasswordAction(
        {},
        makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
      );
      expect(state.global).toContain("request a new one");
    });
  });

  describe("resendConfirmationAction", () => {
    it("resends a signup confirmation to the confirm route", async () => {
      mocks.auth.resend.mockResolvedValue({ error: null });
      const state = await resendConfirmationAction({}, makeForm({ email: "alice@example.com" }));
      expect(state.success).toBe(true);
      expect(state.message).toContain("confirmation link");
      const call = mocks.auth.resend.mock.calls[0];
      expect(call[0].type).toBe("signup");
      expect(call[0].email).toBe("alice@example.com");
      expect(call[0].options.emailRedirectTo).toContain("/auth/confirm?next=/dashboard");
    });

    it("reports a rate-limit error without leaking details", async () => {
      mocks.auth.resend.mockResolvedValue({ error: { status: 429, message: "Too many requests" } });
      const state = await resendConfirmationAction({}, makeForm({ email: "alice@example.com" }));
      expect(state.success).toBeUndefined();
      expect(state.global).toContain("Too many attempts");
    });

    it("returns a generic privacy-preserving error for other failures", async () => {
      mocks.auth.resend.mockResolvedValue({ error: new Error("provider boom") });
      const state = await resendConfirmationAction({}, makeForm({ email: "alice@example.com" }));
      expect(state.success).toBeUndefined();
      expect(state.global).toBeTruthy();
      expect(state.global).not.toContain("registered");
    });

    it("validates the email field", async () => {
      const state = await resendConfirmationAction({}, makeForm({ email: "not-an-email" }));
      expect(state.global).toBeTruthy();
      expect(mocks.auth.resend).not.toHaveBeenCalled();
    });
  });
  describe("signOutAction", () => {
    it("signs out and redirects home", async () => {
      mocks.auth.signOut.mockResolvedValue({ error: null });
      await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT");
      expect(mocks.redirectCalls).toContain("/");
    });
  });
});
