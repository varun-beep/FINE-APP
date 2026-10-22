import { config } from 'dotenv';
import { expenses, insightLog } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { calculateSafeToSpend } from '../src/lib/engine/safetospend';

config({ path: '.env.local' });
config();

async function main() {
  const neonTestUrl = process.env.NEON_TEST_DATABASE_URL;
  if (!neonTestUrl || neonTestUrl.trim() === '') {
    console.log('================================================================');
    console.log('                 B1. DRIVER PARITY CHECK                        ');
    console.log('================================================================');
    console.log('NEON_TEST_DATABASE_URL is empty.');
    console.log('STOPPING task B1 per rules: Do not invent or fake connection strings.');
    console.log('Final Result for B1: NOT RUN (NEON_TEST_DATABASE_URL is not set).');
    console.log('================================================================');
    process.exit(0);
  }

  console.log('================================================================');
  console.log('                 B1. DRIVER PARITY CHECK                        ');
  console.log('================================================================');
  console.log('NEON_TEST_DATABASE_URL found. Testing @neondatabase/serverless driver...');

  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');

  // WebSocket / fetch configuration if needed
  const pool = new Pool({ connectionString: neonTestUrl });
  const testDb = drizzle(pool);

  const testExpenseId = `test_driver_${Date.now()}`;
  const testInsightKey = `test_driver_insight_${Date.now()}`;

  try {
    console.log('1. Inserting test expense...');
    await testDb.insert(expenses).values({
      id: testExpenseId,
      amountPaise: 45000,
      category: 'Food',
      merchant: 'DriverParityTest',
      note: 'Driver parity verification',
      spentOn: new Date().toISOString().slice(0, 10),
      source: 'manual',
      kind: 'spend',
      createdAt: new Date(),
    });

    console.log('2. Running calculateSafeToSpend against test data...');
    const s2s = calculateSafeToSpend(
      [
        {
          id: testExpenseId,
          amountPaise: 45000,
          category: 'Food',
          spentOn: new Date().toISOString().slice(0, 10),
          kind: 'spend',
        },
      ],
      [],
      new Date().toISOString().slice(0, 10)
    );
    console.log(`   Allowance calculated: ${s2s.allowance ? 'OK' : 'Insufficient Data'}`);

    console.log('3. Recording insight_log row...');
    await testDb.insert(insightLog).values({
      insightKey: testInsightKey,
      firstShown: new Date(),
      lastShown: new Date(),
      timesShown: 1,
      dismissed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log('4. Cleaning up inserted rows...');
    await testDb.delete(expenses).where(eq(expenses.id, testExpenseId));
    await testDb.delete(insightLog).where(eq(insightLog.insightKey, testInsightKey));

    await pool.end();
    console.log('B1 DRIVER PARITY: PASS');
  } catch (err) {
    console.error('B1 DRIVER PARITY FAILED:', err);
    try {
      await testDb.delete(expenses).where(eq(expenses.id, testExpenseId));
      await testDb.delete(insightLog).where(eq(insightLog.insightKey, testInsightKey));
      await pool.end();
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running driver parity:', err);
  process.exit(1);
});
