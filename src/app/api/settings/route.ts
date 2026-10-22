import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { appSettings } from '@/db/schema';
import { recomputeAndPersistEngine } from '@/lib/engine/db';

/**
 * GET /api/settings
 * Returns user settings (savings target, onboarding status, etc.)
 */
export async function GET() {
  try {
    const rows = await db.select().from(appSettings);
    const settingsMap: Record<string, string> = {};
    for (const r of rows) {
      settingsMap[r.key] = r.value;
    }

    const savingsTargetRate = settingsMap['savings_target_rate']
      ? parseFloat(settingsMap['savings_target_rate'])
      : 0.20;
    const savingsTargetPct = Math.round(savingsTargetRate * 100);
    const onboardingDismissed = settingsMap['onboarding_dismissed'] === 'true';

    return NextResponse.json({
      savingsTargetRate,
      savingsTargetPct,
      onboardingDismissed,
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    return NextResponse.json(
      { error: 'Internal server error fetching settings' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings
 * Updates user settings (e.g. savings target rate, onboarding dismissed)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { savingsTargetPct, savingsTargetRate, onboardingDismissed } = body;

    let targetRate: number | undefined;
    if (typeof savingsTargetRate === 'number') {
      targetRate = Math.max(0.01, Math.min(0.90, savingsTargetRate));
    } else if (typeof savingsTargetPct === 'number') {
      targetRate = Math.max(0.01, Math.min(0.90, savingsTargetPct / 100));
    }

    if (targetRate !== undefined) {
      await db
        .insert(appSettings)
        .values({
          key: 'savings_target_rate',
          value: targetRate.toString(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            value: targetRate.toString(),
            updatedAt: new Date(),
          },
        });

      // Recompute engine so allowance immediately reflects new savings target
      await recomputeAndPersistEngine();
    }

    if (typeof onboardingDismissed === 'boolean') {
      await db
        .insert(appSettings)
        .values({
          key: 'onboarding_dismissed',
          value: onboardingDismissed.toString(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: {
            value: onboardingDismissed.toString(),
            updatedAt: new Date(),
          },
        });
    }

    const rows = await db.select().from(appSettings);
    const settingsMap: Record<string, string> = {};
    for (const r of rows) {
      settingsMap[r.key] = r.value;
    }

    const currentRate = settingsMap['savings_target_rate']
      ? parseFloat(settingsMap['savings_target_rate'])
      : 0.20;

    return NextResponse.json({
      success: true,
      savingsTargetRate: currentRate,
      savingsTargetPct: Math.round(currentRate * 100),
      onboardingDismissed: settingsMap['onboarding_dismissed'] === 'true',
    });
  } catch (err) {
    console.error('Error updating settings:', err);
    return NextResponse.json(
      { error: 'Internal server error updating settings' },
      { status: 500 }
    );
  }
}
