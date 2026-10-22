import { config } from 'dotenv';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

config({ path: '.env.local' });
config();

interface CheckResult {
  category: string;
  item: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
}

async function runPreflight() {
  console.log('================================================================');
  console.log('             SPENDCOACH PRODUCTION PREFLIGHT CHECK              ');
  console.log('================================================================');

  const results: CheckResult[] = [];

  // 1. Environment Variable Format Checks
  const passcode = process.env.APP_PASSCODE || process.env.PASSCODE || '';
  if (/^\d{4,8}$/.test(passcode) || passcode.length >= 4) {
    results.push({
      category: 'Environment',
      item: 'APP_PASSCODE format',
      status: 'PASS',
      details: `Valid passcode (${passcode.length} characters)`,
    });
  } else {
    results.push({
      category: 'Environment',
      item: 'APP_PASSCODE format',
      status: 'FAIL',
      details: 'Must be at least 4 characters (4-8 digits or strong passphrase)',
    });
  }

  const sessionSecret = process.env.SESSION_SECRET || '';
  if (sessionSecret.length >= 32) {
    results.push({
      category: 'Environment',
      item: 'SESSION_SECRET length',
      status: 'PASS',
      details: `Sufficient entropy (${sessionSecret.length} chars >= 32)`,
    });
  } else {
    results.push({
      category: 'Environment',
      item: 'SESSION_SECRET length',
      status: 'FAIL',
      details: `Too short (${sessionSecret.length} chars, minimum 32 required)`,
    });
  }

  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret.trim().length >= 8) {
    results.push({
      category: 'Environment',
      item: 'CRON_SECRET presence',
      status: 'PASS',
      details: 'Configured and non-empty',
    });
  } else {
    results.push({
      category: 'Environment',
      item: 'CRON_SECRET presence',
      status: 'FAIL',
      details: 'Missing or too short',
    });
  }

  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) {
    results.push({
      category: 'Environment',
      item: 'DATABASE_URL scheme',
      status: 'PASS',
      details: 'Valid PostgreSQL connection URI scheme',
    });
  } else {
    results.push({
      category: 'Environment',
      item: 'DATABASE_URL scheme',
      status: 'FAIL',
      details: 'Must start with postgresql:// or postgres://',
    });
  }

  // 2. Database Connection & Applied Migrations
  try {
    const ping = await db.execute(sql`SELECT 1 as ping`);
    if (ping) {
      results.push({
        category: 'Database',
        item: 'Database Connection',
        status: 'PASS',
        details: 'Successfully connected and executed query',
      });
    }

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
        item: 'Applied Schema & Migrations',
        status: 'PASS',
        details: `All ${requiredTables.length} core tables present and active`,
      });
    } else {
      results.push({
        category: 'Database',
        item: 'Applied Schema & Migrations',
        status: 'FAIL',
        details: `Missing tables: ${missingTables.join(', ')}`,
      });
    }
  } catch (err) {
    results.push({
      category: 'Database',
      item: 'Database Connection',
      status: 'FAIL',
      details: `Connection failed: ${(err as Error).message}`,
    });
  }

  // 3. Groq Model Validation
  const groqApiKey = process.env.GROQ_API_KEY?.trim() || '';
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

  if (!groqApiKey || groqApiKey.length < 8) {
    results.push({
      category: 'LLM Service',
      item: 'GROQ_API_KEY validity',
      status: 'WARN',
      details: 'Key empty or placeholder; deterministic engine fallback active',
    });
    results.push({
      category: 'LLM Service',
      item: 'Model Availability',
      status: 'WARN',
      details: `Model '${model}' cannot be verified without API key; fallback ready`,
    });
  } else {
    try {
      const modelsRes = await fetch(`${baseUrl}/models`, {
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
            details: `Key valid, but '${model}' not listed among ${modelList.length} provider models`,
          });
        }
      } else {
        results.push({
          category: 'LLM Service',
          item: 'GROQ_API_KEY validity',
          status: 'WARN',
          details: `Provider responded status ${modelsRes.status}: Invalid key or service down. Fallback will engage.`,
        });
      }
    } catch (err) {
      results.push({
        category: 'LLM Service',
        item: 'GROQ_API_KEY validity',
        status: 'WARN',
        details: `Network/timeout contacting provider: ${(err as Error).message}`,
      });
    }
  }

  // 4. Output Summary Table
  console.log('');
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
    console.log('RESULT: PREFLIGHT PASSED - Environment and services ready for deployment.');
    process.exit(0);
  }
}

runPreflight().catch((err) => {
  console.error('Fatal preflight error:', err);
  process.exit(1);
});
