import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { schedules, budgets, appSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/onboarding
 * Checks progress of the 5 onboarding checklist items:
 * 1. add income
 * 2. add daily gold
 * 3. add subscriptions
 * 4. set budgets
 * 5. set savings target (Settings; default 20%)
 */
export async function GET() {
  try {
    const allSchedules = await db.select().from(schedules).where(eq(schedules.active, true));
    const allBudgets = await db.select().from(budgets);
    const settings = await db.select().from(appSettings);

    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    const hasIncome = allSchedules.some((s) => s.kind === 'income');
    const hasDailyGold = allSchedules.some(
      (s) => s.kind === 'investment' || s.name.toLowerCase().includes('gold')
    );
    const hasSubscriptions = allSchedules.some((s) => s.kind === 'subscription');
    const hasBudgets = allBudgets.length > 0;
    const hasSavingsTarget = Boolean(settingsMap['savings_target_rate']);
    const dismissed = settingsMap['onboarding_dismissed'] === 'true';

    const items = [
      { id: 'income', label: 'Add Monthly Income', done: hasIncome, href: '/commitments' },
      { id: 'gold', label: 'Add Daily Gold Investment', done: hasDailyGold, href: '/commitments' },
      { id: 'subscriptions', label: 'Add Recurring Subscriptions', done: hasSubscriptions, href: '/commitments' },
      { id: 'budgets', label: 'Set Category Budgets', done: hasBudgets, href: '/insights' },
      { id: 'savings', label: 'Set Savings Target (default 20%)', done: hasSavingsTarget, href: '/settings' },
    ];

    const allCompleted = items.every((i) => i.done);

    return NextResponse.json({
      items,
      allCompleted,
      dismissed,
      showChecklist: !dismissed && !allCompleted,
    });
  } catch (err) {
    console.error('Error fetching onboarding status:', err);
    return NextResponse.json(
      { error: 'Internal server error checking onboarding' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/onboarding
 * Dismisses the onboarding checklist
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dismissed = body.dismissed !== false;

    await db
      .insert(appSettings)
      .values({
        key: 'onboarding_dismissed',
        value: dismissed.toString(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: dismissed.toString(),
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, dismissed });
  } catch (err) {
    console.error('Error updating onboarding status:', err);
    return NextResponse.json(
      { error: 'Internal server error dismissing onboarding' },
      { status: 500 }
    );
  }
}
