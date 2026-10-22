import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import fs from 'fs';
import path from 'path';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';
import { validateEnvConfig } from '../src/lib/env';

interface CheckResult {
  category: string;
  item: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

async function runPreflight() {
  const isProdCheck = process.argv.includes('--prod');

  console.log('================================================================');
  console.log(`       SPENDCOACH PREFLIGHT CHECK (${isProdCheck ? 'PRODUCTION MODE' : 'STANDARD MODE'})`);
  console.log('================================================================\n');

  const results: CheckResult[] = [];

  // 1. Environment Variable & Secret Strength Checks
  // NOTE: Per security rules, never print values or lengths of secrets.
  const passcode = process.env.APP_PASSCODE || process.env.PASSCODE || '';
  const sessionSecret = process.env.SESSION_SECRET || '';
  const cronSecret = process.env.CRON_SECRET || '';
  const dbUrl = process.env.DATABASE_URL || '';
  const groqApiKey = process.env.GROQ_API_KEY?.trim() || '';
  const baseUrl = process.env.LLM_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL?.trim() || 'llama-3.3-70b-versatile';

  const weakSet = new Set(['1234', '123456', 'password', 'passcode', 'spendcoach']);

  if (isProdCheck) {
    // Run core production env validation from src/lib/env.ts
    let envPass = true;
    try {
      validateEnvConfig(process.env, true);
    } catch {
      envPass = false;
    }

    // Individual production checks (Printing only PASS/FAIL, never values or lengths)
    // APP_PASSCODE: >= 10 chars, not weak
    if (passcode.length >= 10 && !weakSet.has(passcode.toLowerCase())) {
      results.push({ category: 'Environment', item: 'APP_PASSCODE strength', status: 'PASS', details: 'Acceptable production strength' });
    } else {
      results.push({ category: 'Environment', item: 'APP_PASSCODE strength', status: 'FAIL', details: 'Fails production requirements' });
    }

    // SESSION_SECRET: >= 32 chars, not containing "example"
    if (sessionSecret.length >= 32 && !/example/i.test(sessionSecret)) {
      results.push({ category: 'Environment', item: 'SESSION_SECRET strength', status: 'PASS', details: 'Acceptable production strength' });
    } else {
      results.push({ category: 'Environment', item: 'SESSION_SECRET strength', status: 'FAIL', details: 'Fails production requirements' });
    }

    // CRON_SECRET: >= 32 chars, not containing "example"
    if (cronSecret.length >= 32 && !/example/i.test(cronSecret)) {
      results.push({ category: 'Environment', item: 'CRON_SECRET strength', status: 'PASS', details: 'Acceptable production strength' });
    } else {
      results.push({ category: 'Environment', item: 'CRON_SECRET strength', status: 'FAIL', details: 'Fails production requirements' });
    }

    // DATABASE_URL
    if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
      results.push({ category: 'Environment', item: 'DATABASE_URL format', status: 'PASS', details: 'Valid PostgreSQL connection URI scheme' });
    } else {
      results.push({ category: 'Environment', item: 'DATABASE_URL format', status: 'FAIL', details: 'Missing or invalid URI scheme' });
    }

    // GROQ_API_KEY
    if (groqApiKey.length >= 16 && !/placeholder|example/i.test(groqApiKey)) {
      results.push({ category: 'Environment', item: 'GROQ_API_KEY presence', status: 'PASS', details: 'Key configured' });
    } else {
      results.push({ category: 'Environment', item: 'GROQ_API_KEY presence', status: 'FAIL', details: 'Missing or invalid API key' });
    }

    // LLM_BASE_URL
    if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
      results.push({ category: 'Environment', item: 'LLM_BASE_URL format', status: 'PASS', details: 'Valid HTTP/HTTPS endpoint' });
    } else {
      results.push({ category: 'Environment', item: 'LLM_BASE_URL format', status: 'FAIL', details: 'Invalid URL format' });
    }

    // LLM_MODEL
    if (model.length > 0) {
      results.push({ category: 'Environment', item: 'LLM_MODEL presence', status: 'PASS', details: 'Model name specified' });
    } else {
      results.push({ category: 'Environment', item: 'LLM_MODEL presence', status: 'FAIL', details: 'Model name missing' });
    }

    // Validate overall env validation consistency
    if (!envPass) {
      results.push({ category: 'Environment', item: 'Production Env Validator', status: 'FAIL', details: 'Failed src/lib/env.ts validateEnvConfig' });
    }
  } else {
    // Standard preflight check
    if (passcode.length >= 4) {
      results.push({ category: 'Environment', item: 'APP_PASSCODE format', status: 'PASS', details: 'Present and meets development minimum' });
    } else {
      results.push({ category: 'Environment', item: 'APP_PASSCODE format', status: 'FAIL', details: 'Missing or too short' });
    }

    if (sessionSecret.length >= 32) {
      results.push({ category: 'Environment', item: 'SESSION_SECRET length', status: 'PASS', details: 'Meets minimum requirement' });
    } else {
      results.push({ category: 'Environment', item: 'SESSION_SECRET length', status: 'FAIL', details: 'Insufficient length' });
    }

    if (cronSecret.length >= 8) {
      results.push({ category: 'Environment', item: 'CRON_SECRET presence', status: 'PASS', details: 'Configured and non-empty' });
    } else {
      results.push({ category: 'Environment', item: 'CRON_SECRET presence', status: 'FAIL', details: 'Missing or too short' });
    }

    if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
      results.push({ category: 'Environment', item: 'DATABASE_URL scheme', status: 'PASS', details: 'Valid PostgreSQL connection URI scheme' });
    } else {
      results.push({ category: 'Environment', item: 'DATABASE_URL scheme', status: 'FAIL', details: 'Must start with postgresql:// or postgres://' });
    }
  }

  // 2. Database Connection & Real Migration Journal Check
  try {
    const ping = await db.execute(sql`SELECT 1 as ping`);
    if (ping) {
      results.push({ category: 'Database', item: 'Database Connection', status: 'PASS', details: 'Successfully connected and executed query' });
    }

    // Read Journal
    const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
    if (!fs.existsSync(journalPath)) {
      throw new Error('drizzle/meta/_journal.json not found');
    }
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const journalEntries: Array<{ idx: number; when: number; tag: string }> = journal.entries || [];

    // Query recorded migrations in database
    const migResult = await db.execute(
      sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;`
    );
    const dbRows = (migResult.rows || []) as Array<{ id: number; hash: string; created_at: string }>;

    const dbWhens = new Set(dbRows.map((r) => r.created_at.toString()));
    const missingInDb: string[] = [];

    for (const entry of journalEntries) {
      if (!dbWhens.has(entry.when.toString())) {
        missingInDb.push(entry.tag);
      }
    }

    if (missingInDb.length === 0 && dbRows.length === journalEntries.length) {
      results.push({
        category: 'Database',
        item: 'Migration Journal Match',
        status: 'PASS',
        details: `All ${journalEntries.length} journal migrations match database records exactly`,
      });
    } else {
      results.push({
        category: 'Database',
        item: 'Migration Journal Match',
        status: 'FAIL',
        details: `Mismatch between journal (${journalEntries.length}) and DB records (${dbRows.length}). Missing: ${missingInDb.join(', ') || 'None'}`,
      });
    }

    // Also verify that all expected application tables are present
    const tablesResult = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public';
    `);
    const existingTables = new Set(
      (tablesResult.rows as Array<{ table_name: string }>).map((r) => r.table_name)
    );
    const requiredTables = [
      'expenses',
      'day_closures',
      'schedules',
      'budgets',
      'reviews',
      'insight_log',
      'experiments',
      'app_settings',
    ];
    const missingTables = requiredTables.filter((t) => !existingTables.has(t));
    if (missingTables.length === 0) {
      results.push({
        category: 'Database',
        item: 'Required Core Tables',
        status: 'PASS',
        details: `All ${requiredTables.length} core tables present in public schema`,
      });
    } else {
      results.push({
        category: 'Database',
        item: 'Required Core Tables',
        status: 'FAIL',
        details: `Missing tables: ${missingTables.join(', ')}`,
      });
    }
  } catch (err) {
    results.push({
      category: 'Database',
      item: 'Database / Migration Verification',
      status: 'FAIL',
      details: `Database error: ${(err as Error).message}`,
    });
  }

  // 3. Groq Model Validation
  if (!groqApiKey || groqApiKey.length < 8) {
    results.push({
      category: 'LLM Service',
      item: 'GROQ_API_KEY validity',
      status: isProdCheck ? 'FAIL' : 'WARN',
      details: 'Key empty or placeholder; deterministic engine fallback active',
    });
  } else {
    try {
      const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
      const modelsRes = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
        },
        signal: AbortSignal.timeout(6000),
      });

      if (modelsRes.ok) {
        const data = await modelsRes.json();
        const modelList: string[] = Array.isArray(data?.data)
          ? data.data.map((m: { id: string }) => m.id)
          : [];

        if (modelList.includes(model)) {
          results.push({
            category: 'LLM Service',
            item: 'GROQ_API_KEY validity',
            status: 'PASS',
            details: 'API key authenticated successfully',
          });
          results.push({
            category: 'LLM Service',
            item: 'Model Availability',
            status: 'PASS',
            details: `Model '${model}' verified available on provider`,
          });
        } else {
          results.push({
            category: 'LLM Service',
            item: 'Model Availability',
            status: 'WARN',
            details: `Key valid, but '${model}' not listed among provider models`,
          });
        }
      } else {
        results.push({
          category: 'LLM Service',
          item: 'GROQ_API_KEY validity',
          status: isProdCheck ? 'FAIL' : 'WARN',
          details: `Provider responded status ${modelsRes.status}`,
        });
      }
    } catch (err) {
      results.push({
        category: 'LLM Service',
        item: 'GROQ_API_KEY validity',
        status: isProdCheck ? 'FAIL' : 'WARN',
        details: `Network/timeout contacting provider: ${(err as Error).message}`,
      });
    }
  }

  // 4. Output Summary Table
  console.log('| Category     | Check Item                    | Status | Details');
  console.log('|--------------|-------------------------------|--------|-------------------------------------------------------');
  for (const r of results) {
    const cat = r.category.padEnd(12);
    const item = r.item.padEnd(29);
    const st = r.status.padEnd(6);
    console.log(`| ${cat} | ${item} | ${st} | ${r.details}`);
  }
  console.log('');

  const hasFails = results.some((r) => r.status === 'FAIL');
  if (hasFails) {
    console.log('RESULT: PREFLIGHT FAILED - Fix items marked FAIL before deployment.');
    process.exit(1);
  } else {
    console.log('RESULT: PREFLIGHT PASSED - All checks satisfied.');
    process.exit(0);
  }
}

runPreflight().catch((err) => {
  console.error('Fatal preflight error:', err);
  process.exit(1);
});
