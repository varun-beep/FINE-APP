import { describe, it, expect } from 'vitest';
import { parseAmountShorthand } from '@/lib/money';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/validations';

/**
 * Pure category frequency ordering algorithm as used in the add-expense sheet.
 */
export function orderCategoriesByFrequency(
  expenses: Array<{ category: string; merchant?: string | null }>
): {
  orderedCategories: ExpenseCategory[];
  merchantCategoryMap: Map<string, ExpenseCategory>;
} {
  const catCounts: Record<string, number> = {};
  const merchCat = new Map<string, ExpenseCategory>();

  for (const e of expenses) {
    catCounts[e.category] = (catCounts[e.category] || 0) + 1;
    if (e.merchant) {
      const mClean = e.merchant.trim().toLowerCase();
      if (!merchCat.has(mClean)) {
        merchCat.set(mClean, e.category as ExpenseCategory);
      }
    }
  }

  const orderedCategories = [...EXPENSE_CATEGORIES].sort(
    (a, b) => (catCounts[b] || 0) - (catCounts[a] || 0)
  );

  return { orderedCategories, merchantCategoryMap: merchCat };
}

describe('D2. Missing Tests: Amount Shorthand & Category Frequency Ordering', () => {
  describe('parseAmountShorthand', () => {
    it('parses plain rupee integers', () => {
      expect(parseAmountShorthand('250')).toBe(25000); // ₹250.00
      expect(parseAmountShorthand('120')).toBe(12000); // ₹120.00
      expect(parseAmountShorthand('1000')).toBe(100000);
    });

    it('parses amounts with rupee symbols, spaces, and commas', () => {
      expect(parseAmountShorthand('₹120')).toBe(12000);
      expect(parseAmountShorthand('₹ 4,850')).toBe(485000);
      expect(parseAmountShorthand('₹4,850.50')).toBe(485050);
    });

    it('parses thousand shorthand (k)', () => {
      expect(parseAmountShorthand('1.5k')).toBe(150000); // ₹1,500
      expect(parseAmountShorthand('25k')).toBe(2500000); // ₹25,000
      expect(parseAmountShorthand('2.5 k')).toBe(250000); // ₹2,500
      expect(parseAmountShorthand('₹10k')).toBe(1000000); // ₹10,000
    });

    it('parses lakh shorthand (l, lakh, lakhs)', () => {
      expect(parseAmountShorthand('1.2L')).toBe(12000000); // ₹1,20,000
      expect(parseAmountShorthand('1.2lakh')).toBe(12000000);
      expect(parseAmountShorthand('2lakhs')).toBe(20000000); // ₹2,00,000
    });

    it('parses crore shorthand (cr, crore, crores)', () => {
      expect(parseAmountShorthand('1.5cr')).toBe(1500000000); // ₹1.5 Crore
      expect(parseAmountShorthand('1 crore')).toBe(1000000000);
    });

    it('returns null for invalid, non-positive, or empty inputs', () => {
      expect(parseAmountShorthand('')).toBeNull();
      expect(parseAmountShorthand('   ')).toBeNull();
      expect(parseAmountShorthand('abc')).toBeNull();
      expect(parseAmountShorthand('0')).toBeNull();
      expect(parseAmountShorthand('-150')).toBeNull();
      expect(parseAmountShorthand('₹0.00')).toBeNull();
    });
  });

  describe('Category Frequency Ordering', () => {
    it('orders categories by frequency so most-used categories surface first on the add-expense sheet', () => {
      const expenses = [
        ...Array(12).fill({ category: 'Transport', merchant: 'Uber' }),
        ...Array(20).fill({ category: 'Food', merchant: 'Swiggy' }),
        ...Array(5).fill({ category: 'Entertainment', merchant: 'Netflix' }),
        ...Array(2).fill({ category: 'Shopping', merchant: 'Amazon' }),
      ];

      const { orderedCategories, merchantCategoryMap } = orderCategoriesByFrequency(expenses);

      // Top category must be Food (20 entries)
      expect(orderedCategories[0]).toBe('Food');
      // Second category must be Transport (12 entries)
      expect(orderedCategories[1]).toBe('Transport');
      // Third category must be Entertainment (5 entries)
      expect(orderedCategories[2]).toBe('Entertainment');
      // Fourth category must be Shopping (2 entries)
      expect(orderedCategories[3]).toBe('Shopping');

      // Auto-fills category from known merchant
      expect(merchantCategoryMap.get('swiggy')).toBe('Food');
      expect(merchantCategoryMap.get('uber')).toBe('Transport');
      expect(merchantCategoryMap.get('netflix')).toBe('Entertainment');
      expect(merchantCategoryMap.get('amazon')).toBe('Shopping');
    });

    it('preserves all default categories when history is empty', () => {
      const { orderedCategories } = orderCategoriesByFrequency([]);
      expect(orderedCategories).toHaveLength(EXPENSE_CATEGORIES.length);
      expect(new Set(orderedCategories)).toEqual(new Set(EXPENSE_CATEGORIES));
    });
  });
});
