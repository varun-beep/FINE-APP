import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { db } from '../src/db';
import { expenses, reviews } from '../src/db/schema';
import { recomputeAndPersistEngine } from '../src/lib/engine/db';
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

  console.log('Clearing all demo seeded data...');

  const result = await db
    .delete(expenses)
    .where(sql`note LIKE '%[SEED_DEMO]%'`)
    .returning();

  console.log(`✓ Deleted ${result.length} seeded demo expenses.`);

  // Clear or recompute engine
  const output = await recomputeAndPersistEngine();
  console.log('✓ Recomputed clean engine state.');
  console.log(`- Status: ${output.learning.status}`);
  console.log(`- Remaining expenses: ${output.learning.expenseCount}`);
  process.exit(0);
}

seedClear().catch((err) => {
  console.error('Seed clear failed:', err);
  process.exit(1);
});
