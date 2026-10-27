import { describe, expect, it } from "vitest";
import {
  INVOICE_APPROVED_WEBHOOK_REQUESTED,
  INVOICE_PROCESSING_REQUESTED,
  parseApprovedWebhookEvent,
  parseProcessingEvent,
} from "@/lib/inngest/events";

const VALID = {
  invoiceId: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
  ownerId: "9e5f2c1a-4b3d-4f6e-8a7b-1c2d3e4f5a6b",
  jobId: "job-1234-abcd",
};

describe("invoice processing event", () => {
  it("uses a stable event name", () => {
    expect(INVOICE_PROCESSING_REQUESTED).toBe("invoice/processing.requested");
  });

  it("accepts a well-formed event", () => {
    expect(parseProcessingEvent(VALID)).toEqual(VALID);
  });

  it("rejects malformed identifiers and missing fields", () => {
    expect(parseProcessingEvent({ ...VALID, invoiceId: "not-a-uuid" })).toBeNull();
    expect(parseProcessingEvent({ ...VALID, ownerId: 42 })).toBeNull();
    expect(parseProcessingEvent({ ...VALID, jobId: "short" })).toBeNull();
    expect(parseProcessingEvent({ invoiceId: VALID.invoiceId, ownerId: VALID.ownerId })).toBeNull();
    expect(parseProcessingEvent(null)).toBeNull();
    expect(parseProcessingEvent("invoice/processing.requested")).toBeNull();
  });

  it("ignores additional event fields", () => {
    expect(parseProcessingEvent({ ...VALID, injected: "ignored" })).toEqual(VALID);
  });
});

const APPROVED = {
  invoiceId: "7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f",
  ownerId: "9e5f2c1a-4b3d-4f6e-8a7b-1c2d3e4f5a6b",
  approvedAt: "2026-01-02T03:04:05.000Z",
};

describe("invoice approved webhook event", () => {
  it("uses a stable event name", () => {
    expect(INVOICE_APPROVED_WEBHOOK_REQUESTED).toBe("invoice/approved.webhook.requested");
  });

  it("accepts a well-formed event", () => {
    expect(parseApprovedWebhookEvent(APPROVED)).toEqual(APPROVED);
  });

  it("rejects malformed identifiers, timestamps, and missing fields", () => {
    expect(parseApprovedWebhookEvent({ ...APPROVED, invoiceId: "not-a-uuid" })).toBeNull();
    expect(parseApprovedWebhookEvent({ ...APPROVED, ownerId: 42 })).toBeNull();
    expect(parseApprovedWebhookEvent({ ...APPROVED, approvedAt: "yesterday" })).toBeNull();
    expect(
      parseApprovedWebhookEvent({ invoiceId: APPROVED.invoiceId, ownerId: APPROVED.ownerId }),
    ).toBeNull();
    expect(parseApprovedWebhookEvent(null)).toBeNull();
  });

  it("ignores additional event fields", () => {
    expect(parseApprovedWebhookEvent({ ...APPROVED, injected: "ignored" })).toEqual(APPROVED);
  });
});
