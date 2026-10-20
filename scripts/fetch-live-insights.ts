import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { SignJWT } from 'jose';

const BASE_URL = 'http://localhost:3000';
const SESSION_SECRET = process.env.SESSION_SECRET || 'spendcoach-dev-secret-at-least-32-chars-long';

async function main() {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  const token = await new SignJWT({ auth: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);

  const res = await fetch(`${BASE_URL}/api/insights?fresh=true`, {
    headers: {
      Cookie: `session=${token}`,
    },
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const json = await res.json();
  const payload = {
    coverage: json.coverage,
    allowance: json.allowance,
    insights: json.insights,
    silentFlags: json.silentFlags,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch(console.error);

