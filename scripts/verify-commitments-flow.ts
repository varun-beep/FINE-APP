import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { SignJWT } from 'jose';
import { db } from '../src/db';
import { expenses, schedules, schedulePriceHistory, dayClosures, reviews } from '../src/db/schema';
import { sql, eq } from 'drizzle-orm';
import { postDueSchedules } from '../src/lib/schedules';
import { recomputeAndPersistEngine } from '../src/lib/engine/db';

const BASE_URL = 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET || 'spendcoach-dev-secret-at-least-32-chars-long';

async function getAuthCookie(): Promise<string> {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  const token = await new SignJWT({ auth: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
  return `session=${token}`;
}

async function main() {
  console.log('=== STARTING SPENDCOACH COMMITMENTS & FAST ENTRY VERIFICATION ===\n');
  const authCookie = await getAuthCookie();
  const headers = {
    'Content-Type': 'application/json',
    Cookie: authCookie,
  };

  try {
    // 0. Clean prior verification test artifacts
    console.log('0. Preparing clean test environment...');
    await db.delete(expenses).where(sql`merchant LIKE 'PROVE_%'`);
    await db.delete(schedules).where(sql`name LIKE 'PROVE_%'`);
    await db.delete(dayClosures).where(sql`day::text LIKE '2026-03-%'`);

    // 1. Create Daily Gold Schedule via HTTP POST /api/schedules
    console.log('1. Creating Daily Gold schedule via POST /api/schedules...');
    const goldPayload = {
      name: 'PROVE_DailyGold',
      kind: 'investment',
      category: 'Investment',
      amount_paise: 50000, // ₹500
      frequency: 'daily',
      anchor_date: '2026-03-01',
      start_date: '2026-03-01',
      end_date: '2026-03-10',
      active: true,
    };

    const goldRes = await fetch(`${BASE_URL}/api/schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(goldPayload),
    });

    if (!goldRes.ok) {
      throw new Error(`Failed to create gold schedule: ${goldRes.status} ${await goldRes.text()}`);
    }
    const goldData = await goldRes.json();
    const goldId = goldData.schedule.id;
    console.log(`✓ Created Gold schedule (ID: ${goldId})`);

    // 2. Post schedules across a 10-day gap: 2026-03-01 through 2026-03-10
    console.log('2. Posting schedules across a 10-day gap (2026-03-01 through 2026-03-10)...');
    const postRes1 = await postDueSchedules('2026-03-10');
    console.log(`✓ First run posted count: ${postRes1.postedCount}`);

    // Verify exactly 10 rows in expenses
    const goldExpenses1 = await db
      .select()
      .from(expenses)
      .where(eq(expenses.scheduleId, goldId));
    console.log(`✓ Exact rows created for gold schedule: ${goldExpenses1.length} (Expected: 10)`);
    if (goldExpenses1.length !== 10) {
      throw new Error(`Expected 10 gold expenses, found ${goldExpenses1.length}`);
    }

    // 3. Second run must add 0 duplicate rows (idempotency)
    console.log('3. Running second schedule post for the same window (verifying idempotency)...');
    const postRes2 = await postDueSchedules('2026-03-10');
    console.log(`✓ Second run posted count: ${postRes2.postedCount} (Expected: 0)`);
    const goldExpenses2 = await db
      .select()
      .from(expenses)
      .where(eq(expenses.scheduleId, goldId));
    console.log(`✓ Rows after second run: ${goldExpenses2.length} (Zero duplicates added)`);
    if (goldExpenses2.length !== 10) {
      throw new Error(`Idempotency violated: count changed to ${goldExpenses2.length}`);
    }

    // 4. Create Netflix Schedule with anchor date 31st January via POST /api/schedules
    console.log('\n4. Creating Netflix schedule with 31st anchor via POST /api/schedules...');
    const netflixPayload = {
      name: 'PROVE_Netflix',
      kind: 'subscription',
      category: 'Subscriptions',
      amount_paise: 64900, // ₹649
      frequency: 'monthly',
      anchor_date: '2026-01-31',
      start_date: '2026-01-01',
      end_date: '2026-02-28',
      active: true,
    };

    const netflixRes = await fetch(`${BASE_URL}/api/schedules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(netflixPayload),
    });
    if (!netflixRes.ok) throw new Error(`Failed to create Netflix schedule: ${await netflixRes.text()}`);
    const netflixData = await netflixRes.json();
    const netflixId = netflixData.schedule.id;
    console.log(`✓ Created Netflix schedule (ID: ${netflixId})`);

    // Post through February 2026
    console.log('5. Posting Netflix schedule through 2026-02-28...');
    await postDueSchedules('2026-02-28');
    const netflixExpenses = await db
      .select()
      .from(expenses)
      .where(eq(expenses.scheduleId, netflixId));
    const dates = netflixExpenses.map((e) => e.spentOn).sort();
    console.log(`✓ Netflix posted dates: ${dates.join(', ')} (Expected: 2026-01-31, 2026-02-28 clamped)`);
    if (!dates.includes('2026-01-31') || !dates.includes('2026-02-28')) {
      throw new Error(`Netflix clamping failed. Found dates: ${dates.join(', ')}`);
    }

    // 6. Verify scheduled rows are NOT flagged as anomalies by the engine
    console.log('\n6. Running engine analysis and checking that scheduled rows are never flagged as anomalies...');
    const engineOutput = await recomputeAndPersistEngine('2026-03-10');
    const flaggedIds = new Set(engineOutput.transactionAnomalies.map((a) => a.expenseId));
    const goldFlagged = goldExpenses1.some((e) => flaggedIds.has(e.id));
    const netflixFlagged = netflixExpenses.some((e) => flaggedIds.has(e.id));
    console.log(`✓ Gold schedule flagged as anomaly? ${goldFlagged ? 'YES (FAIL)' : 'NO (CORRECT)'}`);
    console.log(`✓ Netflix schedule flagged as anomaly? ${netflixFlagged ? 'YES (FAIL)' : 'NO (CORRECT)'}`);
    if (goldFlagged || netflixFlagged) {
      throw new Error('Scheduled expenses were improperly flagged as anomalies!');
    }

    // 7. Verify Day Closures: 10 logged, 1 no_spend, 4 skipped
    console.log('\n7. Recording Day Closures via POST /api/day-closures...');
    for (let i = 1; i <= 10; i++) {
      const d = `2026-03-${String(i).padStart(2, '0')}`;
      await fetch(`${BASE_URL}/api/day-closures`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ day: d, status: 'logged' }),
      });
    }
    await fetch(`${BASE_URL}/api/day-closures`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ day: '2026-03-11', status: 'no_spend' }),
    });
    for (let i = 12; i <= 15; i++) {
      const d = `2026-03-${String(i).padStart(2, '0')}`;
      await fetch(`${BASE_URL}/api/day-closures`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ day: d, status: 'skipped' }),
      });
    }

    const recomputeWithClosures = await recomputeAndPersistEngine('2026-03-15');
    console.log(
      `✓ Learning distinct days count: ${recomputeWithClosures.learning.distinctDaysCount} (Expected: 11; skipped 4 days excluded)`
    );
    if (recomputeWithClosures.learning.distinctDaysCount !== 11) {
      throw new Error(
        `Day closure exclusion failed: expected 11, got ${recomputeWithClosures.learning.distinctDaysCount}`
      );
    }

    // 8. Test Data Safety: GET /api/export
    console.log('\n8. Testing Data Safety export via GET /api/export...');
    const exportRes = await fetch(`${BASE_URL}/api/export`, {
      headers: { Cookie: authCookie },
    });
    if (!exportRes.ok) {
      throw new Error(`Export failed: ${exportRes.status}`);
    }
    const contentType = exportRes.headers.get('content-type') || '';
    const disposition = exportRes.headers.get('content-disposition') || '';
    const csvBody = await exportRes.text();

    console.log(`✓ Content-Type: ${contentType}`);
    console.log(`✓ Content-Disposition: ${disposition}`);
    console.log(`✓ CSV contains # EXPENSES? ${csvBody.includes('# EXPENSES')}`);
    console.log(`✓ CSV contains # SCHEDULES? ${csvBody.includes('# SCHEDULES')}`);
    console.log(`✓ CSV contains PROVE_DailyGold? ${csvBody.includes('PROVE_DailyGold')}`);
    console.log(`✓ CSV contains PROVE_Netflix? ${csvBody.includes('PROVE_Netflix')}`);

    if (
      !csvBody.includes('# EXPENSES') ||
      !csvBody.includes('# SCHEDULES') ||
      !csvBody.includes('PROVE_DailyGold')
    ) {
      throw new Error('Export CSV did not contain expected sections or data!');
    }

    // 9. Clean up test data
    console.log('\n9. Cleaning up test data from dev database...');
    await db.delete(expenses).where(sql`merchant LIKE 'PROVE_%'`);
    await db.delete(schedules).where(sql`name LIKE 'PROVE_%'`);
    await db.delete(dayClosures).where(sql`day::text LIKE '2026-03-%'`);
    console.log('✓ Test data cleaned up successfully.');

    console.log('\n=== ALL PROVE ASSERTIONS PASSED SUCCESSFULLY ===');
  } catch (err) {
    console.error('\nVerification failed with error:', err);
    // Cleanup on failure
    await db.delete(expenses).where(sql`merchant LIKE 'PROVE_%'`);
    await db.delete(schedules).where(sql`name LIKE 'PROVE_%'`);
    await db.delete(dayClosures).where(sql`day::text LIKE '2026-03-%'`);
    process.exit(1);
  }
}

main();
