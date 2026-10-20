import { describe, it, expect } from 'vitest';
import {
  createExpenseSchema,
  updateExpenseSchema,
  loginSchema,
  expenseQuerySchema,
  EXPENSE_CATEGORIES,
} from '@/lib/validations';

describe('Zod Validation Schemas', () => {
  describe('createExpenseSchema', () => {
    it('accepts valid expense payload', () => {
      const payload = {
        amount_paise: 19999,
        category: 'Food',
        spent_on: '2026-10-20',
        note: 'Lunch with colleagues',
        merchant: 'Swiggy',
      };
      const result = createExpenseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount_paise).toBe(19999);
        expect(result.data.category).toBe('Food');
        expect(result.data.spent_on).toBe('2026-10-20');
        expect(result.data.note).toBe('Lunch with colleagues');
        expect(result.data.merchant).toBe('Swiggy');
      }
    });

    it('transforms empty strings for note and merchant into null', () => {
      const payload = {
        amount_paise: 5000,
        category: 'Transport',
        spent_on: '2026-10-20',
        note: '   ',
        merchant: '',
      };
      const result = createExpenseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBeNull();
        expect(result.data.merchant).toBeNull();
      }
    });

    it('rejects amount <= 0', () => {
      const resultZero = createExpenseSchema.safeParse({
        amount_paise: 0,
        category: 'Bills',
        spent_on: '2026-10-20',
      });
      expect(resultZero.success).toBe(false);

      const resultNeg = createExpenseSchema.safeParse({
        amount_paise: -100,
        category: 'Bills',
        spent_on: '2026-10-20',
      });
      expect(resultNeg.success).toBe(false);
    });

    it('rejects non-integer amount_paise', () => {
      const result = createExpenseSchema.safeParse({
        amount_paise: 199.99,
        category: 'Health',
        spent_on: '2026-10-20',
      });
      expect(result.success).toBe(false);
    });

    it('accepts only allowed categories', () => {
      for (const cat of EXPENSE_CATEGORIES) {
        const result = createExpenseSchema.safeParse({
          amount_paise: 1000,
          category: cat,
          spent_on: '2026-10-20',
        });
        expect(result.success).toBe(true);
      }

      const invalid = createExpenseSchema.safeParse({
        amount_paise: 1000,
        category: 'Cryptocurrency',
        spent_on: '2026-10-20',
      });
      expect(invalid.success).toBe(false);
    });

    it('rejects invalid date formats and impossible dates', () => {
      expect(
        createExpenseSchema.safeParse({
          amount_paise: 100,
          category: 'Other',
          spent_on: '20-10-2026',
        }).success
      ).toBe(false);

      expect(
        createExpenseSchema.safeParse({
          amount_paise: 100,
          category: 'Other',
          spent_on: '2026/10/20',
        }).success
      ).toBe(false);

      // 31st February does not exist
      expect(
        createExpenseSchema.safeParse({
          amount_paise: 100,
          category: 'Other',
          spent_on: '2026-02-31',
        }).success
      ).toBe(false);
    });
  });

  describe('updateExpenseSchema', () => {
    it('accepts partial update of single field', () => {
      const result = updateExpenseSchema.safeParse({
        amount_paise: 25000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects completely empty update payload', () => {
      const result = updateExpenseSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('validates types on provided fields', () => {
      const result = updateExpenseSchema.safeParse({
        amount_paise: -50,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts valid passcode', () => {
      const result = loginSchema.safeParse({ passcode: '1234' });
      expect(result.success).toBe(true);
    });

    it('rejects empty passcode', () => {
      const result = loginSchema.safeParse({ passcode: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('expenseQuerySchema', () => {
    it('validates month filter (YYYY-MM)', () => {
      expect(expenseQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
      expect(expenseQuerySchema.safeParse({ month: '2026-1' }).success).toBe(false);
      expect(expenseQuerySchema.safeParse({ month: 'October-2026' }).success).toBe(false);
    });

    it('validates single date filter (YYYY-MM-DD)', () => {
      expect(expenseQuerySchema.safeParse({ date: '2026-10-20' }).success).toBe(true);
      expect(expenseQuerySchema.safeParse({ date: '2026-02-31' }).success).toBe(false);
    });
  });
});
