import {
  pgTable,
  uuid,
  integer,
  text,
  date,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['subscription', 'investment', 'bill', 'emi', 'income'],
    }).notNull(),
    category: text('category').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    frequency: text('frequency', {
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
    }).notNull(),
    anchorDate: date('anchor_date').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    active: boolean('active').default(true).notNull(),
    lastPostedThrough: date('last_posted_through'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('schedules_active_idx').on(table.active),
    index('schedules_kind_idx').on(table.kind),
  ]
);

export const schedulePriceHistory = pgTable(
  'schedule_price_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('price_history_schedule_effective_idx').on(table.scheduleId, table.effectiveFrom),
  ]
);

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
    kind: text('kind', { enum: ['spend', 'investment', 'income'] })
      .notNull()
      .default('spend'),
    source: text('source', { enum: ['manual', 'schedule'] })
      .notNull()
      .default('manual'),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    oneOff: boolean('one_off').notNull().default(false),
  },
  (table) => [
    index('expenses_spent_on_idx').on(table.spentOn),
    index('expenses_category_spent_on_idx').on(table.category, table.spentOn),
    uniqueIndex('expenses_schedule_spent_on_idx')
      .on(table.scheduleId, table.spentOn)
      .where(sql`schedule_id IS NOT NULL`),
  ]
);

export const dayClosures = pgTable('day_closures', {
  day: date('day').primaryKey(),
  status: text('status', { enum: ['logged', 'no_spend', 'skipped'] }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const budgets = pgTable('budgets', {
  category: text('category').primaryKey(),
  monthlyLimitPaise: integer('monthly_limit_paise').notNull(),
});

export const reviews = pgTable(
  'reviews',
  {
    periodType: text('period_type', { enum: ['daily', 'weekly', 'monthly'] })
      .notNull()
      .default('daily'),
    reviewDate: date('review_date').notNull(),
    statsJson: jsonb('stats_json').notNull(),
    adviceJson: jsonb('advice_json'),
    source: text('source', { enum: ['llm', 'fallback'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.periodType, table.reviewDate] }),
    index('reviews_period_date_idx').on(table.periodType, table.reviewDate),
  ]
);

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

export const insightLog = pgTable(
  'insight_log',
  {
    insightKey: text('insight_key').primaryKey(),
    firstShown: timestamp('first_shown', { withTimezone: true }).defaultNow().notNull(),
    lastShown: timestamp('last_shown', { withTimezone: true }).defaultNow().notNull(),
    timesShown: integer('times_shown').default(1).notNull(),
    dismissed: boolean('dismissed').default(false).notNull(),
    feedback: text('feedback'),
    lastImpactPaise: integer('last_impact_paise'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('insight_log_last_shown_idx').on(table.lastShown),
    index('insight_log_dismissed_idx').on(table.dismissed),
  ]
);

export const experiments = pgTable(
  'experiments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leverId: text('lever_id').notNull(),
    category: text('category').notNull(),
    metric: text('metric').notNull(),
    target: text('target').notNull(),
    baseline: integer('baseline').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status', { enum: ['active', 'completed', 'abandoned'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('experiments_status_idx').on(table.status),
    index('experiments_category_status_idx').on(table.category, table.status),
  ]
);

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type SchedulePriceHistory = typeof schedulePriceHistory.$inferSelect;
export type NewSchedulePriceHistory = typeof schedulePriceHistory.$inferInsert;
export type DayClosure = typeof dayClosures.$inferSelect;
export type NewDayClosure = typeof dayClosures.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;
export type InsightLog = typeof insightLog.$inferSelect;
export type NewInsightLog = typeof insightLog.$inferInsert;
export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;

