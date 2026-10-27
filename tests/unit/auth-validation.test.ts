import { describe, expect, it } from "vitest";
import {
  emailSchema,
  fieldErrors,
  passwordSchema,
  signInSchema,
  signUpSchema,
  resetPasswordSchema,
} from "@/lib/auth/validation";

describe("auth validation", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.parse("alice@example.com")).toBe("alice@example.com");
  });

  it("rejects invalid emails", () => {
    expect(() => emailSchema.parse("not-an-email")).toThrow();
    expect(() => emailSchema.parse("")).toThrow();
  });

  it("enforces password length", () => {
    expect(passwordSchema.parse("password123")).toBe("password123");
    expect(() => passwordSchema.parse("short")).toThrow();
  });

  it("validates sign-in input", () => {
    expect(fieldErrors(signInSchema, { email: "a@b.com", password: "x" })).toEqual({});
    const errors = fieldErrors(signInSchema, { email: "bad", password: "" });
    expect(errors.email).toBeTruthy();
    expect(errors.password).toBeTruthy();
  });

  it("rejects mismatched passwords on sign-up", () => {
    const errors = fieldErrors(signUpSchema, {
      email: "a@b.com",
      password: "password123",
      confirmPassword: "different",
    });
    expect(errors.confirmPassword).toBe("Passwords do not match.");
  });

  it("validates reset-password schema", () => {
    const errors = fieldErrors(resetPasswordSchema, {
      password: "password123",
      confirmPassword: "password123",
    });
    expect(errors).toEqual({});
    const mismatch = fieldErrors(resetPasswordSchema, {
      password: "password123",
      confirmPassword: "password124",
    });
    expect(mismatch.confirmPassword).toBeTruthy();
  });
});
