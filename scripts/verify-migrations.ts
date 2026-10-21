import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

interface MigrationFile {
  name: string;
  filePath: string;
}

function getMigrationFiles(): MigrationFile[] {
  const drizzleDir = path.resolve(process.cwd(), 'drizzle');
  const files = fs.readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  return files.map((f) => ({
    name: f,
    filePath: path.join(drizzleDir, f),
  }));
}

function parseSqlStatements(sqlContent: string, targetSchema: string): string[] {
  // Replace "public". with "${targetSchema}".
  const adjustedSql = sqlContent.replace(/"public"\./g, `"${targetSchema}".`);
  return adjustedSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function runStatements(pool: Pool, statements: string[]) {
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

async function main() {
  console.log('================================================================');
  console.log('             SPENDCOACH MIGRATION VERIFICATION                  ');
  console.log('================================================================\n');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is missing in environment.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const migrations = getMigrationFiles();
  console.log(`Discovered ${migrations.length} migration files:`);
  migrations.forEach((m, idx) => console.log(`  ${idx}. ${m.name}`));
  console.log('');

  try {
    // ========================================================================
    // PART A: Apply migrations 0000..0004 to a fresh empty database/schema
    // ========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PART A: Verifying 0000..0004 on a fresh empty schema');
    console.log('----------------------------------------------------------------');
    const freshSchema = `mig_verify_fresh_${Date.now()}`;
    await pool.query(`CREATE SCHEMA "${freshSchema}"`);
    await pool.query(`SET search_path TO "${freshSchema}", public`);

    for (const m of migrations) {
      console.log(`  Applying ${m.name} to fresh schema...`);
      const sqlContent = fs.readFileSync(m.filePath, 'utf-8');
      const statements = parseSqlStatements(sqlContent, freshSchema);
      await runStatements(pool, statements);
    }
    console.log('  All migrations applied successfully.');

    // Verify all expected tables exist in freshSchema
    const tableRes = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name;`,
      [freshSchema]
    );
    const tableNames = tableRes.rows.map((r) => r.table_name);
    console.log(`  Created Tables: ${tableNames.join(', ')}`);

    const expectedTables = [
      'budgets',
      'day_closures',
      'experiments',
      'expenses',
      'insight_log',
      'login_attempts',
      'reviews',
      'schedule_price_history',
      'schedules',
    ];

    for (const expected of expectedTables) {
      if (!tableNames.includes(expected)) {
        throw new Error(`Missing expected table: ${expected}`);
      }
    }
    console.log('  [PASS] All expected tables created.');

    // Verify composite primary key on reviews table
    const pkRes = await pool.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1
         AND tc.table_name = 'reviews'
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position;`,
      [freshSchema]
    );
    const pkColumns = pkRes.rows.map((r) => r.column_name);
    console.log(`  Reviews PK columns: [${pkColumns.join(', ')}]`);
    if (pkColumns.join(',') !== 'period_type,review_date') {
      throw new Error(`Expected reviews PK to be (period_type, review_date), got: ${pkColumns.join(',')}`);
    }
    console.log('  [PASS] Composite PK (period_type, review_date) confirmed on reviews table.');

    // Clean up fresh schema
    await pool.query(`DROP SCHEMA "${freshSchema}" CASCADE`);
    console.log('  Fresh schema cleaned up.\n');

    // ========================================================================
    // PART B: Apply 0000..0003, seed legacy data, apply 0004, confirm reviews survive
    // ========================================================================
    console.log('----------------------------------------------------------------');
    console.log('PART B: Upgrade Migration: 0000..0003 -> Seed Legacy -> 0004');
    console.log('----------------------------------------------------------------');
    const upgradeSchema = `mig_verify_upgrade_${Date.now()}`;
    await pool.query(`CREATE SCHEMA "${upgradeSchema}"`);
    await pool.query(`SET search_path TO "${upgradeSchema}", public`);

    const pre0004Migrations = migrations.filter((m) => !m.name.startsWith('0004'));
    const migration0004 = migrations.find((m) => m.name.startsWith('0004'));

    if (!migration0004) {
      throw new Error('Migration 0004 not found!');
    }

    for (const m of pre0004Migrations) {
      console.log(`  Applying pre-0004: ${m.name}...`);
      const sqlContent = fs.readFileSync(m.filePath, 'utf-8');
      const statements = parseSqlStatements(sqlContent, upgradeSchema);
      await runStatements(pool, statements);
    }

    // Seed pre-existing legacy reviews rows (WITHOUT period_type column, as per schema 0000..0003)
    console.log('  Seeding pre-0004 legacy reviews rows...');
    await pool.query(`
      INSERT INTO "${upgradeSchema}"."reviews" (review_date, stats_json, advice_json, source, created_at)
      VALUES
        ('2026-10-15', '{"spent": 125000}', '{"headline": "Legacy Review Oct 15"}', 'llm', NOW() - INTERVAL '2 days'),
        ('2026-10-16', '{"spent": 84000}', '{"headline": "Legacy Review Oct 16"}', 'fallback', NOW() - INTERVAL '1 day');
    `);

    // Verify row count before 0004
    const countBefore = await pool.query(`SELECT COUNT(*)::int as count FROM "${upgradeSchema}"."reviews"`);
    console.log(`  Legacy reviews row count before 0004: ${countBefore.rows[0].count}`);

    // Apply migration 0004
    console.log(`  Applying ${migration0004.name}...`);
    const sql0004 = fs.readFileSync(migration0004.filePath, 'utf-8');
    const statements0004 = parseSqlStatements(sql0004, upgradeSchema);
    await runStatements(pool, statements0004);
    console.log('  Migration 0004 applied successfully.');

    // Confirm existing reviews rows survived with period_type='daily'
    const reviewsAfter = await pool.query(
      `SELECT period_type, review_date::text, advice_json, source FROM "${upgradeSchema}"."reviews" ORDER BY review_date;`
    );
    console.log(`  Reviews row count after 0004: ${reviewsAfter.rows.length}`);

    if (reviewsAfter.rows.length !== 2) {
      throw new Error(`Expected 2 reviews to survive, found ${reviewsAfter.rows.length}`);
    }

    for (const r of reviewsAfter.rows) {
      console.log(`    • Date: ${r.review_date} | period_type: "${r.period_type}" | Source: ${r.source} | Headline: ${r.advice_json?.headline}`);
      if (r.period_type !== 'daily') {
        throw new Error(`Expected period_type to default to 'daily', got: ${r.period_type}`);
      }
    }
    console.log('  [PASS] Existing reviews rows survived intact with period_type="daily".');

    // Confirm composite primary key works: insert weekly review on the same date (2026-10-15) without collision
    console.log('  Verifying composite PK allows weekly review on same date (2026-10-15)...');
    await pool.query(`
      INSERT INTO "${upgradeSchema}"."reviews" (period_type, review_date, stats_json, advice_json, source, created_at)
      VALUES ('weekly', '2026-10-15', '{"weekly": true}', '{"headline": "Weekly Review Oct 15"}', 'llm', NOW());
    `);
    const countWithWeekly = await pool.query(`SELECT COUNT(*)::int as count FROM "${upgradeSchema}"."reviews"`);
    console.log(`  Total reviews after inserting weekly review: ${countWithWeekly.rows[0].count}`);
    if (countWithWeekly.rows[0].count !== 3) {
      throw new Error('Failed to insert weekly review with same date under composite PK');
    }
    console.log('  [PASS] Composite PK allows coexistence of daily and weekly reviews on identical dates.');

    // Clean up upgrade schema
    await pool.query(`DROP SCHEMA "${upgradeSchema}" CASCADE`);
    console.log('  Upgrade schema cleaned up.\n');

    console.log('================================================================');
    console.log('        MIGRATION VERIFICATION COMPLETED SUCCESSFULLY           ');
    console.log('================================================================');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration verification failed:', err);
  process.exit(1);
});
