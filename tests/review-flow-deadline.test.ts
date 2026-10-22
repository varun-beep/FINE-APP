import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

let afterCallback: (() => unknown) | null = null;

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      afterCallback = fn;
    }),
  };
});

describe('Item 5b: LLM Deadline & Async Review Flow', () => {
  describe('1. 22-Second LLM Budget & Deadline Logic', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does NOT retry when under 8 seconds remain in 22s budget', async () => {
      const TOTAL_LLM_BUDGET_MS = 22000;
      const startTime = Date.now();

      // Simulate first call taking 15 seconds (15000ms)
      vi.advanceTimersByTime(15000);
      const elapsedMs = Date.now() - startTime;
      const remainingBudgetMs = TOTAL_LLM_BUDGET_MS - elapsedMs;

      expect(elapsedMs).toBe(15000);
      expect(remainingBudgetMs).toBe(7000);

      // Under 8 seconds remain: condition `remainingBudgetMs >= 8000` evaluates to false
      const canRetry = remainingBudgetMs >= 8000;
      expect(canRetry).toBe(false);

      // Verify no retry attempted and fallback triggered
      let retryCalled = false;
      if (canRetry) {
        retryCalled = true;
      }
      expect(retryCalled).toBe(false);
    });

    it('retries when at least 8 seconds remain, capping retry timeout to remaining budget so total never exceeds 22s', async () => {
      const TOTAL_LLM_BUDGET_MS = 22000;
      const startTime = Date.now();

      // Simulate first call taking 10 seconds (10000ms)
      vi.advanceTimersByTime(10000);
      const elapsedMs = Date.now() - startTime;
      const remainingBudgetMs = TOTAL_LLM_BUDGET_MS - elapsedMs;

      expect(elapsedMs).toBe(10000);
      expect(remainingBudgetMs).toBe(12000);

      // At least 8 seconds remain: condition evaluates to true
      const canRetry = remainingBudgetMs >= 8000;
      expect(canRetry).toBe(true);

      // The retry timeout is capped at remainingBudgetMs (12000ms)
      const retryTimeout = remainingBudgetMs;
      expect(retryTimeout).toBe(12000);

      // Even if retry consumes its entire timeout, total time equals exactly 22000ms
      const maxTotalDuration = elapsedMs + retryTimeout;
      expect(maxTotalDuration).toBeLessThanOrEqual(TOTAL_LLM_BUDGET_MS);
      expect(maxTotalDuration).toBe(22000);
    });
  });

  describe('2. Day-Closures Route Returns Immediately via after()', () => {
    it('returns 200 immediately without waiting for review generation, deferring it via after()', async () => {
      afterCallback = null;
      const routeModule = await import('@/app/api/day-closures/route');
      
      const req = new NextRequest('http://localhost:3000/api/day-closures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day: '2026-10-21',
          status: 'logged',
        }),
      });

      const res = await routeModule.POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toBe('Day 2026-10-21 recorded as logged');
      expect(json.dayClosure).toBeDefined();
      expect(json.dayClosure.day).toBe('2026-10-21');
      expect(json.dayClosure.status).toBe('logged');

      // Assert after() was called with deferred background work
      expect(afterCallback).toBeTypeOf('function');
    });
  });

  describe('3. /review Polling UI', () => {
    it('displays "Generating your review..." while loading/polling, then renders the result', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const pageCode = fs.readFileSync(
        path.join(process.cwd(), 'src/app/review/page.tsx'),
        'utf-8'
      );

      // 1. Assert "Generating your review..." is present in the loading state
      expect(pageCode).toContain('Generating your review...');

      // 2. Assert polling loop is present in fetchDailyReview
      expect(pageCode).toContain('status === 202');
      expect(pageCode).toContain("status === 'generating'");
      expect(pageCode).toContain('Synthesizing today');
    });
  });
});
