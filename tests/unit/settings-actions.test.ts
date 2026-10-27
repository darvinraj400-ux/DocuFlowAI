import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { changePasswordAction } from "@/lib/settings/actions";

function makeForm(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("changePasswordAction", () => {
  it("rejects a short password before touching Supabase", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ password: "short", confirmPassword: "short" }),
    );
    expect(state.errors?.password).toContain("8 characters");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "different123" }),
    );
    expect(state.errors?.confirmPassword).toContain("do not match");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before updating", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Auth session missing"),
    });
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
    );
    expect(state.global).toContain("signed in");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("updates the signed-in user's password and confirms without redirecting", async () => {
    mocks.updateUser.mockResolvedValue({ error: null });
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
    );
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
    expect(state.success).toBe(true);
    expect(state.message).toContain("Password updated");
  });

  it("reports a missing Supabase configuration", async () => {
    mocks.createClient.mockRejectedValue(new Error("missing env"));
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
    );
    expect(state.global).toContain("Supabase is not configured");
  });

  it("maps rate limiting to a clear message", async () => {
    mocks.updateUser.mockResolvedValue({
      error: { status: 429, message: "Too many requests" },
    });
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
    );
    expect(state.global).toContain("Too many attempts");
    expect(state.success).toBeUndefined();
  });

  it("returns a generic error for other provider failures", async () => {
    mocks.updateUser.mockResolvedValue({ error: new Error("provider boom") });
    const state = await changePasswordAction(
      {},
      makeForm({ password: "newpassword123", confirmPassword: "newpassword123" }),
    );
    expect(state.global).toBeTruthy();
    expect(state.global).not.toContain("provider boom");
  });
});
