import { z } from 'zod';

const WEAK_PASSCODES = new Set(['1234', '123456', 'password', 'passcode', 'spendcoach']);

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_PASSCODE: z.string().min(1, 'APP_PASSCODE is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters long'),
  GROQ_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof baseEnvSchema>;

let validatedEnv: Env | null = null;

/**
 * Validates environment variables with strict production security checks.
 */
export function validateEnvConfig(
  rawEnv: Record<string, string | undefined>,
  isProduction = false
): Env {
  const result = baseEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => ` - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `[SpendCoach Config Error] Missing or invalid required environment variables:\n${errorDetails}\nCheck your .env.local file.`
    );
  }

  const data = result.data;

  // Strict Production Secret Validation
  if (isProduction) {
    const prodErrors: string[] = [];

    // 1. APP_PASSCODE validation
    if (data.APP_PASSCODE.length < 10) {
      prodErrors.push(
        'APP_PASSCODE must be at least 10 characters long in production (current length: ' +
          data.APP_PASSCODE.length +
          ')'
      );
    }
    if (WEAK_PASSCODES.has(data.APP_PASSCODE.toLowerCase())) {
      prodErrors.push(
        `APP_PASSCODE cannot be a known-weak value ("${data.APP_PASSCODE}") in production`
      );
    }

    // 2. SESSION_SECRET validation
    if (data.SESSION_SECRET.length < 32) {
      prodErrors.push('SESSION_SECRET must be at least 32 characters long in production');
    }
    if (/example/i.test(data.SESSION_SECRET)) {
      prodErrors.push('SESSION_SECRET cannot contain "example" in production');
    }

    // 3. CRON_SECRET validation
    if (!data.CRON_SECRET || data.CRON_SECRET.length < 32) {
      prodErrors.push(
        'CRON_SECRET must be set and be at least 32 characters long in production'
      );
    } else if (/example/i.test(data.CRON_SECRET)) {
      prodErrors.push('CRON_SECRET cannot contain "example" in production');
    }

    if (prodErrors.length > 0) {
      const details = prodErrors.map((e) => ` - ${e}`).join('\n');
      throw new Error(
        `[SpendCoach Production Security Error] Insecure or invalid secrets detected in production:\n${details}\nGenerate secure 32-byte secrets using "openssl rand -base64 32".`
      );
    }
  }

  return data;
}

export function resetValidatedEnv(): void {
  validatedEnv = null;
}

export function getEnv(): Env {
  if (validatedEnv) return validatedEnv;

  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production';

  validatedEnv = validateEnvConfig(process.env, isProd);
  return validatedEnv;
}
