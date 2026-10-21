# SpendCoach Production Deployment Guide (Vercel & iOS Safari PWA)

This guide details the exact manual steps to deploy **SpendCoach** to Vercel, run migrations against production Postgres, configure environment secrets, and set up the standalone PWA on your iPhone.

---

## 1. Import Repository into Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New...** > **Project**.
3. Under **Import Git Repository**, select your `spendcoach` repository.
4. Keep framework preset as **Next.js**.
5. Set the Root Directory to `./` (default).

---

## 2. Configure Environment Variables in Vercel

In the Vercel project configuration screen (under **Environment Variables**), add the following environment variables.

> **Generating Strong Secrets**:
> Run these terminal commands locally to generate cryptographically secure 32-byte strings:
> ```bash
> openssl rand -base64 32
> ```

| Variable Name | Description | Example / Instructions |
|---|---|---|
| `DATABASE_URL` | Neon Postgres pooled connection URL | `postgresql://user:password@ep-xyz-pooler.us-east-2.aws.neon.tech/spendcoach?sslmode=require` |
| `APP_PASSCODE` | Single-user personal access passcode | e.g. Your personal secret PIN / passcode |
| `SESSION_SECRET` | 32-byte session JWT secret | Generate via `openssl rand -base64 32` |
| `CRON_SECRET` | Secret bearer token for Vercel Cron | Generate via `openssl rand -base64 32` |
| `GROQ_API_KEY` | Groq API Key for AI Daily Review | From [console.groq.com](https://console.groq.com) |
| `LLM_BASE_URL` | LLM API Base URL | `https://api.groq.com/openai/v1` (default) |
| `LLM_MODEL` | LLM Model Name | `llama-3.3-70b-versatile` (default) |

*Never commit `.env.local` to git; all production secrets must be set directly in the Vercel Project Settings.*

---

## 3. Set Project Function Region to Mumbai (`bom1`)

1. In your Vercel Project Dashboard, navigate to **Settings** > **Functions**.
2. Under **Function Region**, select **Mumbai, India (`bom1`)** if available on your plan (or the closest region to your Neon DB).
3. Click **Save**.

---

## 4. Backup First (Recommended Before Migrations or Major Updates)

Before running migrations or major deployments, ensure you have a backup of your data:
1. **Export CSV from SpendCoach**: Log into the web app, navigate to `/settings`, and click **Export Data (CSV)** to download your complete expenses and history locally.
2. **Neon Database Branch or Snapshot**:
   - Go to your [Neon Console](https://console.neon.tech).
   - Select your project > **Branches**.
   - Create a new branch (e.g. `pre-migration-backup`) or take a point-in-time restore snapshot.
   - If anything goes wrong, you can instantly restore from this branch without data loss.

---

## 5. Run Database Migration against Production DB

Before or right after your first deployment, apply the database schema migration to your production database.

Run this locally with your production `DATABASE_URL`:
```bash
DATABASE_URL="your-production-neon-database-url" pnpm db:migrate
```
*Note: `pnpm db:migrate` uses Drizzle Kit to apply migrations idempotently and is completely safe to run repeatedly on every deployment.*

---

## 6. Verify Scheduled Cron Jobs in Vercel

1. Once the deployment finishes, navigate to **Project** > **Settings** > **Cron Jobs** (or the **Cron Jobs** tab on your deployment overview).
2. Confirm that the three crons are registered:
   - **Daily Review Fallback**: `/api/cron/daily-review` — `0 18 * * *` (Daily at 18:00 UTC = 23:30 IST)
   - **Weekly Review**: `/api/reviews/weekly` — `30 3 * * 0` (Every Sunday at 03:30 UTC = 9:00 AM IST)
   - **Monthly Review**: `/api/reviews/monthly` — `30 3 1 * *` (1st of every month at 03:30 UTC = 9:00 AM IST)
3. **Important Note on Vercel Hobby Crons**:
   - All cron schedules are evaluated in **UTC**.
   - On the Vercel Hobby plan, cron jobs execute **anywhere within the scheduled hour** (not at the exact second) and are subject to daily Hobby limits (once per day per cron). The 23:30 IST job serves as a safe fallback for days when the user does not tap "Done for today".
4. Vercel automatically supplies the `Authorization: Bearer <CRON_SECRET>` header when executing the job.

---

## 7. Install as Standalone PWA on iPhone (Safari)

1. On your iPhone, open **Safari**.
2. Navigate to your production Vercel URL (e.g. `https://spendcoach.vercel.app`).
3. Tap the **Share** button (box with an upward arrow at the bottom of the screen).
4. Scroll down and tap **Add to Home Screen**.
5. Confirm the name is **SpendCoach** and tap **Add** in the top-right corner.
6. Return to your iPhone home screen:
   - Tap the new **SpendCoach** app icon.
   - Verify that it launches in **standalone mode** (no Safari browser URL bar or bottom navigation tabs).
   - Verify that the app layout respects iPhone safe areas (top notch/Dynamic Island and bottom home indicator bar).

---

## 8. Post-Deploy Checklist (10 Phone Verification Tests)

Run these 10 concrete tests on your live URL directly from your iPhone home-screen PWA:

1. **Health Check Endpoint**:
   - Open `https://<your-domain>/api/health` in Safari.
   - Assert response is: `{"ok":true}` with HTTP 200.
2. **Authentication Flow (Passcode Login)**:
   - Launch SpendCoach from the Home Screen.
   - Enter your `APP_PASSCODE` on `/login`.
   - Tap **Unlock SpendCoach** and verify smooth entry to the main dashboard (`/`).
3. **Log an Expense**:
   - On the Today dashboard, enter an amount (e.g. `₹250.00`), select category `Food`, enter merchant `Chaayos`, and note `Masala Chai`.
   - Tap **Save Expense**. Verify it immediately appears in Today's list with Indian digit formatting (`₹250.00`).
4. **Edit an Expense**:
   - Tap the expense in the list to open the edit sheet.
   - Change the amount to `₹300.00` and save.
   - Verify the list and running daily total update immediately.
5. **Delete an Expense**:
   - Delete the expense or create a test expense and delete it.
   - Verify the expense is removed and total recalculates.
6. **Insights & Learning Progress**:
   - Tap **Insights** in the top navigation bar.
   - Verify the learning progress bar is displayed (tracking entries toward 30 and days toward 14), with categories and budgets.
7. **Daily Review Generation**:
   - Tap **Review** in the navigation bar.
   - Verify the review card displays headline, mood badge, Went Well, Watch Out, Tomorrow's One Action, and Saving Ideas.
8. **Review Regeneration**:
   - Tap the **Regenerate** button on `/review`.
   - Verify the spinner animates, review refreshes, and remaining count decreases (`4 left today`).
9. **Brute-Force Passcode Lockout**:
   - Log out, then intentionally enter a wrong passcode 5 consecutive times.
   - Verify that the 5th attempt returns a clear lockout message with a countdown timer (e.g. `Too many failed attempts. Try again in 600 seconds.`).
10. **Session Logout**:
    - Log back in with the correct passcode.
    - Tap the **Logout** button (door icon in top-right of navbar).
    - Verify you are redirected to `/login` and browsing back immediately blocks access.
