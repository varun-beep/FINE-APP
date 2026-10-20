import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { db } from '../src/db';
import { expenses, budgets, schedules, schedulePriceHistory, insightLog } from '../src/db/schema';

import { recomputeAndPersistEngine } from '../src/lib/engine/db';
import { getKolkataToday } from '../src/lib/date';
import { addDays } from '../src/lib/engine/math';
import { sql } from 'drizzle-orm';

async function seedDemo() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production'
  ) {
    console.error('Refusing to run seed:demo: NODE_ENV is production or running on Vercel.');
    process.exit(1);
  }

  console.log('Seeding 120 days of realistic synthetic demo data...');

  const today = getKolkataToday(); // e.g. 2026-10-20
  const marker = '[SEED_DEMO]';

  // 0. Clean prior demo data
  await db.delete(expenses).where(sql`note LIKE '%[SEED_DEMO]%' OR merchant LIKE '%[SEED_DEMO]%'`);
  await db.delete(schedules).where(sql`name LIKE '%[SEED_DEMO]%'`);
  await db.delete(insightLog);


  // ==============================================================
  // 1. SCHEDULES: Salary, Daily Gold, 4 OTT Subscriptions
  // ==============================================================
  console.log('Creating demo schedules (Salary, Daily Gold, 4 OTT Subscriptions)...');

  // 1.1 Salary Schedule (₹1,50,000 monthly on 1st)
  const [salary] = await db
    .insert(schedules)
    .values({
      name: 'Salary [SEED_DEMO]',
      kind: 'income',
      category: 'Income',
      amountPaise: 15000000,
      frequency: 'monthly',
      anchorDate: '2026-10-01',
      startDate: '2026-06-01',
      active: true,
    })
    .returning();

  await db.insert(schedulePriceHistory).values({
    scheduleId: salary.id,
    amountPaise: 15000000,
    effectiveFrom: '2026-06-01',
  });

  // 1.2 Daily Gold Schedule (₹500 daily)
  const [gold] = await db
    .insert(schedules)
    .values({
      name: 'Daily Gold [SEED_DEMO]',
      kind: 'investment',
      category: 'Investment',
      amountPaise: 50000,
      frequency: 'daily',
      anchorDate: '2026-10-01',
      startDate: '2026-06-01',
      active: true,
    })
    .returning();

  await db.insert(schedulePriceHistory).values({
    scheduleId: gold.id,
    amountPaise: 50000,
    effectiveFrom: '2026-06-01',
  });

  // 1.3 4 OTT Subscriptions
  const ottConfigs = [
    { name: 'Netflix Premium [SEED_DEMO]', amountPaise: 64900, frequency: 'monthly' as const, anchorDate: '2026-10-15' },
    { name: 'Prime Video [SEED_DEMO]', amountPaise: 149900, frequency: 'yearly' as const, anchorDate: '2026-10-05' },
    { name: 'Disney+ Hotstar [SEED_DEMO]', amountPaise: 29900, frequency: 'monthly' as const, anchorDate: '2026-10-20' },
    { name: 'Spotify Premium [SEED_DEMO]', amountPaise: 17900, frequency: 'monthly' as const, anchorDate: '2026-10-10' },
  ];

  for (const ott of ottConfigs) {
    const [sub] = await db
      .insert(schedules)
      .values({
        name: ott.name,
        kind: 'subscription',
        category: 'Entertainment',
        amountPaise: ott.amountPaise,
        frequency: ott.frequency,
        anchorDate: ott.anchorDate,
        startDate: '2026-06-01',
        active: true,
      })
      .returning();

    await db.insert(schedulePriceHistory).values({
      scheduleId: sub.id,
      amountPaise: ott.amountPaise,
      effectiveFrom: '2026-06-01',
    });
  }

  // ==============================================================
  // 2. EXPENSES ACROSS 120 DAYS
  // ==============================================================
  const rows: {
    amountPaise: number;
    category: string;
    note: string;
    merchant: string;
    spentOn: string;
    oneOff?: boolean;
  }[] = [];

  // A. Baseline Food Spend with STEADY FOOD DRIFT (+50% over last 4 weeks):
  // Weeks 5 to 16 (days 29 to 115): 3 meals/week at ~₹250 (25,000 paise)
  for (let w = 4; w < 16; w++) {
    for (let t = 0; t < 3; t++) {
      const daysAgo = w * 7 + t * 2 + 1;
      rows.push({
        amountPaise: 24000 + (t % 3) * 1000, // ₹240 - ₹260
        category: 'Food',
        merchant: t % 2 === 0 ? 'Swiggy' : 'Zomato',
        note: `${marker} Regular dinner`,
        spentOn: addDays(today, -daysAgo),
      });
    }
  }
  // Weeks 1 to 4 (days 1 to 28): 3 meals/week at ~₹400 (40,000 paise) -> DRIFT!
  for (let w = 0; w < 4; w++) {
    for (let t = 0; t < 3; t++) {
      const daysAgo = w * 7 + t * 2 + 1;
      rows.push({
        amountPaise: 39000 + (t % 3) * 1500, // ₹390 - ₹420
        category: 'Food',
        merchant: t % 2 === 0 ? 'Swiggy' : 'Zomato',
        note: `${marker} Upgraded dining dinner`,
        spentOn: addDays(today, -daysAgo),
      });
    }
  }

  // B. Groceries: Regular staples across 120 days (~₹450, every 4 days)
  for (let i = 1; i <= 28; i++) {
    const daysAgo = i * 4 + 2;
    rows.push({
      amountPaise: 42000 + (i % 5) * 1500,
      category: 'Groceries',
      merchant: i % 2 === 0 ? 'Blinkit' : 'Zepto',
      note: `${marker} Weekly groceries`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // C. Transport: Commute across 120 days (~₹150, every 3 days)
  for (let i = 1; i <= 35; i++) {
    const daysAgo = i * 3 + 1;
    rows.push({
      amountPaise: 14000 + (i % 4) * 1000,
      category: 'Transport',
      merchant: i % 2 === 0 ? 'Uber' : 'Namma Yatri',
      note: `${marker} Commute ride`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // D. PAYDAY-WEEK BUMP:
  // On days 1 to 5 of July, August, September, October: extra discretionary shopping & dining (~₹4,500/day)
  const paydayMonths = ['2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of paydayMonths) {
    for (let d = 1; d <= 4; d++) {
      const dStr = `${m}-${String(d).padStart(2, '0')}`;
      if (dStr <= today) {
        rows.push({
          amountPaise: 450000, // ₹4,500
          category: 'Shopping',
          merchant: 'Retail Mall',
          note: `${marker} Post-payday shopping splurge`,
          spentOn: dStr,
        });
      }
    }
  }

  // E. ONE SMALL LEAK: Chaayos 20 visits in the last 30 days (₹120 median, total ₹2,400)
  for (let i = 1; i <= 20; i++) {
    rows.push({
      amountPaise: 12000, // ₹120
      category: 'Food',
      merchant: 'Chaayos',
      note: `${marker} Afternoon cutting chai and snacks`,
      spentOn: addDays(today, -i),
    });
  }

  // F. ONE PLANTED DUPLICATE: Today on Swiggy (₹450 twice)
  rows.push({
    amountPaise: 45000,
    category: 'Food',
    merchant: 'Swiggy',
    note: `${marker} Lunch delivery`,
    spentOn: today,
  });
  rows.push({
    amountPaise: 45000,
    category: 'Food',
    merchant: 'Swiggy',
    note: `${marker} Lunch delivery (Duplicate)`,
    spentOn: today,
  });

  // G. TWO GENUINE LARGE ONE-OFFS:
  // One-off 1: Apple Store Flagship iPad Pro (₹79,900) 15 days ago
  rows.push({
    amountPaise: 7990000,
    category: 'Shopping',
    merchant: 'Apple Store BKC',
    note: `${marker} New iPad Pro purchase`,
    spentOn: addDays(today, -15),
  });
  // One-off 2: Taj Luxury Weekend Resort (₹35,000) 38 days ago
  rows.push({
    amountPaise: 3500000,
    category: 'Shopping',
    merchant: 'Taj Holidays',
    note: `${marker} Family weekend anniversary stay`,
    spentOn: addDays(today, -38),
  });

  // H. ONE LUMPY-BUT-NORMAL MEDICAL BILL:
  // In Health (median ~₹1,500, natural dispersion ₹800 to ₹3,500):
  // Routine Health expenses:
  const healthDays = [8, 18, 28, 42, 58, 72, 88, 102];
  for (let i = 0; i < healthDays.length; i++) {
    rows.push({
      amountPaise: 120000 + (i % 5) * 30000, // ₹1,200 - ₹2,400
      category: 'Health',
      merchant: 'Apollo Pharmacy',
      note: `${marker} Prescription medicine`,
      spentOn: addDays(today, -healthDays[i]),
    });
  }
  // The lumpy-but-normal dental bill: ₹4,200 (420,000 paise) 18 days ago.
  // Because Health is recognized as lumpy and dispersion is wide, this must stay silent!
  rows.push({
    amountPaise: 420000,
    category: 'Health',
    merchant: 'Apollo Dental',
    note: `${marker} Dental filling & checkup`,
    spentOn: addDays(today, -18),
  });

  // Insert all expense rows
  console.log(`Inserting ${rows.length} demo expenses across 120 days...`);
  for (const row of rows) {
    await db.insert(expenses).values({
      amountPaise: row.amountPaise,
      category: row.category,
      merchant: row.merchant,
      note: row.note,
      spentOn: row.spentOn,
      oneOff: row.oneOff || false,
    });
  }

  // Set monthly budget limits
  await db
    .insert(budgets)
    .values({
      category: 'Food',
      monthlyLimitPaise: 2500000, // ₹25,000
    })
    .onConflictDoUpdate({
      target: budgets.category,
      set: { monthlyLimitPaise: 2500000 },
    });

  await db
    .insert(budgets)
    .values({
      category: 'Shopping',
      monthlyLimitPaise: 3000000, // ₹30,000
    })
    .onConflictDoUpdate({
      target: budgets.category,
      set: { monthlyLimitPaise: 3000000 },
    });

  console.log('✓ Seeded demo database with 120 days of data.');

  // Recompute engine snapshot
  const output = await recomputeAndPersistEngine(today);

  console.log('\n=== SEED DEMO RESULTS ===');
  console.log(`Evaluated At: ${output.evaluatedAt}`);
  console.log(`Coverage Days Closed: ${output.coverage?.daysClosed}`);
  console.log(`Coverage Weeks History: ${output.coverage?.weeksOfHistory}`);
  console.log(`Safe-to-Spend Daily Allowance: ₹${Math.round((output.allowance?.dailyAllowancePaise || 0) / 100)}`);
  console.log(`Ranked Surfaced Insights (${output.insights?.length || 0}):`);
  output.insights?.forEach((ins, idx) => {
    console.log(`  ${idx + 1}. [${ins.type.toUpperCase()}] ${ins.title} (Impact: ₹${Math.round(ins.impactPaise / 100)}, Score: ${ins.score || 'N/A'})`);
  });

  console.log(`\nFiltered Silent Flags (${output.silentFlags?.length || 0}):`);
  output.silentFlags?.forEach((flag, idx) => {
    console.log(`  ${idx + 1}. [SILENT] ${flag.title} - ${flag.reason}`);
  });

  process.exit(0);
}

seedDemo().catch((err) => {
  console.error('Seed demo failed:', err);
  process.exit(1);
});
