import { z } from 'zod';

export const EXPENSE_CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Bills',
  'Shopping',
  'Health',
  'Entertainment',
  'Rent',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(val: string): boolean {
  if (!dateRegex.test(val)) return false;
  const [year, month, day] = val.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export const createExpenseSchema = z.object({
  amount_paise: z
    .number({ message: 'Amount is required' })
    .int('Amount in paise must be an integer')
    .positive('Amount must be greater than 0'),
  category: z.enum(EXPENSE_CATEGORIES),
  spent_on: z
    .string({ message: 'Date is required' })
    .refine(isValidDateString, {
      message: 'Date must be a valid calendar date in YYYY-MM-DD format',
    }),
  note: z
    .string()
    .max(500, 'Note cannot exceed 500 characters')
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : val && val.trim().length > 0 ? val.trim() : null)),
  merchant: z
    .string()
    .max(100, 'Merchant cannot exceed 100 characters')
    .optional()
    .nullable()
    .transform((val) => (val === undefined ? undefined : val && val.trim().length > 0 ? val.trim() : null)),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    amount_paise: z
      .number({ message: 'Amount must be a number in paise' })
      .int('Amount in paise must be an integer')
      .positive('Amount must be greater than 0')
      .optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    spent_on: z
      .string()
      .refine(isValidDateString, {
        message: 'Date must be a valid calendar date in YYYY-MM-DD format',
      })
      .optional(),
    note: z
      .string()
      .max(500, 'Note cannot exceed 500 characters')
      .optional()
      .nullable()
      .transform((val) => (val === undefined ? undefined : val && val.trim().length > 0 ? val.trim() : null)),
    merchant: z
      .string()
      .max(100, 'Merchant cannot exceed 100 characters')
      .optional()
      .nullable()
      .transform((val) => (val === undefined ? undefined : val && val.trim().length > 0 ? val.trim() : null)),
  })
  .refine(
    (data) =>
      data.amount_paise !== undefined ||
      data.category !== undefined ||
      data.spent_on !== undefined ||
      data.note !== undefined ||
      data.merchant !== undefined,
    {
      message: 'At least one field must be provided for update',
    }
  );

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const loginSchema = z.object({
  passcode: z.string({ message: 'Passcode is required' }).min(1, 'Passcode is required'),
});

export const budgetSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  monthly_limit_paise: z
    .number({ message: 'Monthly limit in paise is required' })
    .int('Monthly limit must be an integer in paise')
    .min(0, 'Monthly limit must be greater than or equal to 0'),
});

export type BudgetInput = z.infer<typeof budgetSchema>;

export const expenseQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
    .optional(),
  date: z
    .string()
    .refine(isValidDateString, { message: 'Date must be in YYYY-MM-DD format' })
    .optional(),
  from: z
    .string()
    .refine(isValidDateString, { message: 'from must be in YYYY-MM-DD format' })
    .optional(),
  to: z
    .string()
    .refine(isValidDateString, { message: 'to must be in YYYY-MM-DD format' })
    .optional(),
});
