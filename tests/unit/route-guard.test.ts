import { describe, expect, it } from "vitest";
import { computeAuthRedirect, resolveRouteKind } from "@/lib/auth/route-guard";

describe("route guard", () => {
  it("classifies protected, guest, and public routes", () => {
    expect(resolveRouteKind("/dashboard")).toBe("protected");
    expect(resolveRouteKind("/dashboard/invoices")).toBe("protected");
    expect(resolveRouteKind("/settings")).toBe("protected");
    expect(resolveRouteKind("/settings/security")).toBe("protected");
    expect(resolveRouteKind("/login")).toBe("guest");
    expect(resolveRouteKind("/register")).toBe("guest");
    expect(resolveRouteKind("/forgot-password")).toBe("guest");
    expect(resolveRouteKind("/reset-password")).toBe("guest");
    expect(resolveRouteKind("/")).toBe("public");
    expect(resolveRouteKind("/auth/confirm")).toBe("public");
  });

  it("redirects unauthenticated users away from protected routes", () => {
    expect(computeAuthRedirect({ authenticated: false, pathname: "/dashboard" })).toBe("/login");
    expect(computeAuthRedirect({ authenticated: false, pathname: "/dashboard/account" })).toBe("/login");
  });

  it("lets authenticated users stay on protected routes", () => {
    expect(computeAuthRedirect({ authenticated: true, pathname: "/dashboard" })).toBeNull();
  });

  it("keeps authenticated users off guest pages", () => {
    expect(computeAuthRedirect({ authenticated: true, pathname: "/login" })).toBe("/dashboard");
    expect(computeAuthRedirect({ authenticated: true, pathname: "/register" })).toBe("/dashboard");
  });

  it("leaves public pages alone", () => {
    expect(computeAuthRedirect({ authenticated: true, pathname: "/" })).toBeNull();
    expect(computeAuthRedirect({ authenticated: false, pathname: "/auth/confirm" })).toBeNull();
  });
});
