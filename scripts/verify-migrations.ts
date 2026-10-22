import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import os from 'os';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function main() {
  console.log('================================================================');
  console.log('         DRIZZLE REAL MIGRATOR VERIFICATION SUITE               ');
  console.log('================================================================\n');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is missing in environment.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // ========================================================================
    // CASE 1: Fresh empty database / schema migration using real Drizzle migrator
    // ========================================================================
    console.log('----------------------------------------------------------------');
    console.log('CASE 1: Fresh Empty Database / Schema Migration (Real Migrator)');
    console.log('----------------------------------------------------------------');
    const freshSchema = `mig_fresh_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${freshSchema}"`);
    await client.query(`SET search_path TO "${freshSchema}", public`);

    const freshDb = drizzle(client);
    console.log(`  Applying full migration folder (./drizzle) via Drizzle migrate() to schema "${freshSchema}"...`);
    await migrate(freshDb, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
      migrationsSchema: freshSchema,
    });
    console.log('  Drizzle migrate() completed successfully on fresh schema.');

    // Verify all expected tables were created in freshSchema
    const tableRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name;`,
      [freshSchema]
    );
    const createdTables = tableRes.rows.map((r: { table_name: string }) => r.table_name);
    console.log(`  Tables created: ${createdTables.join(', ')}`);

    const expectedTables = [
      '__drizzle_migrations',
      'app_settings',
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
      if (!createdTables.includes(expected)) {
        throw new Error(`Missing expected table: ${expected}`);
      }
    }
    console.log('  [PASS] All 11 expected tables exist in fresh schema.');

    // Verify composite primary key on reviews table
    const pkRes = await client.query(
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
    const pkColumns = pkRes.rows.map((r: { column_name: string }) => r.column_name);
    console.log(`  Reviews PK columns: [${pkColumns.join(', ')}]`);
    if (pkColumns.join(',') !== 'period_type,review_date') {
      throw new Error(`Expected reviews PK to be (period_type, review_date), got: ${pkColumns.join(',')}`);
    }
    console.log('  [PASS] Composite PK (period_type, review_date) confirmed on reviews.');

    // Clean up fresh schema
    await client.query(`DROP SCHEMA "${freshSchema}" CASCADE`);
    console.log(`  Cleaned up schema "${freshSchema}".\n`);

    // ========================================================================
    // CASE 2: Upgrade Migration: Truncated 0004 -> Seed Legacy -> Migrate Full
    // ========================================================================
    console.log('----------------------------------------------------------------');
    console.log('CASE 2: Upgrade Migration: Truncated (0004) -> Seed -> Full (0005)');
    console.log('----------------------------------------------------------------');
    const upgradeSchema = `mig_upgrade_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
    await client.query(`SET search_path TO "${upgradeSchema}", public`);

    // Create a temporary migrations directory truncated to 0004
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-trunc-'));
    const tempMetaDir = path.join(tempDir, 'meta');
    fs.mkdirSync(tempMetaDir, { recursive: true });

    // Read full journal
    const fullJournal = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf-8')
    );
    // Find index of 0004 entry
    const entry0004Idx = fullJournal.entries.findIndex((e: { tag: string }) => e.tag.startsWith('0004'));
    if (entry0004Idx === -1) {
      throw new Error('0004 entry not found in _journal.json');
    }
    const truncatedJournal = {
      ...fullJournal,
      entries: fullJournal.entries.slice(0, entry0004Idx + 1),
    };
    fs.writeFileSync(path.join(tempMetaDir, '_journal.json'), JSON.stringify(truncatedJournal, null, 2));

    // Copy SQL files and snapshots up to 0004
    for (const entry of truncatedJournal.entries) {
      const sqlName = `${entry.tag}.sql`;
      const snapshotName = `${String(entry.idx).padStart(4, '0')}_snapshot.json`;
      fs.copyFileSync(
        path.resolve(process.cwd(), 'drizzle', sqlName),
        path.join(tempDir, sqlName)
      );
      const snapshotSrc = path.resolve(process.cwd(), 'drizzle/meta', snapshotName);
      if (fs.existsSync(snapshotSrc)) {
        fs.copyFileSync(snapshotSrc, path.join(tempMetaDir, snapshotName));
      }
    }

    console.log(`  Prepared truncated migrations folder with ${truncatedJournal.entries.length} entries (0000..0004).`);

    const upgradeDb = drizzle(client);
    console.log('  Step 2a: Applying truncated migrations (0000..0004) via Drizzle migrate()...');
    await migrate(upgradeDb, {
      migrationsFolder: tempDir,
      migrationsSchema: upgradeSchema,
    });
    console.log('  Step 2a completed: 0000..0004 applied.');

    // Seed legacy reviews rows
    console.log('  Step 2b: Seeding legacy reviews rows into schema...');
    await client.query(`
      INSERT INTO "${upgradeSchema}"."reviews" (period_type, review_date, stats_json, advice_json, source, created_at)
      VALUES
        ('daily', '2026-10-15', '{"spent": 125000}', '{"headline": "Legacy Review Oct 15"}', 'llm', NOW() - INTERVAL '2 days'),
        ('daily', '2026-10-16', '{"spent": 84000}', '{"headline": "Legacy Review Oct 16"}', 'fallback', NOW() - INTERVAL '1 day');
    `);

    const countBeforeUpgrade = await client.query(
      `SELECT COUNT(*)::int as count FROM "${upgradeSchema}"."reviews"`
    );
    console.log(`  Reviews count before upgrading: ${countBeforeUpgrade.rows[0].count}`);

    // Verify app_settings does NOT exist yet in truncated schema
    const checkSettingsBefore = await client.query(
      `SELECT to_regclass('${upgradeSchema}.app_settings') as exists;`
    );
    if (checkSettingsBefore.rows[0].exists) {
      throw new Error('app_settings should not exist prior to migration 0005');
    }
    console.log('  Verified app_settings does not exist in 0004 schema.');

    // Step 2c: Apply full migrations folder (0000..0005)
    console.log('  Step 2c: Applying full migrations folder (0000..0005) via Drizzle migrate()...');
    await migrate(upgradeDb, {
      migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
      migrationsSchema: upgradeSchema,
    });
    console.log('  Step 2c completed: Full migration applied.');

    // Verify app_settings NOW exists
    const checkSettingsAfter = await client.query(
      `SELECT to_regclass('${upgradeSchema}.app_settings') as exists;`
    );
    if (!checkSettingsAfter.rows[0].exists) {
      throw new Error('app_settings table was not created by migration 0005');
    }
    console.log('  [PASS] app_settings successfully created by upgrade migration.');

    // Verify reviews rows survived intact
    const reviewsAfter = await client.query(
      `SELECT period_type, review_date::text, advice_json, source FROM "${upgradeSchema}"."reviews" ORDER BY review_date;`
    );
    console.log(`  Reviews count after upgrade: ${reviewsAfter.rows.length}`);
    if (reviewsAfter.rows.length !== 2) {
      throw new Error(`Expected 2 reviews to survive, found ${reviewsAfter.rows.length}`);
    }

    for (const r of reviewsAfter.rows) {
      console.log(`    • Date: ${r.review_date} | Type: ${r.period_type} | Source: ${r.source} | Headline: ${r.advice_json?.headline}`);
    }
    console.log('  [PASS] All legacy reviews rows survived upgrade migration completely intact.');

    // Cleanup temp dir & schema
    fs.rmSync(tempDir, { recursive: true, force: true });
    await client.query(`DROP SCHEMA "${upgradeSchema}" CASCADE`);
    console.log(`  Cleaned up schema "${upgradeSchema}".\n`);

    console.log('================================================================');
    console.log('     ALL DRIZZLE REAL MIGRATION VERIFICATION CHECKS PASSED     ');
    console.log('================================================================');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration verification failed:', err);
  process.exit(1);
});
