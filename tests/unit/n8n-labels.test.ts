import { describe, expect, it } from "vitest";
import { auditEventDetail, auditEventLabel } from "@/lib/n8n/labels";

describe("audit event labels", () => {
  it("labels a successful webhook delivery", () => {
    expect(auditEventLabel({ event_type: "webhook_sent", metadata: null })).toBe(
      "webhook delivered",
    );
    expect(auditEventDetail({ event_type: "webhook_sent", metadata: null })).toBeNull();
  });

  it("labels a failed webhook delivery with safe diagnostic detail", () => {
    const event = {
      event_type: "status_changed",
      metadata: {
        action: "webhook_delivery_failed",
        code: "http_error",
        httpStatus: 503,
        attempts: 3,
      },
    };

    expect(auditEventLabel(event)).toBe("webhook delivery failed");
    expect(auditEventDetail(event)).toBe("http_error · HTTP 503");
  });

  it("labels failures to queue the webhook", () => {
    const event = {
      event_type: "status_changed",
      metadata: { action: "webhook_enqueue_failed" },
    };

    expect(auditEventLabel(event)).toBe("webhook queueing failed");
    expect(auditEventDetail(event)).toBeNull();
  });

  it("keeps corrections and unrelated events readable", () => {
    expect(
      auditEventLabel({
        event_type: "status_changed",
        metadata: { action: "corrections_saved" },
      }),
    ).toBe("corrections saved");
    expect(auditEventLabel({ event_type: "processing_succeeded", metadata: null })).toBe(
      "processing succeeded",
    );
    expect(auditEventLabel({ event_type: "approved", metadata: undefined })).toBe("approved");
  });

  it("tolerates malformed metadata", () => {
    expect(auditEventLabel({ event_type: "status_changed", metadata: "nope" })).toBe(
      "status changed",
    );
    expect(auditEventDetail({ event_type: "status_changed", metadata: 42 })).toBeNull();
  });
});
