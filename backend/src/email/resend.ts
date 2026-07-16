/**
 * Thin wrapper around the Resend SDK.
 *
 * Behavior:
 *   - When RESEND_API_KEY is unset, logs the payload and pretends
 *     success. Lets local dev + CI boot cleanly without a real key.
 *   - Otherwise sends via Resend and returns the id (or throws).
 *
 * We deliberately keep this dependency-thin (one import from `resend`)
 * so the rest of the app doesn't couple to the SDK shape.
 */
import { Resend } from "resend";
import { config } from "../config.js";

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  text?: string;
};

let cached: Resend | null = null;
function client(): Resend | null {
  if (!config.email.resendApiKey) return null;
  if (!cached) cached = new Resend(config.email.resendApiKey);
  return cached;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string | null; skipped: boolean }> {
  const c = client();
  if (!c) {
    console.log(
      `[email] RESEND_API_KEY unset — would have sent "${input.subject}" to ${input.to.join(", ")}`,
    );
    return { id: null, skipped: true };
  }
  const res = await c.emails.send({
    from: config.email.fromAddress,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (res.error) {
    throw new Error(`resend error: ${res.error.name}: ${res.error.message}`);
  }
  return { id: res.data?.id ?? null, skipped: false };
}
