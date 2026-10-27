import Link from "next/link";
import { FileUp, ScanLine, UserCheck, ShieldCheck, SearchCheck, Timer, BrainCircuit } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";

const WORKFLOW = [
  {
    icon: FileUp,
    title: "Upload invoices",
    body: "Drop in PDFs or images. Files are kept private and scoped to your account.",
  },
  {
    icon: ScanLine,
    title: "AI extraction & validation",
    body: "The pipeline reads the document, checks required fields, and flags inconsistencies.",
  },
  {
    icon: UserCheck,
    title: "Human review",
    body: "Nothing is auto-approved. Review edits and approvals stay under your control.",
  },
];

const FEATURES = [
  { icon: ShieldCheck, title: "Private by design", body: "Files live in a private bucket; records are isolated per user with row-level security." },
  { icon: SearchCheck, title: "Duplicate detection", body: "Exact-file and supplier/number duplicates are surfaced for review, not silently dropped." },
  { icon: Timer, title: "No fabricated outputs", body: "Metrics reflect your real records — or an honest empty state." },
  { icon: BrainCircuit, title: "Extensible AI layer", body: "A pluggable extraction provider keeps the pipeline testable and swap-friendly." },
];

export default function Home() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
            <Link href="/register" className={buttonVariants()}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Invoice processing, minus the paperwork
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
            DocuFlow AI turns supplier invoices into clean, reviewable data. It&apos;s
            designed around a simple, safe loop: <strong>extract</strong>,{" "}
            <strong>validate</strong>, and <strong>let a human decide</strong>.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}>
              Create a free account
            </Link>
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg", className: "w-full sm:w-auto" })}>
              Sign in
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Authentication is live today. The AI processing pipeline is in active development.
          </p>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {WORKFLOW.map((step) => (
              <div key={step.title} className="rounded-xl border border-border bg-card p-6 text-left shadow-sm">
                <step.icon className="size-6 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-medium">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Built for trustworthy automation
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-xl border border-border bg-background p-6">
                  <feature.icon className="size-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 font-medium">{feature.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Ready when you are</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Set up your account now — it only takes a minute. You&apos;ll be first in line
            when invoice processing arrives.
          </p>
          <div className="mt-6">
            <Link href="/register" className={buttonVariants({ size: "lg" })}>
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <Brand />
          <p className="text-sm text-muted-foreground">
            © 2026 DocuFlow AI. Portfolio project.
          </p>
        </div>
      </footer>
    </div>
  );
}
