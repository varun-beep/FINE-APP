import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashIp } from '@/lib/auth';

// In-memory simulation of login_attempts table for deterministic unit testing
interface MockAttempt {
  id: string;
  ipHash: string;
  succeeded: boolean;
  attemptedAt: Date;
}

let mockTable: MockAttempt[] = [];

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: any) => ({
          orderBy: () => {
            // Filter based on condition metadata or evaluate in memory
            const { ipHash, cutoff } = condition?._testMeta || {};
            return mockTable
              .filter((row) => {
                if (cutoff && row.attemptedAt < cutoff) return false;
                if (ipHash && row.ipHash !== ipHash) return false;
                return !row.succeeded;
              })
              .sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (val: { ipHash: string; succeeded: boolean; attemptedAt: Date }) => {
        mockTable.push({
          id: `attempt-${Date.now()}-${Math.random()}`,
          ipHash: val.ipHash,
          succeeded: val.succeeded,
          attemptedAt: val.attemptedAt,
        });
        return [val];
      },
    }),
    delete: () => ({
      where: async (condition: any) => {
        const { ipHash, cutoff } = condition?._testMeta || {};
        mockTable = mockTable.filter((row) => {
          if (ipHash && row.ipHash === ipHash) return false;
          if (cutoff && row.attemptedAt < cutoff) return false;
          return true;
        });
      },
    }),
  },
}));

// Mock drizzle operators to capture conditions cleanly
vi.mock('drizzle-orm', () => ({
  eq: (field: any, val: any) => {
    if (typeof val === 'boolean') {
      return { _testMeta: { succeeded: val } };
    }
    return { _testMeta: { ipHash: val } };
  },
  and: (...conditions: any[]) => {
    const meta: Record<string, any> = {};
    for (const c of conditions) {
      if (c?._testMeta) Object.assign(meta, c._testMeta);
    }
    return { _testMeta: meta };
  },
  gte: (_field: any, val: Date) => ({ _testMeta: { cutoff: val } }),
  lt: (_field: any, val: Date) => ({ _testMeta: { cutoff: val } }),
  asc: () => ({}),
}));

describe('1. DB-Backed Login Rate Limiter', async () => {
  // Dynamically import auth so mocked DB is used
  const { checkRateLimit, recordFailedAttempt, clearRateLimit } = await import('@/lib/auth');

  const TEST_IP_1 = '192.168.1.100';
  const TEST_IP_2 = '192.168.1.200';

  beforeEach(() => {
    mockTable = [];
    process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
    process.env.APP_PASSCODE = '1234567890';
    process.env.SESSION_SECRET = 'spendcoach_super_secure_session_secret_at_least_32_bytes_long!';
  });

  it('hashes IP using HMAC-SHA256 with SESSION_SECRET', () => {
    const hash1 = hashIp('127.0.0.1', 'secret1');
    const hash2 = hashIp('127.0.0.1', 'secret1');
    const hashDiffSecret = hashIp('127.0.0.1', 'secret2');
    const hashDiffIp = hashIp('127.0.0.2', 'secret1');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiffSecret);
    expect(hash1).not.toBe(hashDiffIp);
    expect(hash1).toHaveLength(64); // SHA256 hex is 64 characters
  });

  it('allows initial attempts and blocks the 6th consecutive failure within 10 minutes', async () => {
    const now = new Date('2026-10-20T12:00:00Z');

    // First 5 failures
    for (let i = 1; i <= 5; i++) {
      const statusBefore = await checkRateLimit(TEST_IP_1, now);
      expect(statusBefore.allowed).toBe(true);
      await recordFailedAttempt(TEST_IP_1, new Date(now.getTime() + i * 1000));
    }

    // 6th attempt is blocked
    const sixthStatus = await checkRateLimit(TEST_IP_1, new Date(now.getTime() + 6000));
    expect(sixthStatus.allowed).toBe(false);
    expect(sixthStatus.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixthStatus.reason).toContain('Too many failed login attempts for this IP');
  });

  it('unblocks when the 10-minute window expires', async () => {
    const initialTime = new Date('2026-10-20T12:00:00Z');

    // 5 failures at 12:00
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(TEST_IP_1, new Date(initialTime.getTime() + i * 1000));
    }

    // Blocked at 12:05 (5 minutes later)
    const midWindow = new Date(initialTime.getTime() + 5 * 60 * 1000);
    const blockedStatus = await checkRateLimit(TEST_IP_1, midWindow);
    expect(blockedStatus.allowed).toBe(false);

    // Unblocked at 12:11 (11 minutes later, window expired)
    const postWindow = new Date(initialTime.getTime() + 11 * 60 * 1000);
    const unblockedStatus = await checkRateLimit(TEST_IP_1, postWindow);
    expect(unblockedStatus.allowed).toBe(true);
  });

  it('blocks when global cap of 20 failed attempts in 1 hour across all IPs is reached', async () => {
    const now = new Date('2026-10-20T12:00:00Z');

    // Generate 20 failures across 10 different IPs (2 per IP, so no single IP hits 5)
    for (let i = 0; i < 20; i++) {
      const distinctIp = `10.0.0.${i + 1}`;
      await recordFailedAttempt(distinctIp, new Date(now.getTime() + i * 1000));
    }

    // A fresh IP now tries to log in
    const freshIp = '10.0.0.99';
    const status = await checkRateLimit(freshIp, new Date(now.getTime() + 25000));

    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Global login attempt rate limit reached');
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets failure count for that IP upon successful login', async () => {
    const now = new Date('2026-10-20T12:00:00Z');

    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      await recordFailedAttempt(TEST_IP_1, new Date(now.getTime() + i * 1000));
    }

    // Also record failures for IP 2 to verify isolation
    await recordFailedAttempt(TEST_IP_2, now);

    // Successful login for IP 1
    await clearRateLimit(TEST_IP_1);

    // IP 1 should now be completely reset (can fail 4 more times without blocking)
    for (let i = 0; i < 4; i++) {
      const check = await checkRateLimit(TEST_IP_1, now);
      expect(check.allowed).toBe(true);
      await recordFailedAttempt(TEST_IP_1, new Date(now.getTime() + (10 + i) * 1000));
    }

    // IP 2 still has its attempt recorded
    const ip2Hash = hashIp(TEST_IP_2);
    expect(mockTable.some((r) => r.ipHash === ip2Hash)).toBe(true);
  });
});
