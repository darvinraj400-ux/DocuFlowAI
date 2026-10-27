# Email delivery with Resend (Supabase Custom SMTP)

DocuFlow AI uses **Supabase Auth** for all authentication (account creation,
signup confirmation links, password recovery links, PKCE authorization codes,
sessions, email verification, and password updates). **Resend** is the custom
SMTP delivery provider that delivers the emails Supabase generates.

> Important: we do NOT implement a second email system in Next.js, generate
> confirmation links manually, bypass Supabase Auth, or disable email
> confirmation. The application never calls the Resend API directly, and no
> `RESEND_API_KEY` is added to the Next.js environment.

This page has two parts:

1. **Configure Resend** (your Resend account/domain).
2. **Configure Supabase Custom SMTP** (Supabase Dashboard).

You must complete both before email delivery can work. Application code changes
alone cannot deliver email.

---

## 1. Resend setup

### Create a Resend account

1. Sign up at <https://resend.com>.
2. Confirm your email and complete the account setup.

### Add and verify a sending domain

1. In Resend, go to **Domains** → **Add Domain**.
2. Enter a domain you own (e.g. `your-verified-domain.com`).
3. Resend will show DNS records to add at your domain provider (the exact
   values are supplied by Resend — never invent them). Typically these include:
   - **SPF** (TXT record starting with `v=spf1`).
   - **DKIM** (TXT records, one per selector).
   - **DMARC** (TXT record, e.g. `v=DMARC1; p=none;`).
   - A **CNAME** record.
4. Add the records at your DNS provider and click **Verify** in Resend.
5. Wait for verification — it can take minutes to hours depending on DNS
   propagation. Only a verified domain can send email.

### Create a Resend API key for SMTP

1. In Resend, go to **API Keys** → **Create API Key**.
2. Give it a name (e.g. `docuflow-smtp`).
3. Choose the permission scope required by SMTP (typically **Full access**; the
   key is used only as the SMTP password).
4. Copy the key and keep it secret. This is the **SMTP password** for Supabase.

### Choose a sender address

Use an address on your verified domain, e.g. `no-reply@your-verified-domain`.
The domain must be verified before this address can send.

---

## 2. Supabase Custom SMTP configuration

### Where to enable it

1. Open your Supabase project → **Authentication** → **SMTP Settings** (or
   **Auth → Settings → SMTP**).
2. Toggle **Enable Custom SMTP** on.
3. Enter the following settings:

| Setting | Value |
| --- | --- |
| SMTP Host | `smtp.resend.com` |
| SMTP Port | `465` (SSL) |
| Username | `resend` |
| Password | your Resend **API key** |
| Sender email | `no-reply@your-verified-domain` (on your verified domain) |
| Sender name | `DocuFlow AI` |

> **Do not confuse credentials.** The Resend API key (used as the SMTP
> password) is different from the Supabase **service-role key**
> (`SUPABASE_SERVICE_ROLE_KEY`). They must never be interchanged. The
> service-role key stays in the Next.js server environment; the Resend API key
> lives only in the Supabase Dashboard.

Keep the default "Secure connection (TLS)" setting for port 465.

---

## 3. Authentication URLs

The emails Supabase generates link back into the app. These must match the app's
actual origin and the PKCE callback route `/auth/confirm`.

### Local development

- Site URL: `http://localhost:3000` (use the port you actually run `pnpm dev`
  on).
- Redirect URLs: add `http://localhost:3000/**`.

### Production (Vercel)

- Site URL: `https://<your-app>.vercel.app`.
- Redirect URLs: add `https://<your-app>.vercel.app/**`.

### Preview

- For Vercel Preview deployments, add each preview origin (e.g.
  `https://<project>-git-<branch>-<team>.vercel.app/**`), or configure a
  staging Supabase project if you want isolated email flows.

The callback flow is unchanged and PKCE-based: signup confirmation goes to
`/auth/confirm?next=/dashboard`; recovery goes to `/auth/confirm?next=/reset-password`.
The app's `NEXT_PUBLIC_SITE_URL` (or the header-derived origin) decides the
redirect base; configure Supabase Site URL/redirects to match it.

---

## 4. Delivery troubleshooting

- **Supabase Auth logs**: in the Supabase Dashboard, open **Authentication →
  Logs**. Look for `signup`, `recovery`, or SMTP send events and any errors.
- **Resend delivery events**: open the **Emails** page or **Logs** in Resend
  to see whether a message was accepted, delivered, opened, bounced, or
  rejected.
- **Bounced / rejected / suppressed**: Resend marks addresses as suppressed
  after bounces. Check **Suppressions** and remove an address if you expect it
  to receive email again.
- **HTTP 429 responses**: Supabase and Resend both rate-limit. If the app
  returns "Too many attempts", wait before retrying. Resend's limits are shown
  in its Dashboard/usage page.
- **Spam folder**: ask the user to check spam/junk. The app's signup message
  already mentions this.
- **Expired link**: confirmation/recovery links are time-limited. Request a
  fresh link (resend confirmation, or "Forgot password") when one expires.
- **Email-tracking rewrites**: some tracking proxies rewrite query parameters.
  Confirmation links must preserve the query parameters Supabase appends
  (the PKCE `code`). Do not route these links through link-shorteners or
  tracking rewrites.

---

## 5. Verify it end-to-end

1. Complete the Resend and Supabase setup above.
2. Start the app (`pnpm dev`) with Supabase configured.
3. Register with a fresh email → you should receive a confirmation email from
   `no-reply@your-verified-domain`. Open the link; it must land on `/dashboard`.
4. Sign out. On `/login`, choose "Forgot password" → you should receive a
   recovery email. Open the link; it must land on `/reset-password`, where you
   set a new password and are redirected to `/dashboard`.

If a link does not arrive, check Supabase Auth logs, Resend logs, and the spam
folder, then request a fresh email.
