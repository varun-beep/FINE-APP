import { pgTable, uuid, integer, text, date, timestamp, jsonb, boolean, index } from 'drizzle-orm/pg-core';

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    amountPaise: integer('amount_paise').notNull(),
    category: text('category').notNull(),
    note: text('note'),
    merchant: text('merchant'),
    spentOn: date('spent_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('expenses_spent_on_idx').on(table.spentOn),
    index('expenses_category_spent_on_idx').on(table.category, table.spentOn),
  ]
);

export const budgets = pgTable('budgets', {
  category: text('category').primaryKey(),
  monthlyLimitPaise: integer('monthly_limit_paise').notNull(),
});

export const reviews = pgTable('reviews', {
  reviewDate: date('review_date').primaryKey(),
  statsJson: jsonb('stats_json').notNull(),
  adviceJson: jsonb('advice_json'),
  source: text('source', { enum: ['llm', 'fallback'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ipHash: text('ip_hash').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
    succeeded: boolean('succeeded').notNull(),
  },
  (table) => [
    index('login_attempts_ip_hash_idx').on(table.ipHash, table.attemptedAt),
    index('login_attempts_attempted_at_idx').on(table.attemptedAt),
  ]
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;

