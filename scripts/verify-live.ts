import { config } from 'dotenv';
import sharp from 'sharp';

config({ path: '.env.local' });
config();

interface StepResult {
  step: string;
  passed: boolean;
  details: string;
}

async function verifyLive() {
  const targetUrl = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
  console.log('================================================================');
  console.log('             SPENDCOACH LIVE VERIFICATION SCRIPT                ');
  console.log('================================================================');
  console.log(`Target URL: ${targetUrl}\n`);

  const results: StepResult[] = [];
  let sessionCookie: string | null = null;

  // 1. /api/health
  try {
    const res = await fetch(`${targetUrl}/api/health`);
    if (res.status === 200) {
      const data = await res.json().catch(() => ({}));
      if (data.db === 'ok' || data.status === 'ok') {
        results.push({
          step: '1. Health Endpoint (/api/health)',
          passed: true,
          details: `Status 200 OK (db: ${data.db || data.status})`,
        });
      } else {
        results.push({
          step: '1. Health Endpoint (/api/health)',
          passed: false,
          details: `Status 200 but db status unexpected: ${JSON.stringify(data)}`,
        });
      }
    } else {
      results.push({
        step: '1. Health Endpoint (/api/health)',
        passed: false,
        details: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      });
    }
  } catch (err) {
    results.push({
      step: '1. Health Endpoint (/api/health)',
      passed: false,
      details: `Network error: ${(err as Error).message}`,
    });
  }

  // 2. /manifest.webmanifest
  try {
    const res = await fetch(`${targetUrl}/manifest.webmanifest`);
    if (res.ok) {
      const manifest = await res.json();
      const hasName = typeof manifest.name === 'string' && manifest.name.length > 0;
      const hasIcons = Array.isArray(manifest.icons) && manifest.icons.length > 0;
      const hasStartUrl = typeof manifest.start_url === 'string';
      const isStandalone = manifest.display === 'standalone';

      if (hasName && hasIcons && hasStartUrl && isStandalone) {
        results.push({
          step: '2. PWA Manifest (/manifest.webmanifest)',
          passed: true,
          details: `Valid PWA manifest (name: "${manifest.name}", display: ${manifest.display}, ${manifest.icons.length} icons)`,
        });
      } else {
        results.push({
          step: '2. PWA Manifest (/manifest.webmanifest)',
          passed: false,
          details: `Missing required PWA fields: name=${hasName}, icons=${hasIcons}, start_url=${hasStartUrl}, standalone=${isStandalone}`,
        });
      }
    } else {
      results.push({
        step: '2. PWA Manifest (/manifest.webmanifest)',
        passed: false,
        details: `HTTP ${res.status} returned`,
      });
    }
  } catch (err) {
    results.push({
      step: '2. PWA Manifest (/manifest.webmanifest)',
      passed: false,
      details: `Failed to fetch manifest: ${(err as Error).message}`,
    });
  }

  // 3. /apple-touch-icon.png
  try {
    const res = await fetch(`${targetUrl}/apple-touch-icon.png`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const metadata = await sharp(buf).metadata();
      const w = metadata.width || 0;
      const h = metadata.height || 0;
      if (w >= 180 && h >= 180) {
        results.push({
          step: '3. Apple Touch Icon (/apple-touch-icon.png)',
          passed: true,
          details: `Valid icon returned (${w}x${h} px >= 180x180)`,
        });
      } else {
        results.push({
          step: '3. Apple Touch Icon (/apple-touch-icon.png)',
          passed: false,
          details: `Icon too small: ${w}x${h} (minimum 180x180 required)`,
        });
      }
    } else {
      results.push({
        step: '3. Apple Touch Icon (/apple-touch-icon.png)',
        passed: false,
        details: `HTTP ${res.status} returned`,
      });
    }
  } catch (err) {
    results.push({
      step: '3. Apple Touch Icon (/apple-touch-icon.png)',
      passed: false,
      details: `Failed to inspect apple-touch-icon: ${(err as Error).message}`,
    });
  }

  // Optional cleanup of local rate limit attempts if running locally
  if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
    try {
      const { db } = await import('../src/db');
      const { loginAttempts } = await import('../src/db/schema');
      await db.delete(loginAttempts);
    } catch {
      // Ignore if db unavailable directly
    }
  }

  // 4. /login accepts configured passcode
  const realPasscode = process.env.APP_PASSCODE || process.env.PASSCODE || '';
  if (!realPasscode) {
    results.push({
      step: '4. Login Acceptance on Real Passcode',
      passed: false,
      details: 'APP_PASSCODE / PASSCODE not found in environment',
    });
  } else {
    try {
      const res = await fetch(`${targetUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: realPasscode }),
      });

      if (res.status === 200) {
        const rawCookie = res.headers.get('set-cookie');
        if (rawCookie && rawCookie.includes('session=')) {
          // Extract cookie string
          sessionCookie = rawCookie.split(';')[0];
          results.push({
            step: '4. Login Acceptance on Real Passcode',
            passed: true,
            details: 'Accepted passcode with 200 and issued session cookie',
          });
        } else {
          results.push({
            step: '4. Login Acceptance on Real Passcode',
            passed: false,
            details: 'Status 200 but session cookie was missing from set-cookie header',
          });
        }
      } else {
        results.push({
          step: '4. Login Acceptance on Real Passcode',
          passed: false,
          details: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        });
      }
    } catch (err) {
      results.push({
        step: '4. Login Acceptance on Real Passcode',
        passed: false,
        details: `Network error: ${(err as Error).message}`,
      });
    }
  }

  // 5. /login rejects invalid passcode
  try {
    const res = await fetch(`${targetUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'wrong_9999999' }),
    });

    if (res.status === 401) {
      results.push({
        step: '5. Login Rejection on Wrong Passcode',
        passed: true,
        details: 'Correctly rejected invalid passcode with HTTP 401',
      });
    } else {
      results.push({
        step: '5. Login Rejection on Wrong Passcode',
        passed: false,
        details: `Expected HTTP 401, got ${res.status}`,
      });
    }
  } catch (err) {
    results.push({
      step: '5. Login Rejection on Wrong Passcode',
      passed: false,
      details: `Network error: ${(err as Error).message}`,
    });
  }

  // 6. /api/daily-review returns 401 without auth
  try {
    const res = await fetch(`${targetUrl}/api/daily-review`);
    if (res.status === 401) {
      results.push({
        step: '6. Route Protection (/api/daily-review)',
        passed: true,
        details: 'Correctly rejected unauthorized request with HTTP 401',
      });
    } else {
      results.push({
        step: '6. Route Protection (/api/daily-review)',
        passed: false,
        details: `Expected HTTP 401, got ${res.status}`,
      });
    }
  } catch (err) {
    results.push({
      step: '6. Route Protection (/api/daily-review)',
      passed: false,
      details: `Network error: ${(err as Error).message}`,
    });
  }

  // 7. /api/daily-review returns 200 with valid session
  if (!sessionCookie) {
    results.push({
      step: '7. Authenticated Daily Review Fetch',
      passed: false,
      details: 'Skipped because session cookie could not be obtained in Step 5',
    });
  } else {
    try {
      const res = await fetch(`${targetUrl}/api/daily-review`, {
        headers: { Cookie: sessionCookie },
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data && data.advice) {
          results.push({
            step: '7. Authenticated Daily Review Fetch',
            passed: true,
            details: `Returned valid review JSON (Source: ${data.source || 'fallback'})`,
          });
        } else {
          results.push({
            step: '7. Authenticated Daily Review Fetch',
            passed: false,
            details: 'Status 200 but response missing advice field',
          });
        }
      } else {
        results.push({
          step: '7. Authenticated Daily Review Fetch',
          passed: false,
          details: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        });
      }
    } catch (err) {
      results.push({
        step: '7. Authenticated Daily Review Fetch',
        passed: false,
        details: `Network error: ${(err as Error).message}`,
      });
    }
  }

  // 8. /api/insights/seen accepts POST and records view
  if (!sessionCookie) {
    results.push({
      step: '8. Insight Seen Tracking (/api/insights/seen)',
      passed: false,
      details: 'Skipped because session cookie was not available',
    });
  } else {
    try {
      const res = await fetch(`${targetUrl}/api/insights/seen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({ insightKey: 'verify_live_smoke_key' }),
      });

      if (res.status === 200) {
        const data = await res.json().catch(() => ({}));
        if (data.success === true) {
          results.push({
            step: '8. Insight Seen Tracking (/api/insights/seen)',
            passed: true,
            details: 'Recorded view successfully (status 200, success: true)',
          });
        } else {
          results.push({
            step: '8. Insight Seen Tracking (/api/insights/seen)',
            passed: false,
            details: `Unexpected response: ${JSON.stringify(data)}`,
          });
        }
      } else {
        results.push({
          step: '8. Insight Seen Tracking (/api/insights/seen)',
          passed: false,
          details: `HTTP ${res.status}: ${await res.text().catch(() => '')}`,
        });
      }
    } catch (err) {
      results.push({
        step: '8. Insight Seen Tracking (/api/insights/seen)',
        passed: false,
        details: `Network error: ${(err as Error).message}`,
      });
    }
  }

  // Print Summary Table
  console.log('\n--- LIVE VERIFICATION RESULTS ---');
  console.log('| Step / Verification Item                     | Result | Details');
  console.log('|----------------------------------------------|--------|-------------------------------------------------------');
  for (const r of results) {
    const name = r.step.padEnd(44);
    const res = (r.passed ? 'PASS' : 'FAIL').padEnd(6);
    console.log(`| ${name} | ${res} | ${r.details}`);
  }
  console.log('');

  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    console.log('RESULT: ALL 8 LIVE CHECKS PASSED.');
    process.exit(0);
  } else {
    console.log('RESULT: SOME LIVE CHECKS FAILED.');
    process.exit(1);
  }
}

verifyLive().catch((err) => {
  console.error('Fatal live verification error:', err);
  process.exit(1);
});
