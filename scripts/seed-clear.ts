import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { db } from '../src/db';
import {
  expenses,
  schedules,
  schedulePriceHistory,
  dayClosures,
  budgets,
  reviews,
  insightLog,
  loginAttempts,
  appSettings,
} from '../src/db/schema';
import { sql } from 'drizzle-orm';

async function seedClear() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production'
  ) {
    console.error('Refusing to run seed:clear: NODE_ENV is production or running on Vercel.');
    process.exit(1);
  }

  console.log('================================================================');
  console.log('                    SPENDCOACH SEED:CLEAR                       ');
  console.log('================================================================');
  console.log('Clearing all application tables...');

  // Delete in foreign key dependency order
  await db.delete(expenses);
  await db.delete(schedulePriceHistory);
  await db.delete(schedules);
  await db.delete(dayClosures);
  await db.delete(budgets);
  await db.delete(reviews);
  await db.delete(insightLog);
  await db.delete(loginAttempts);
  await db.delete(appSettings);

  console.log('\n--- VERIFYING TABLE ROW COUNTS (ALL ZERO) ---');

  const tables = [
    { name: 'expenses', table: expenses },
    { name: 'schedules', table: schedules },
    { name: 'schedule_price_history', table: schedulePriceHistory },
    { name: 'day_closures', table: dayClosures },
    { name: 'budgets', table: budgets },
    { name: 'reviews', table: reviews },
    { name: 'insight_log', table: insightLog },
    { name: 'login_attempts', table: loginAttempts },
    { name: 'app_settings', table: appSettings },
  ];

  let allZero = true;

  for (const t of tables) {
    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(t.table);
    const count = countResult?.count ?? 0;
    const status = count === 0 ? '✓ ZERO' : '✗ NON-ZERO';
    console.log(`Table: ${t.name.padEnd(25)} | Rows: ${String(count).padStart(4)} | ${status}`);
    if (count !== 0) {
      allZero = false;
    }
  }

  console.log('================================================================');
  if (allZero) {
    console.log('RESULT: ALL APPLICATION TABLES ARE CLEAN AND AT ZERO ROWS.');
    process.exit(0);
  } else {
    console.log('RESULT: SOME TABLES STILL HAVE ROWS.');
    process.exit(1);
  }
}

seedClear().catch((err) => {
  console.error('Seed clear failed:', err);
  process.exit(1);
});
