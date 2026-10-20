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
  'Subscriptions',
  'Investment',
  'Income',
  'EMI',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(val: string): boolean {
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
  kind: z.enum(['spend', 'investment', 'income']).default('spend'),
  source: z.enum(['manual', 'schedule']).default('manual'),
  schedule_id: z.string().uuid().nullable().optional(),
  one_off: z.boolean().default(false),
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
    kind: z.enum(['spend', 'investment', 'income']).optional(),
    source: z.enum(['manual', 'schedule']).optional(),
    schedule_id: z.string().uuid().nullable().optional(),
    one_off: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.amount_paise !== undefined ||
      data.category !== undefined ||
      data.spent_on !== undefined ||
      data.note !== undefined ||
      data.merchant !== undefined ||
      data.kind !== undefined ||
      data.source !== undefined ||
      data.schedule_id !== undefined ||
      data.one_off !== undefined,
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

export const SCHEDULE_KINDS = ['subscription', 'investment', 'bill', 'emi', 'income'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const createScheduleSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  kind: z.enum(SCHEDULE_KINDS),
  category: z.enum(EXPENSE_CATEGORIES),
  amount_paise: z.number().int().positive('Amount must be greater than 0'),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  anchor_date: z.string().refine(isValidDateString, { message: 'anchor_date must be YYYY-MM-DD' }),
  start_date: z.string().refine(isValidDateString, { message: 'start_date must be YYYY-MM-DD' }),
  end_date: z.string().refine(isValidDateString, { message: 'end_date must be YYYY-MM-DD' }).nullable().optional(),
  active: z.boolean().default(true),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  kind: z.enum(SCHEDULE_KINDS).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  amount_paise: z.number().int().positive().optional(),
  frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
  anchor_date: z.string().refine(isValidDateString).optional(),
  start_date: z.string().refine(isValidDateString).optional(),
  end_date: z.string().refine(isValidDateString).nullable().optional(),
  active: z.boolean().optional(),
  effective_from: z.string().refine(isValidDateString).optional(),
});

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export const DAY_CLOSURE_STATUSES = ['logged', 'no_spend', 'skipped'] as const;
export type DayClosureStatus = (typeof DAY_CLOSURE_STATUSES)[number];

export const createDayClosureSchema = z.object({
  day: z.string().refine(isValidDateString, { message: 'Day must be YYYY-MM-DD' }),
  status: z.enum(DAY_CLOSURE_STATUSES),
});

export type CreateDayClosureInput = z.infer<typeof createDayClosureSchema>;
