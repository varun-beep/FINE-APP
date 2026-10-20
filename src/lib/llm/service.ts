import { db } from '@/db';
import { reviews } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getLatestEngineOutput } from '@/lib/engine/db';
import type { EngineOutput } from '@/lib/engine/types';
import { getKolkataToday } from '@/lib/date';
import {
  dailyReviewAdviceSchema,
  type DailyReviewAdvice,
  type DailyReviewResult,
  type StoredAdviceJson,
  type FallbackReason,
} from './types';
import { buildDailyReviewSummaryPayload } from './privacy';
import { validateNumberGuardrail } from './guardrail';
import { generateFallbackAdvice, generateLearningAdvice } from './fallback';

const FINANCIAL_DISCLAIMER =
  'This is general guidance generated from your expense patterns, not professional financial advice.';

const SYSTEM_PROMPT = `You are SpendCoach AI, a personal financial wellness assistant for an individual in India.
All amounts are in Indian Rupees (₹).

STRICT OPERATING RULES:
1. ONLY USE NUMBERS GIVEN IN THE INPUT SUMMARY. NEVER invent, extrapolate, or estimate figures not explicitly provided in the input summary.
2. DO NOT mention specific commercial financial products, investment funds, credit cards, or interest rates.
3. Keep your tone calm, supportive, and non-judgmental.
4. Propose small, concrete, and doable actions that the user can immediately take tomorrow.
5. This is general guidance based on spending data, not professional financial advice.

You must respond in valid JSON matching this schema:
{
  "headline": string, // punchy, supportive summary sentence
  "went_well": string[], // 1 to 3 positive financial habits or controlled expenses
  "watch_out": string[], // 0 to 3 areas needing caution or spikes
  "action_tomorrow": string, // exactly 1 small, concrete, doable action for tomorrow
  "saving_ideas": string[], // 1 to 3 realistic, simple ways to save
  "earning_ideas": string[], // 0 to 2 simple ways to earn extra or declutter
  "mood": "good" | "ok" | "careful"
}`;

export interface GenerateReviewOptions {
  regenerate?: boolean;
  forceSource?: 'llm' | 'fallback';
}

class LlmHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LlmHttpError';
    this.status = status;
  }
}

/**
 * Calls the Groq OpenAI-compatible chat completion endpoint.
 */
async function callGroqChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(20000), // 20-second timeout
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new LlmHttpError(
      response.status,
      `LLM API returned status ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM response contained no choices or message content');
  }

  return content;
}

/**
 * Attempts to parse, validate, and guardrail check an LLM output string.
 */
function parseAndValidateLlmOutput(
  rawContent: string,
  allowedNumbers: number[]
):
  | { success: true; advice: DailyReviewAdvice }
  | {
      success: false;
      error: string;
      reason: 'invalid_json' | 'schema_invalid' | 'guardrail_rejected';
      rejectedNumbers?: number[];
    } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    return {
      success: false,
      error: `Malformed JSON: ${(err as Error).message}`,
      reason: 'invalid_json',
    };
  }

  const schemaResult = dailyReviewAdviceSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      success: false,
      error: `Schema validation failed: ${schemaResult.error.issues.map((i) => i.message).join('; ')}`,
      reason: 'schema_invalid',
    };
  }

  const guardrailResult = validateNumberGuardrail(schemaResult.data, allowedNumbers);
  if (!guardrailResult.valid) {
    return {
      success: false,
      error: guardrailResult.reason || 'Guardrail validation rejected unsupported numbers',
      reason: 'guardrail_rejected',
      rejectedNumbers: guardrailResult.unsupportedNumbers,
    };
  }

  return { success: true, advice: schemaResult.data };
}

/**
 * Core daily review generation function.
 */
export async function generateDailyReview(
  targetDate?: string,
  options?: GenerateReviewOptions
): Promise<DailyReviewResult> {
  const dateKey = targetDate || getKolkataToday();
  const regenerate = options?.regenerate === true;

  // 1. Fetch current engine output
  const engineOutput = await getLatestEngineOutput(dateKey);

  // 2. LEARNING STATE CHECK
  if (engineOutput.learning.status === 'learning') {
    const learningAdvice = generateLearningAdvice(engineOutput);
    const learningResult: DailyReviewResult = {
      date: dateKey,
      source: 'fallback',
      advice: learningAdvice,
      isLearning: true,
      regenerationCount: 0,
      canRegenerate: false,
      learningProgress: {
        expenseCount: engineOutput.learning.expenseCount,
        expenseThreshold: engineOutput.learning.expenseThreshold,
        distinctDaysCount: engineOutput.learning.distinctDaysCount,
        distinctDaysThreshold: engineOutput.learning.distinctDaysThreshold,
        expensesNeeded: engineOutput.learning.expensesNeeded,
        daysNeeded: engineOutput.learning.daysNeeded,
      },
      disclaimer: FINANCIAL_DISCLAIMER,
      fallbackReason: 'no_key', // Learning state does not call LLM
    };

    await persistReviewAdvice(
      dateKey,
      engineOutput,
      learningAdvice,
      'fallback',
      0,
      true,
      {
        expenseCount: engineOutput.learning.expenseCount,
        expenseThreshold: engineOutput.learning.expenseThreshold,
        distinctDaysCount: engineOutput.learning.distinctDaysCount,
        distinctDaysThreshold: engineOutput.learning.distinctDaysThreshold,
        expensesNeeded: engineOutput.learning.expensesNeeded,
        daysNeeded: engineOutput.learning.daysNeeded,
      },
      'no_key'
    );

    return learningResult;
  }

  // 3. CACHE AND REGENERATE CHECK
  const [existingReview] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.reviewDate, dateKey))
    .limit(1);

  let currentRegenCount = 0;
  if (existingReview?.adviceJson) {
    const stored = existingReview.adviceJson as StoredAdviceJson;
    currentRegenCount = stored._meta?.regenerationCount ?? 0;

    if (!regenerate && !stored._meta?.isLearning) {
      const parsedStored = dailyReviewAdviceSchema.safeParse(stored);
      if (parsedStored.success) {
        return {
          date: dateKey,
          source: (existingReview.source as 'llm' | 'fallback') || 'fallback',
          advice: parsedStored.data,
          isLearning: false,
          regenerationCount: currentRegenCount,
          canRegenerate: currentRegenCount < 5,
          disclaimer: FINANCIAL_DISCLAIMER,
          fallbackReason: stored._meta?.fallbackReason,
          rawModelOutput: stored._meta?.rawModelOutput,
          guardrailRejectedNumbers: stored._meta?.guardrailRejectedNumbers,
        };
      }
    }
  }

  if (regenerate && currentRegenCount >= 5) {
    if (existingReview?.adviceJson) {
      const stored = existingReview.adviceJson as StoredAdviceJson;
      const parsedStored = dailyReviewAdviceSchema.safeParse(stored);
      if (parsedStored.success) {
        return {
          date: dateKey,
          source: (existingReview.source as 'llm' | 'fallback') || 'fallback',
          advice: parsedStored.data,
          isLearning: false,
          regenerationCount: currentRegenCount,
          canRegenerate: false,
          disclaimer: FINANCIAL_DISCLAIMER,
          fallbackReason: stored._meta?.fallbackReason,
          rawModelOutput: stored._meta?.rawModelOutput,
          guardrailRejectedNumbers: stored._meta?.guardrailRejectedNumbers,
        };
      }
    }
  }

  const nextRegenCount = regenerate ? currentRegenCount + 1 : currentRegenCount;

  // 4. PREPARE PRIVACY PAYLOAD AND NUMBER GUARDRAIL ALLOWED LIST
  const { payload, allowedNumbers } = buildDailyReviewSummaryPayload(engineOutput, dateKey);

  // 5. CALL LLM (OR FALLBACK)
  const apiKey = process.env.GROQ_API_KEY?.trim() || '';
  const baseUrl = process.env.LLM_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL?.trim() || 'llama-3.3-70b-versatile';

  let finalAdvice: DailyReviewAdvice | null = null;
  let finalSource: 'llm' | 'fallback' = 'fallback';
  let fallbackReason: FallbackReason | undefined;
  let rawModelOutput: string | undefined;
  let guardrailRejectedNumbers: number[] | undefined;

  if (!apiKey || options?.forceSource === 'fallback') {
    fallbackReason = 'no_key';
    console.warn('[LLM Fallback]: Reason: no_key (GROQ_API_KEY missing or fallback forced)');
    finalAdvice = generateFallbackAdvice(engineOutput);
    finalSource = 'fallback';
  } else {
    try {
      const userMessage = JSON.stringify(payload, null, 2);
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ];

      // First LLM call
      rawModelOutput = await callGroqChat(messages, apiKey, baseUrl, model);
      const firstCheck = parseAndValidateLlmOutput(rawModelOutput, allowedNumbers);

      if (firstCheck.success) {
        finalAdvice = firstCheck.advice;
        finalSource = 'llm';
      } else {
        // Record intermediate reason and retry once
        if (firstCheck.reason === 'guardrail_rejected') {
          guardrailRejectedNumbers = firstCheck.rejectedNumbers;
        }

        const repairMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          ...messages,
          { role: 'assistant', content: rawModelOutput },
          {
            role: 'user',
            content: `Your previous response was rejected due to: ${firstCheck.error}.
Please strictly fix this now. You must ONLY use numbers present in the input, produce valid JSON adhering strictly to the schema, and never invent any numbers or products.`,
          },
        ];

        const retryRaw = await callGroqChat(repairMessages, apiKey, baseUrl, model);
        rawModelOutput = retryRaw;
        const retryCheck = parseAndValidateLlmOutput(retryRaw, allowedNumbers);

        if (retryCheck.success) {
          finalAdvice = retryCheck.advice;
          finalSource = 'llm';
          guardrailRejectedNumbers = undefined;
        } else {
          fallbackReason = retryCheck.reason;
          if (retryCheck.reason === 'guardrail_rejected') {
            guardrailRejectedNumbers = retryCheck.rejectedNumbers;
          }
          console.warn(`[LLM Fallback]: Reason: ${fallbackReason} (${retryCheck.error})`);
          finalAdvice = generateFallbackAdvice(engineOutput);
          finalSource = 'fallback';
        }
      }
    } catch (err: unknown) {
      const errorObj = err as { name?: string; message?: string; status?: number } | undefined;
      if (err instanceof LlmHttpError) {
        fallbackReason = err.status === 429 ? 'rate_limited' : 'http_error';
      } else if (
        errorObj?.name === 'TimeoutError' ||
        errorObj?.name === 'AbortError' ||
        String(errorObj?.message || '').toLowerCase().includes('timed out')
      ) {
        fallbackReason = 'timeout';
      } else if (String(errorObj?.message || '').includes('429')) {
        fallbackReason = 'rate_limited';
      } else {
        fallbackReason = 'http_error';
      }

      console.warn(`[LLM Fallback]: Reason: ${fallbackReason} - ${errorObj?.message || 'Error occurred'}`);
      finalAdvice = generateFallbackAdvice(engineOutput);
      finalSource = 'fallback';
    }
  }

  if (!finalAdvice) {
    fallbackReason = fallbackReason || 'http_error';
    finalAdvice = generateFallbackAdvice(engineOutput);
    finalSource = 'fallback';
  }

  // 6. PERSIST TO REVIEWS TABLE
  await persistReviewAdvice(
    dateKey,
    engineOutput,
    finalAdvice,
    finalSource,
    nextRegenCount,
    false,
    undefined,
    fallbackReason,
    rawModelOutput,
    guardrailRejectedNumbers
  );

  return {
    date: dateKey,
    source: finalSource,
    advice: finalAdvice,
    isLearning: false,
    regenerationCount: nextRegenCount,
    canRegenerate: nextRegenCount < 5,
    disclaimer: FINANCIAL_DISCLAIMER,
    fallbackReason,
    rawModelOutput,
    guardrailRejectedNumbers,
  };
}

/**
 * Upserts advice and metadata to the reviews table.
 */
async function persistReviewAdvice(
  reviewDate: string,
  stats: EngineOutput,
  advice: DailyReviewAdvice,
  source: 'llm' | 'fallback',
  regenerationCount: number,
  isLearning: boolean,
  learningProgress?: DailyReviewResult['learningProgress'],
  fallbackReason?: FallbackReason,
  rawModelOutput?: string,
  guardrailRejectedNumbers?: number[]
): Promise<void> {
  const adviceToStore: StoredAdviceJson = {
    ...advice,
    _meta: {
      regenerationCount,
      lastGeneratedAt: new Date().toISOString(),
      isLearning,
      learningProgress,
      fallbackReason,
      rawModelOutput,
      guardrailRejectedNumbers,
    },
  };

  await db
    .insert(reviews)
    .values({
      reviewDate,
      statsJson: stats as unknown as Record<string, unknown>,
      adviceJson: adviceToStore as unknown as Record<string, unknown>,
      source,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: reviews.reviewDate,
      set: {
        statsJson: stats as unknown as Record<string, unknown>,
        adviceJson: adviceToStore as unknown as Record<string, unknown>,
        source,
      },
    });
}
