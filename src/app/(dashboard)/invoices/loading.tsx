export default function InvoicesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading invoices</span>
      <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      <div className="h-9 w-full animate-pulse rounded bg-muted" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
