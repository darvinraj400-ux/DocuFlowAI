import { Inngest } from "inngest";

/**
 * Local development uses the Inngest Dev Server when no cloud credentials are
 * configured. Setting `INNGEST_DEV=0` (or providing keys) opts into cloud mode.
 * This is evaluated server-side only; no keys are ever exposed to the browser.
 */
export function isInngestDevMode(): boolean {
  const flag = process.env.INNGEST_DEV?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  if (process.env.INNGEST_EVENT_KEY || process.env.INNGEST_SIGNING_KEY) return false;
  return process.env.NODE_ENV !== "production";
}

export const inngest = new Inngest({
  id: "docuflow-ai",
  isDev: isInngestDevMode(),
});
