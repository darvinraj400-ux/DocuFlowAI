import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { GET } from "@/app/auth/confirm/route";

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/auth/confirm?${query}`);
}

function mockAuth() {
  mocks.createClient.mockResolvedValue({
    auth: {
      verifyOtp: mocks.verifyOtp,
      exchangeCodeForSession: mocks.exchangeCodeForSession,
    },
  });
}

describe("confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  describe("PKCE code flow", () => {
    it("exchanges a valid signup code and redirects to the dashboard", async () => {
      mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
      const res = await GET(makeRequest("code=abc123&next=/dashboard"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/dashboard");
      expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    });

    it("exchanges a recovery code and routes to /reset-password", async () => {
      mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
      const res = await GET(makeRequest("code=abc123&next=/reset-password"));
      expect(res.headers.get("location")).toContain("/reset-password");
    });

    it("redirects to the error page when the exchange fails", async () => {
      mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("invalid code") });
      const res = await GET(makeRequest("code=bad&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/error?reason=invalid-or-expired");
    });
  });

  describe("legacy token_hash flow", () => {
    it("verifies a signup OTP and redirects to the dashboard", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: null });
      const res = await GET(makeRequest("token_hash=abc&type=signup&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/dashboard");
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
      expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    });

    it("redirects to reset-password for recovery OTP", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: null });
      const res = await GET(makeRequest("token_hash=abc&type=recovery&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/reset-password");
    });

    it("redjects an unsupported type without calling verifyOtp", async () => {
      const res = await GET(makeRequest("token_hash=abc&type=magiclink&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/error?reason=invalid-link");
      expect(mocks.verifyOtp).not.toHaveBeenCalled();
    });

    it("redirects to an error page when the OTP is invalid/expired", async () => {
      mocks.verifyOtp.mockResolvedValue({ error: new Error("Token has expired") });
      const res = await GET(makeRequest("token_hash=abc&type=signup&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/error?reason=invalid-or-expired");
    });
  });

  describe("invalid / missing callbacks", () => {
    it("rejects when both code and token_hash are missing", async () => {
      const res = await GET(makeRequest("next=/dashboard"));
      expect(res.headers.get("location")).toContain("/error?reason=invalid-link");
    });

    it("rejects when both code and token_hash are present", async () => {
      const res = await GET(makeRequest("code=x&token_hash=abc&type=signup&next=/dashboard"));
      expect(res.headers.get("location")).toContain("/error?reason=invalid-link");
    });

    it("rejects an external redirect destination", async () => {
      mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
      const res = await GET(makeRequest("code=abc&next=https://evil.example"));
      expect(res.headers.get("location")).toContain("/dashboard");
      expect(res.headers.get("location")).not.toContain("evil.example");
    });
  });

  it("handles missing configuration", async () => {
    mocks.createClient.mockRejectedValue(new Error("env missing"));
    const res = await GET(makeRequest("code=abc&next=/dashboard"));
    expect(res.headers.get("location")).toContain("/error?reason=not-configured");
  });
});
