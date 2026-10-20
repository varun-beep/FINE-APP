# SpendCoach 💰

**SpendCoach** is a mobile-first, personal expense-tracking Progressive Web App (PWA) designed specifically for iPhone Safari ("Add to Home Screen").

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS (mobile-first, dark-mode aware, safe-area insets)
- **Database & ORM**: Neon Postgres (`@neondatabase/serverless`) + Drizzle ORM (`drizzle-kit`)
- **Validation**: Zod
- **Authentication**: Single passcode authentication with constant-time verification & 30-day signed JWT (`jose`, HS256) in an `httpOnly`, `Secure`, `SameSite=Lax` cookie
- **Testing**: Vitest
- **Package Manager**: pnpm

---

## Getting Started

### 1. Prerequisites

- Node.js 18+ (tested with v23)
- `pnpm` (version 9+)
- PostgreSQL (Neon serverless or local Postgres instance)

### 2. Configure Environment Variables

Copy the example environment configuration:

```bash
cp .env.example .env.local
```

Edit `.env.local` to configure your credentials:

```ini
# Database Connection (Neon Postgres URL or local PostgreSQL)
DATABASE_URL=postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/spendcoach?sslmode=require

# App Security
APP_PASSCODE=your_secret_passcode
SESSION_SECRET=spendcoach_super_secure_session_secret_at_least_32_bytes_long!

# Optional AI / Background Review Secrets
GROQ_API_KEY=
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
CRON_SECRET=your_cron_secret_here
```

> **Note**: `.env.local` is strictly ignored by git to protect credentials. Never commit secrets.

---

## Database Setup & Migrations

The Drizzle schema defines:
- `expenses`: `id` (uuid pk), `amount_paise` (integer, > 0), `category`, `note`, `merchant`, `spent_on` (local date in Asia/Kolkata), `created_at` (timestamptz). Indexes on `(spent_on)` and `(category, spent_on)`.
- `budgets`: `category` (text pk), `monthly_limit_paise` (integer).
- `reviews`: `review_date` (date pk), `stats_json` (jsonb), `advice_json` (jsonb), `source` ('llm' | 'fallback'), `created_at`.

### Generate Migrations
```bash
pnpm db:generate
```

### Apply Migrations to Database
```bash
pnpm db:migrate
```

---

## Development

Run the local development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Quality Checks & Testing

Run all quality checks:

```bash
# Typecheck TypeScript (strict mode)
pnpm typecheck

# Lint with ESLint
pnpm lint

# Run Vitest test suite
pnpm test

# Build production bundle
pnpm build
```

---

## PWA & iOS Safari "Add to Home Screen"

SpendCoach is pre-configured with:
- Apple mobile web app capability (`apple-mobile-web-app-capable: yes`, `black-translucent` status bar)
- Viewport fit cover (`viewport-fit=cover`)
- Safe-area insets (`env(safe-area-inset-*)`) for notch and home bar
- Standalone display mode in `app/manifest.ts`
- Crisp app icons: 192x192, 512x512, maskable 512x512, and 180x180 Apple touch icon

To regenerate icons at any time:
```bash
pnpm generate-icons
```

---

## API Endpoints

- `GET /api/health` - Public health check (returns `{ ok: true }`).
- `POST /api/login` - Verify passcode (with brute-force limit: max 5 failed attempts in 10 minutes) & set 30-day session cookie.
- `POST /api/logout` - Clear session cookie.
- `GET /api/expenses` - Retrieve expenses (supports `?date=YYYY-MM-DD`, `?month=YYYY-MM`, or date range `?from=&to=`).
- `POST /api/expenses` - Create a new expense (validates `amount_paise`, `category`, `spent_on`, `note`, `merchant`).
- `PATCH /api/expenses/[id]` - Update existing expense.
- `DELETE /api/expenses/[id]` - Delete expense.
- `GET /api/insights` - Returns latest computed engine metrics (anomalies, recurring charges, budget run-rate, trends, learning progress).
- `GET, PATCH /api/budgets` - Manage monthly category spending budgets.
- `GET, POST /api/daily-review` - Generate/retrieve AI daily reviews (supports `{ regenerate: boolean }`, capped at 5/day).
- `GET /api/cron/daily-review` - Vercel Cron endpoint scheduled daily at 6:00 PM IST (`30 12 * * *`).

---

## Synthetic Seed Scripts (Development Only)

- `pnpm seed:demo` - Inserts 90 days of realistic synthetic spending including 3 planted anomalies and 2 recurring charges.
- `pnpm seed:clear` - Cleans up all seeded entries and recomputes clean engine state.

> **Safety Guard**: Seed scripts automatically refuse execution if `NODE_ENV=production` or `VERCEL=1`.

---

## Production Deployment

See [DEPLOY.md](./DEPLOY.md) for step-by-step instructions on deploying to Vercel, configuring secrets, and installing the standalone PWA on iPhone Safari.
