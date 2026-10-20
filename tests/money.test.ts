import { describe, it, expect } from 'vitest';
import { formatPaise, parseRupeesToPaise, paiseToDecimalString } from '@/lib/money';

describe('Money Helpers', () => {
  describe('formatPaise', () => {
    it('formats ₹199.99 correctly with 19999 paise', () => {
      expect(formatPaise(19999)).toBe('₹199.99');
    });

    it('formats large numbers with Indian digit grouping (₹1,23,456.50)', () => {
      expect(formatPaise(12345650)).toBe('₹1,23,456.50');
    });

    it('formats ₹0.00 correctly', () => {
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('formats single-digit rupees and paise correctly', () => {
      expect(formatPaise(505)).toBe('₹5.05');
      expect(formatPaise(550)).toBe('₹5.50');
      expect(formatPaise(5000)).toBe('₹50.00');
    });

    it('formats 10 Lakhs (₹10,00,000.00)', () => {
      expect(formatPaise(100000000)).toBe('₹10,00,000.00');
    });

    it('formats 1 Crore (₹1,00,00,000.00)', () => {
      expect(formatPaise(1000000000)).toBe('₹1,00,00,000.00');
    });

    it('handles negative amounts cleanly', () => {
      expect(formatPaise(-19999)).toBe('-₹199.99');
      expect(formatPaise(-12345650)).toBe('-₹1,23,456.50');
    });

    it('throws on non-finite values', () => {
      expect(() => formatPaise(NaN)).toThrow(TypeError);
      expect(() => formatPaise(Infinity)).toThrow(TypeError);
    });
  });

  describe('parseRupeesToPaise', () => {
    it('parses ₹199.99 string to 19999 integer paise', () => {
      expect(parseRupeesToPaise('199.99')).toBe(19999);
      expect(parseRupeesToPaise('₹199.99')).toBe(19999);
    });

    it('parses ₹1,23,456.50 to 12345650 integer paise', () => {
      expect(parseRupeesToPaise('1,23,456.50')).toBe(12345650);
      expect(parseRupeesToPaise('₹1,23,456.50')).toBe(12345650);
    });

    it('parses whole rupee numbers', () => {
      expect(parseRupeesToPaise('50')).toBe(5000);
      expect(parseRupeesToPaise('500')).toBe(50000);
      expect(parseRupeesToPaise(50)).toBe(5000);
    });

    it('parses fractions accurately without float errors', () => {
      expect(parseRupeesToPaise('0.05')).toBe(5);
      expect(parseRupeesToPaise('0.5')).toBe(50);
      expect(parseRupeesToPaise('0.50')).toBe(50);
      expect(parseRupeesToPaise(199.99)).toBe(19999);
    });

    it('throws error on invalid strings', () => {
      expect(() => parseRupeesToPaise('')).toThrow(Error);
      expect(() => parseRupeesToPaise('abc')).toThrow(Error);
      expect(() => parseRupeesToPaise('$$$')).toThrow(Error);
      expect(() => parseRupeesToPaise('.')).toThrow(Error);
    });
  });

  describe('paiseToDecimalString', () => {
    it('converts paise to clean decimal input values', () => {
      expect(paiseToDecimalString(19999)).toBe('199.99');
      expect(paiseToDecimalString(5000)).toBe('50.00');
      expect(paiseToDecimalString(5)).toBe('0.05');
      expect(paiseToDecimalString(0)).toBe('0.00');
    });
  });
});
