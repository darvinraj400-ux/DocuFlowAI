"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { ExtractionResult, LineItem } from "@/lib/pipeline/schema";
import type { ValidationFinding, DuplicateFlags } from "@/types/invoice";
import { approveAction, rejectAction, saveCorrectionsAction, type ReviewFormState } from "@/lib/review/actions";

const EMPTY_LINE: LineItem = { description: "", quantity: "", unitPrice: "", taxAmount: "", lineTotal: "" };

function formatPartyAddress(address: unknown): string {
  if (typeof address === "string") return address;
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    return [a.street, a.city, a.state, a.zip, a.postalCode, a.country]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .join(", ");
  }
  return "";
}

function emptyValue(): ExtractionResult {
  return {
    supplierName: "", supplierTaxId: "", invoiceNumber: "", invoiceDate: "", dueDate: "",
    currencyCode: "", subtotal: "", taxTotal: "", total: "", paymentTerms: "",
    documentType: "", orderNumber: "", buyerName: "", buyerTaxId: "",
    shippingCost: "", amountPaid: "", balanceDue: "", amountDiscounted: "",
    lineItems: [EMPTY_LINE],
  };
}

function toValue(initial: Partial<ExtractionResult> | null): ExtractionResult {
  const base = emptyValue();
  if (!initial) return base;
  return {
    ...base,
    ...initial,
    lineItems: (initial.lineItems?.length ? initial.lineItems : [EMPTY_LINE]).map((l) => ({ ...EMPTY_LINE, ...l })),
  };
}

function buildFormData(v: ExtractionResult): FormData {
  const fd = new FormData();
  const set = (key: string, val: string | null | undefined) => fd.set(key, val == null ? "" : String(val));
  set("supplierName", v.supplierName);
  set("supplierTaxId", v.supplierTaxId);
  set("invoiceNumber", v.invoiceNumber);
  set("invoiceDate", v.invoiceDate);
  set("dueDate", v.dueDate);
  set("currencyCode", v.currencyCode);
  set("subtotal", v.subtotal);
  set("taxTotal", v.taxTotal);
  set("total", v.total);
  set("paymentTerms", v.paymentTerms);
  (v.lineItems ?? []).forEach((line, i) => {
    set(`li_${i}_description`, line.description);
    set(`li_${i}_quantity`, line.quantity);
    set(`li_${i}_unitPrice`, line.unitPrice);
    set(`li_${i}_taxAmount`, line.taxAmount);
    set(`li_${i}_lineTotal`, line.lineTotal);
  });
  return fd;
}

export function ReviewForm(props: {
  invoiceId: string;
  initial: Partial<ExtractionResult> | null;
  findings: ValidationFinding[];
  duplicateFlags: DuplicateFlags | null;
  demo: boolean;
  status: string;
}) {
  const [value, setValue] = useState(() => toValue(props.initial));
  const [global, setGlobal] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof ExtractionResult, val: string) => setValue((v) => ({ ...v, [key]: val }));
  const setLine = (index: number, key: keyof LineItem, val: string) =>
    setValue((v) => ({
      ...v,
      lineItems: (v.lineItems ?? []).map((line, i) => (i === index ? { ...line, [key]: val } : line)),
    }));

  function run(action: typeof approveAction) {
    setGlobal(null);
    setFieldErrors({});
    const fd = buildFormData(value);
    startTransition(async () => {
      try {
        const state: ReviewFormState = await action(props.invoiceId, {}, fd);
        if (state?.errors) setFieldErrors(state.errors);
        if (state?.global) setGlobal(state.global);
      } catch {
        // Successful actions redirect; ignore the redirect signal.
      }
    });
  }

  const inputCls = "mt-1.5";
  const fieldError = (key: string) => fieldErrors[key] ? <p className="text-xs text-destructive">{fieldErrors[key]}</p> : null;

  return (
    <div className="space-y-6">
      {global && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{global}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{props.status.replace("_", " ")}</Badge>
        {props.demo && <Badge variant="info">Simulated extraction</Badge>}
        {props.duplicateFlags?.duplicateHash && <Badge variant="warning">Duplicate file</Badge>}
        {props.duplicateFlags?.duplicateNumber && <Badge variant="warning">Duplicate invoice number</Badge>}
      </div>

      {props.findings.length > 0 && (
        <div className="rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium">Validation findings</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {props.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <Badge variant={f.severity === "error" ? "destructive" : f.severity === "warning" ? "warning" : "secondary"} className="shrink-0">
                  {f.severity}
                </Badge>
                <span className="text-muted-foreground">{f.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="supplierName">Supplier</Label><Input id="supplierName" value={value.supplierName ?? ""} onChange={(e) => set("supplierName", e.target.value)} className={inputCls} />{fieldError("supplierName")}</div>
          <div><Label htmlFor="supplierTaxId">Tax ID</Label><Input id="supplierTaxId" value={value.supplierTaxId ?? ""} onChange={(e) => set("supplierTaxId", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="invoiceNumber">Invoice number</Label><Input id="invoiceNumber" value={value.invoiceNumber ?? ""} onChange={(e) => set("invoiceNumber", e.target.value)} className={inputCls} />{fieldError("invoiceNumber")}</div>
          <div><Label htmlFor="invoiceDate">Invoice date</Label><Input id="invoiceDate" value={value.invoiceDate ?? ""} onChange={(e) => set("invoiceDate", e.target.value)} className={inputCls} />{fieldError("invoiceDate")}</div>
          <div><Label htmlFor="dueDate">Due date</Label><Input id="dueDate" value={value.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="currencyCode">Currency</Label><Input id="currencyCode" value={value.currencyCode ?? ""} onChange={(e) => set("currencyCode", e.target.value)} className={inputCls} />{fieldError("currencyCode")}</div>
          <div><Label htmlFor="subtotal">Subtotal</Label><Input id="subtotal" value={value.subtotal ?? ""} onChange={(e) => set("subtotal", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="taxTotal">Tax total</Label><Input id="taxTotal" value={value.taxTotal ?? ""} onChange={(e) => set("taxTotal", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="total">Total</Label><Input id="total" value={value.total ?? ""} onChange={(e) => set("total", e.target.value)} className={inputCls} />{fieldError("total")}</div>
          <div><Label htmlFor="paymentTerms">Payment terms</Label><Input id="paymentTerms" value={value.paymentTerms ?? ""} onChange={(e) => set("paymentTerms", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="documentType">Document type</Label><Input id="documentType" value={value.documentType ?? ""} onChange={(e) => set("documentType", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="orderNumber">Order / PO number</Label><Input id="orderNumber" value={value.orderNumber ?? ""} onChange={(e) => set("orderNumber", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="buyerName">Buyer / customer</Label><Input id="buyerName" value={value.buyerName ?? ""} onChange={(e) => set("buyerName", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="buyerTaxId">Buyer tax ID</Label><Input id="buyerTaxId" value={value.buyerTaxId ?? ""} onChange={(e) => set("buyerTaxId", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="shippingCost">Shipping</Label><Input id="shippingCost" value={value.shippingCost ?? ""} onChange={(e) => set("shippingCost", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="amountPaid">Amount paid</Label><Input id="amountPaid" value={value.amountPaid ?? ""} onChange={(e) => set("amountPaid", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="balanceDue">Balance due</Label><Input id="balanceDue" value={value.balanceDue ?? ""} onChange={(e) => set("balanceDue", e.target.value)} className={inputCls} /></div>
          <div><Label htmlFor="amountDiscounted">Discount</Label><Input id="amountDiscounted" value={value.amountDiscounted ?? ""} onChange={(e) => set("amountDiscounted", e.target.value)} className={inputCls} /></div>
        </div>

        {(value.seller || value.buyer || (value.taxes ?? []).length > 0 || (value.fees ?? []).length > 0 || (value.discounts ?? []).length > 0 || value.paymentDetails) && (
          <div className="rounded-xl border border-border p-4 text-sm">
            <h3 className="text-sm font-medium">From extraction (preserved, read-only)</h3>
            <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
              {value.seller && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Seller</span>
                  <p className="text-foreground">{value.seller.name ?? "—"}{value.seller.taxId ? ` · ${value.seller.taxId}` : ""}</p>
                  {value.seller.address && <p className="text-xs">{formatPartyAddress(value.seller.address)}</p>}
                  {value.seller.email && <p className="text-xs">{value.seller.email}</p>}
                </div>
              )}
              {value.buyer && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Buyer</span>
                  <p className="text-foreground">{value.buyer.name ?? "—"}{value.buyer.taxId ? ` · ${value.buyer.taxId}` : ""}</p>
                  {value.buyer.address && <p className="text-xs">{formatPartyAddress(value.buyer.address)}</p>}
                  {value.buyer.email && <p className="text-xs">{value.buyer.email}</p>}
                </div>
              )}
              {(value.taxes ?? []).length > 0 && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Taxes</span>
                  <ul className="text-foreground">
                    {value.taxes!.map((t, i) => (
                      <li key={i}>{[t.name, t.rate ? `${t.rate}%` : null, t.amount].filter(Boolean).join(" · ") || "—"}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(value.fees ?? []).length > 0 && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Fees</span>
                  <ul className="text-foreground">
                    {value.fees!.map((f, i) => (
                      <li key={i}>{[f.description, f.amount].filter(Boolean).join(" · ") || "—"}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(value.discounts ?? []).length > 0 && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Discounts</span>
                  <ul className="text-foreground">
                    {value.discounts!.map((d, i) => (
                      <li key={i}>{[d.description, d.amount].filter(Boolean).join(" · ") || "—"}</li>
                    ))}
                  </ul>
                </div>
              )}
              {value.paymentDetails && (
                <div>
                  <span className="text-xs uppercase tracking-wide">Payment details</span>
                  <p className="text-foreground">{value.paymentDetails.method ?? "—"}</p>
                  {value.paymentDetails.instructions && <p className="text-xs">{value.paymentDetails.instructions}</p>}
                  {value.paymentDetails.bankName && <p className="text-xs">{value.paymentDetails.bankName} · {value.paymentDetails.accountNumber ?? ""}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Line items</h3>
          {(value.lineItems ?? []).map((line, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-5">
              <Input placeholder="Description" value={line.description ?? ""} onChange={(e) => setLine(i, "description", e.target.value)} />
              <Input placeholder="Qty" value={line.quantity ?? ""} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              <Input placeholder="Unit price" value={line.unitPrice ?? ""} onChange={(e) => setLine(i, "unitPrice", e.target.value)} />
              <Input placeholder="Tax" value={line.taxAmount ?? ""} onChange={(e) => setLine(i, "taxAmount", e.target.value)} />
              <Input placeholder="Line total" value={line.lineTotal ?? ""} onChange={(e) => setLine(i, "lineTotal", e.target.value)} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => run(saveCorrectionsAction)}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />} Save corrections
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => run(approveAction)}
          >
            {isPending && <Loader2 className="size-4 animate-spin" />} Approve
          </Button>
          <div className="flex flex-1 items-center gap-2 sm:justify-end">
            <Input placeholder="Rejection note (optional)" value={note} onChange={(e) => { setNote(e.target.value); setValue((v) => v); }} className="max-w-xs" />
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                const fd = buildFormData(value);
                fd.set("rejectionNote", note);
                setGlobal(null);
                setFieldErrors({});
                startTransition(async () => {
                  try {
                    const state = await rejectAction(props.invoiceId, {}, fd);
                    if (state?.global) setGlobal(state.global);
                  } catch { /* redirect */ }
                });
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />} Reject
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
