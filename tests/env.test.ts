import { describe, it, expect } from 'vitest';
import { validateEnvConfig } from '@/lib/env';

describe('2. Production Secret Validation (env.ts)', () => {
  const validDevEnv = {
    DATABASE_URL: 'postgresql://resoai_user:resoai_password@localhost:5432/spendcoach',
    APP_PASSCODE: '1234',
    SESSION_SECRET: 'spendcoach_super_secure_session_secret_at_least_32_bytes_long!',
    CRON_SECRET: 'spendcoach_cron_secret_example',
  };

  const validProdEnv = {
    DATABASE_URL: 'postgresql://resoai_user:resoai_password@localhost:5432/spendcoach',
    APP_PASSCODE: 'CorrectHorseBatteryStaple99!',
    SESSION_SECRET: 'eXJ0u9qF+L9GzW9Xy6vM1pN2qR3sT4uV5wX6yZ7aB8c=', // 44 chars, no "example"
    CRON_SECRET: '9kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4jK6mN8=',   // 44 chars, no "example"
  };

  it('allows short passcodes and example secrets in development mode', () => {
    const res = validateEnvConfig(validDevEnv, false);
    expect(res.APP_PASSCODE).toBe('1234');
    expect(res.SESSION_SECRET).toBe(validDevEnv.SESSION_SECRET);
  });

  it('accepts strong, compliant secrets in production mode', () => {
    const res = validateEnvConfig(validProdEnv, true);
    expect(res.APP_PASSCODE).toBe(validProdEnv.APP_PASSCODE);
    expect(res.SESSION_SECRET).toBe(validProdEnv.SESSION_SECRET);
    expect(res.CRON_SECRET).toBe(validProdEnv.CRON_SECRET);
  });

  it('fails in production if APP_PASSCODE is shorter than 10 characters', () => {
    const invalid = {
      ...validProdEnv,
      APP_PASSCODE: '123456789', // 9 chars
    };

    expect(() => validateEnvConfig(invalid, true)).toThrowError(
      /APP_PASSCODE must be at least 10 characters long in production/
    );
  });

  it('fails in production if APP_PASSCODE is a known weak value', () => {
    const weakPasscodes = ['1234', '123456', 'password', 'passcode', 'spendcoach', 'PASSWORD'];
    for (const weak of weakPasscodes) {
      const invalid = {
        ...validProdEnv,
        APP_PASSCODE: weak,
      };
      expect(() => validateEnvConfig(invalid, true)).toThrowError(
        /APP_PASSCODE cannot be a known-weak value/
      );
    }
  });

  it('fails in production if SESSION_SECRET is shorter than 32 characters', () => {
    const invalid = {
      ...validProdEnv,
      SESSION_SECRET: 'short_secret_under_32_chars',
    };

    expect(() => validateEnvConfig(invalid, true)).toThrowError(
      /SESSION_SECRET must be at least 32 characters/
    );
  });

  it('fails in production if SESSION_SECRET contains "example"', () => {
    const invalid = {
      ...validProdEnv,
      SESSION_SECRET: 'super_long_secret_that_contains_example_value_12345',
    };

    expect(() => validateEnvConfig(invalid, true)).toThrowError(
      /SESSION_SECRET cannot contain "example"/
    );
  });

  it('fails in production if CRON_SECRET is shorter than 32 characters or contains "example"', () => {
    const shortCron = {
      ...validProdEnv,
      CRON_SECRET: 'short_cron_secret',
    };
    expect(() => validateEnvConfig(shortCron, true)).toThrowError(
      /CRON_SECRET must be set and be at least 32 characters/
    );

    const exampleCron = {
      ...validProdEnv,
      CRON_SECRET: 'long_cron_secret_with_example_in_string_12345678',
    };
    expect(() => validateEnvConfig(exampleCron, true)).toThrowError(
      /CRON_SECRET cannot contain "example"/
    );
  });
});
