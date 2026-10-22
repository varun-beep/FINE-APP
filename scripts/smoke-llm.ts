import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { execSync } from 'child_process';
import { generateDailyReview } from '../src/lib/llm/service';

async function runSmokeLlm() {
  console.log('--- SpendCoach LLM Smoke Test ---');

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || apiKey.length < 8) {
    console.log('SKIPPING smoke:llm gracefully: GROQ_API_KEY is not set or is a placeholder in .env.local.');
    console.log('Documented: SpendCoach safely uses deterministic fallback advice when LLM API key is not present.');
    process.exit(0);
  }

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    console.error('REFUSING TO RUN smoke:llm: Running in production or on Vercel.');
    process.exit(1);
  }

  console.log('1. Seeding 90 days of realistic synthetic demo data...');
  execSync('pnpm seed:demo', { stdio: 'inherit' });

  console.log('\n2. Calling generateDailyReview with regenerate=true...');
  try {
    const result = await generateDailyReview(undefined, { regenerate: true });

    console.log('\n--- LLM Smoke Test Result ---');
    console.log(`- Date: ${result.date}`);
    console.log(`- Source: ${result.source}`);
    if (result.fallbackReason) {
      console.log(`- Fallback Reason: ${result.fallbackReason}`);
    }
    if (result.rawModelOutput) {
      console.log('\n[Raw Model JSON Output]:');
      console.log(result.rawModelOutput);
    } else {
      console.log('\n[Raw Model Output]: (none generated)');
    }

    if (result.guardrailRejectedNumbers && result.guardrailRejectedNumbers.length > 0) {
      console.log(`\n[Guardrail Rejected Numbers]: ${result.guardrailRejectedNumbers.join(', ')}`);
    } else {
      console.log('\n[Guardrail Rejected Numbers]: (none rejected)');
    }

    console.log('\n[Final Advice Verdict]:', result.advice.verdict || result.advice.headline);
  } catch (err) {
    console.error('Smoke test execution encountered error:', err);
  } finally {
    console.log('\n3. Cleaning up synthetic demo data (seed:clear)...');
    execSync('pnpm seed:clear', { stdio: 'inherit' });
    console.log('--- Smoke Test Completed ---');
  }
}

runSmokeLlm().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
