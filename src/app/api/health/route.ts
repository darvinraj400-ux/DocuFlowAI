import { connection, NextResponse } from "next/server";
import { getAiConfig, getServerEnv, getSupabasePublicEnv } from "@/lib/env";

/**
 * Liveness + safe readiness check.
 * Returns only non-sensitive configuration flags (booleans / provider name).
 * Never returns secrets, private URLs, or credentials.
 *
 * `supabaseConfigured` reports configuration PRESENCE and validity (Supabase
 * URL + a browser-safe key). It does not imply a verified live connection.
 */
export async function GET() {
  await connection();

  let supabaseConfigured = false;
  let serverCredentialsConfigured = false;
  let extractionProvider: string | null = null;

  try {
    getSupabasePublicEnv();
    supabaseConfigured = true;
  } catch {
    // not configured
  }

  try {
    getServerEnv();
    serverCredentialsConfigured = true;
  } catch {
    // not configured
  }

  try {
    extractionProvider = getAiConfig().provider;
  } catch {
    extractionProvider = null;
  }

  return NextResponse.json({
    status: "ok",
    service: "docuflow-ai",
    time: new Date().toISOString(),
    readiness: {
      supabaseConfigured,
      serverCredentialsConfigured,
      extractionProvider,
    },
  });
}
