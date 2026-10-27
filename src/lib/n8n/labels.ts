export interface AuditEventView {
  event_type: string;
  metadata: unknown;
}

function actionOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const action = (metadata as Record<string, unknown>).action;
  return typeof action === "string" ? action : null;
}

const STATUS_ACTION_LABELS: Record<string, string> = {
  corrections_saved: "corrections saved",
  webhook_enqueue_failed: "webhook queueing failed",
  webhook_delivery_failed: "webhook delivery failed",
};

/** Human-readable audit labels, including webhook delivery outcomes. */
export function auditEventLabel(event: AuditEventView): string {
  if (event.event_type === "webhook_sent") return "webhook delivered";

  if (event.event_type === "status_changed") {
    const action = actionOf(event.metadata);
    if (action && action in STATUS_ACTION_LABELS) return STATUS_ACTION_LABELS[action];
  }

  return event.event_type.replace(/_/g, " ");
}

/** Optional safe detail for failed webhook deliveries (code and HTTP status). */
export function auditEventDetail(event: AuditEventView): string | null {
  if (event.event_type !== "status_changed") return null;
  if (actionOf(event.metadata) !== "webhook_delivery_failed") return null;

  const metadata = event.metadata as Record<string, unknown>;
  const code = typeof metadata.code === "string" ? metadata.code : null;
  const httpStatus = typeof metadata.httpStatus === "number" ? metadata.httpStatus : null;
  const parts = [code, httpStatus ? `HTTP ${httpStatus}` : null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}
