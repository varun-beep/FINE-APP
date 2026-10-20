import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { db } from '../src/db';
import { expenses, budgets } from '../src/db/schema';
import { recomputeAndPersistEngine } from '../src/lib/engine/db';
import { getKolkataToday } from '../src/lib/date';
import { addDays } from '../src/lib/engine/math';

async function seedDemo() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production'
  ) {
    console.error('Refusing to run seed:demo: NODE_ENV is production or running on Vercel.');
    process.exit(1);
  }

  console.log('Seeding 90 days of realistic synthetic demo data...');

  const today = getKolkataToday(); // e.g. 2026-10-20
  const marker = '[SEED_DEMO]';

  const rows: {
    amountPaise: number;
    category: string;
    note: string;
    merchant: string;
    spentOn: string;
  }[] = [];

  // Helper for varied normal spend
  // 1. Food: 35 transactions across trailing 85 days (median ~₹250, range ₹220-₹280)
  for (let i = 1; i <= 35; i++) {
    const daysAgo = i * 2 + 3; // spreads across days 5 to 73
    const amt = 22000 + (i % 7) * 1000; // 22000 to 28000 paise
    const merchants = ['Swiggy', 'Zomato', 'Chaayos', 'Subway', 'Haldirams'];
    rows.push({
      amountPaise: amt,
      category: 'Food',
      merchant: merchants[i % merchants.length],
      note: `${marker} Regular meal`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // 2. Groceries: 15 normal transactions (median ~₹450, range ₹400-₹500)
  for (let i = 1; i <= 15; i++) {
    const daysAgo = i * 5 + 4;
    const amt = 40000 + (i % 6) * 2000; // 40000 to 50000 paise
    const merchants = ['Blinkit', 'Zepto', 'Nature Basket', 'BigBasket'];
    rows.push({
      amountPaise: amt,
      category: 'Groceries',
      merchant: merchants[i % merchants.length],
      note: `${marker} Weekly staples`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // 3. Transport: 15 normal transactions (median ~₹120, range ₹90-₹150)
  for (let i = 1; i <= 15; i++) {
    const daysAgo = i * 4 + 2;
    const amt = 9000 + (i % 7) * 1000;
    const merchants = ['Uber', 'Ola', 'Rapido', 'Namma Yatri'];
    rows.push({
      amountPaise: amt,
      category: 'Transport',
      merchant: merchants[i % merchants.length],
      note: `${marker} Commute ride`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // 4. Health: 10 normal transactions (median ~₹350, range ₹300-₹420)
  for (let i = 1; i <= 10; i++) {
    const daysAgo = i * 8 + 3;
    const amt = 30000 + (i % 7) * 2000;
    const merchants = ['Apollo Pharmacy', 'MedPlus', 'Pharmeasy', 'Wellness Forever'];
    rows.push({
      amountPaise: amt,
      category: 'Health',
      merchant: merchants[i % merchants.length],
      note: `${marker} Pharmacy items`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // 5. Entertainment: 10 normal transactions (median ~₹650, range ₹550-₹750, diverse merchants)
  const entDays = [5, 12, 19, 27, 36, 44, 53, 63, 72, 82];
  const entMerchants = [
    'PVR Cinemas',
    'BookMyShow',
    'SonyLIV',
    'Steam Games',
    'Bowling Alley',
    'Board Games Cafe',
    'Standup Comedy',
    'IMAX',
    'Gaming Arcade',
    'Museum Pass',
  ];
  for (let i = 0; i < entDays.length; i++) {
    const daysAgo = entDays[i];
    const amt = 55000 + (i % 5) * 5000; // 55000 to 75000 paise
    rows.push({
      amountPaise: amt,
      category: 'Entertainment',
      merchant: entMerchants[i],
      note: `${marker} Entertainment outing`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // 6. Shopping: 12 normal transactions (median ~₹650, range ₹450-₹850, diverse merchants)
  const shoppingDays = [3, 7, 12, 19, 23, 31, 39, 44, 52, 61, 70, 78];
  for (let i = 0; i < shoppingDays.length; i++) {
    const daysAgo = shoppingDays[i];
    const amt = 45000 + (i % 5) * 9000; // varying amounts
    const merchants = ['Zara', 'Decathlon', 'H&M', 'Ikea', 'Uniqlo', 'Nykaa'];
    rows.push({
      amountPaise: amt,
      category: 'Shopping',
      merchant: merchants[i % merchants.length],
      note: `${marker} Apparel and gear`,
      spentOn: addDays(today, -daysAgo),
    });
  }

  // ==============================================================
  // EXACTLY 2 PLANTED RECURRING CHARGES:
  // ==============================================================

  // Recurring 1: Netflix Premium Monthly Subscription (₹649 = 64900 paise, 30 days apart)
  // Normal for Entertainment (~₹650), so NOT an anomaly.
  rows.push({
    amountPaise: 64900,
    category: 'Entertainment',
    merchant: 'Netflix',
    note: `${marker} Monthly 4K streaming plan`,
    spentOn: addDays(today, -60),
  });
  rows.push({
    amountPaise: 64900,
    category: 'Entertainment',
    merchant: 'Netflix',
    note: `${marker} Monthly 4K streaming plan`,
    spentOn: addDays(today, -30),
  });
  rows.push({
    amountPaise: 64900,
    category: 'Entertainment',
    merchant: 'Netflix',
    note: `${marker} Monthly 4K streaming plan`,
    spentOn: today,
  });

  // Recurring 2: Country Delight Weekly Milk Delivery (~₹425 = 42000-43000 paise, 7 days apart)
  // Normal for Groceries (~₹450), so NOT an anomaly.
  rows.push({
    amountPaise: 42000,
    category: 'Groceries',
    merchant: 'Country Delight',
    note: `${marker} Weekly milk & farm produce`,
    spentOn: addDays(today, -21),
  });
  rows.push({
    amountPaise: 42500,
    category: 'Groceries',
    merchant: 'Country Delight',
    note: `${marker} Weekly milk & farm produce`,
    spentOn: addDays(today, -14),
  });
  rows.push({
    amountPaise: 42000,
    category: 'Groceries',
    merchant: 'Country Delight',
    note: `${marker} Weekly milk & farm produce`,
    spentOn: addDays(today, -7),
  });
  rows.push({
    amountPaise: 43000,
    category: 'Groceries',
    merchant: 'Country Delight',
    note: `${marker} Weekly milk & farm produce`,
    spentOn: today,
  });

  // ==============================================================
  // EXACTLY 3 PLANTED TRANSACTION ANOMALIES:
  // ==============================================================

  // Planted Anomaly 1: Food - Luxury 5-Star Dinner (₹4,850 = 485000 paise vs usual median ₹250)
  rows.push({
    amountPaise: 485000,
    category: 'Food',
    merchant: 'The Leela Palace',
    note: `${marker} Anniversary dinner with family`,
    spentOn: addDays(today, -6),
  });

  // Planted Anomaly 2: Shopping - Flagship iPad Pro Purchase (₹79,900 = 7990000 paise vs usual median ₹650)
  rows.push({
    amountPaise: 7990000,
    category: 'Shopping',
    merchant: 'Apple Store BKC',
    note: `${marker} New iPad Pro purchase`,
    spentOn: addDays(today, -15),
  });

  // Planted Anomaly 3: Health - Root Canal Surgery (₹14,500 = 1450000 paise vs usual median ₹350)
  rows.push({
    amountPaise: 1450000,
    category: 'Health',
    merchant: 'Apollo Dental Care',
    note: `${marker} Root canal surgery & crown`,
    spentOn: addDays(today, -28),
  });

  // Insert into DB
  for (const row of rows) {
    await db.insert(expenses).values({
      amountPaise: row.amountPaise,
      category: row.category,
      merchant: row.merchant,
      note: row.note,
      spentOn: row.spentOn,
    });
  }

  // Set sample monthly budgets
  await db
    .insert(budgets)
    .values({
      category: 'Food',
      monthlyLimitPaise: 1500000, // ₹15,000
    })
    .onConflictDoUpdate({
      target: budgets.category,
      set: { monthlyLimitPaise: 1500000 },
    });

  await db
    .insert(budgets)
    .values({
      category: 'Groceries',
      monthlyLimitPaise: 2000000, // ₹20,000
    })
    .onConflictDoUpdate({
      target: budgets.category,
      set: { monthlyLimitPaise: 2000000 },
    });

  console.log(`✓ Inserted ${rows.length} demo expenses.`);

  // Recompute and persist review
  const output = await recomputeAndPersistEngine(today);
  console.log('✓ Learning engine computed and review persisted.');
  console.log(`- Status: ${output.learning.status}`);
  console.log(`- Planted transaction anomalies detected: ${output.transactionAnomalies.length}`);
  console.log(`- Planted recurring items detected: ${output.recurring.length}`);
  process.exit(0);
}

seedDemo().catch((err) => {
  console.error('Seed demo failed:', err);
  process.exit(1);
});
