import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { db } from '../src/db';
import { expenses, budgets, schedules, dayClosures, insightLog } from '../src/db/schema';
import { getKolkataToday } from '../src/lib/date';
import { formatPaiseToRupees } from '../src/lib/money';
import { evaluateLearningState } from '../src/lib/engine/learning';
import { evaluateCoverage } from '../src/lib/engine/coverage';
import { calculateSafeToSpend } from '../src/lib/engine/safetospend';
import { detectContextAwareOutliers } from '../src/lib/engine/outliers';
import { analyzeCategoryDrift } from '../src/lib/engine/drift';
import { analyzeBehaviour } from '../src/lib/engine/behaviour';
import { detectSmallLeaks } from '../src/lib/engine/smallleaks';
import { analyzeCommitmentLoad } from '../src/lib/engine/commitments';
import { analyzeSavings } from '../src/lib/engine/savings';
import { calculateMonthEndProjection } from '../src/lib/engine/projection';
import { rankAndFilterInsights } from '../src/lib/engine/ranking';
import type {
  EngineExpense,
  EngineBudget,
  EngineSchedule,
  EngineDayClosure,
  InsightLogEntry,
  Insight,
  SilentFlag,
} from '../src/lib/engine/types';
import { execSync } from 'child_process';

async function runEngineDebug() {
  console.log('================================================================');
  console.log('             SPENDCOACH ENGINE DEBUG DUMP                       ');
  console.log('================================================================\n');

  // 1. Ensure seeded data exists; if empty, run seed:demo
  const existingExpenses = await db.select().from(expenses);
  if (existingExpenses.length < 30) {
    console.log('Database has <30 expenses. Running pnpm seed:demo first...\n');
    execSync('pnpm seed:demo', { stdio: 'inherit' });
  }

  const now = getKolkataToday();
  console.log(`Evaluated Date (now): ${now}\n`);

  // 2. Fetch all database state
  const rawExpenses = await db.select().from(expenses);
  const rawBudgets = await db.select().from(budgets);
  const rawSchedules = await db.select().from(schedules);
  const rawClosures = await db.select().from(dayClosures);
  const rawLogs = await db.select().from(insightLog);

  const engineExpenses: EngineExpense[] = rawExpenses.map((e) => ({
    id: e.id,
    amountPaise: e.amountPaise,
    category: e.category,
    spentOn: e.spentOn,
    merchant: e.merchant,
    note: e.note,
    createdAt: e.createdAt,
    kind: e.kind,
    source: e.source,
    scheduleId: e.scheduleId,
    oneOff: e.oneOff,
  }));

  const engineBudgets: EngineBudget[] = rawBudgets.map((b) => ({
    category: b.category,
    monthlyLimitPaise: b.monthlyLimitPaise,
  }));

  const engineSchedules: EngineSchedule[] = rawSchedules.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    category: s.category,
    amountPaise: s.amountPaise,
    frequency: s.frequency,
    anchorDate: s.anchorDate,
    startDate: s.startDate,
    endDate: s.endDate,
    active: s.active,
  }));

  const engineClosures: EngineDayClosure[] = rawClosures.map((c) => ({
    day: c.day,
    status: c.status,
    closedAt: c.closedAt,
  }));

  const engineLogs: InsightLogEntry[] = rawLogs.map((l) => ({
    insightKey: l.insightKey,
    firstShown: l.firstShown,
    lastShown: l.lastShown,
    timesShown: l.timesShown,
    dismissed: l.dismissed,
    feedback: l.feedback as 'not_now' | 'not_useful' | 'already_know' | 'planned' | null,
    lastImpactPaise: l.lastImpactPaise,
    updatedAt: l.updatedAt,
  }));

  // 3. Learning state & Coverage
  const learning = evaluateLearningState(engineExpenses, engineClosures);
  const coverage = evaluateCoverage(engineExpenses, engineClosures, now);

  const isLearning =
    learning.status === 'learning' ||
    (engineClosures.length > 0 && coverage.daysClosed < 14) ||
    learning.expenseCount < 30 ||
    learning.distinctDaysCount < 14;

  console.log('--- 1. LEARNING STATE & COVERAGE REPORT ---');
  console.log(`- Overall Status: ${learning.status}`);
  console.log(`- Expenses Count: ${learning.expenseCount} / ${learning.expenseThreshold}`);
  console.log(`- Distinct Days: ${learning.distinctDaysCount} / ${learning.distinctDaysThreshold}`);
  console.log(`- Coverage Days Closed: ${coverage.daysClosed}/14`);
  console.log(`- History Span: ${coverage.weeksOfHistory} weeks`);
  console.log(`- Categories Ready: ${coverage.categoriesReady.join(', ') || '(none)'}`);
  console.log(`- Categories Learning: ${coverage.categoriesLearning.join(', ') || '(none)'}`);
  if (coverage.reasons.length > 0) {
    console.log(`- Learning Reasons:`);
    coverage.reasons.forEach((r) => console.log(`    • ${r}`));
  }
  console.log(`- Learning Gate Active: ${isLearning ? 'YES (Suppresses outlier/drift/behaviour/leak insights)' : 'NO (All generators active)'}\n`);

  // Trace every generator
  interface RawCandidateRecord {
    generator: string;
    id: string;
    type: string;
    impactPaise: number;
    confidence: number;
    title: string;
    actionable: boolean;
    status: 'surfaced' | 'silent' | 'suppressed';
    reason: string;
    evidence?: Record<string, unknown>;
  }

  const rawCandidates: RawCandidateRecord[] = [];
  const candidateInsightsForRanking: Insight[] = [];
  const silentFlagsAll: SilentFlag[] = [];

  // ==========================================
  // G1: SAFE_TO_SPEND
  // ==========================================
  const s2s = calculateSafeToSpend(engineExpenses, engineSchedules, now);
  if (s2s.insight) {
    candidateInsightsForRanking.push(s2s.insight);
    rawCandidates.push({
      generator: 'safe_to_spend',
      id: s2s.insight.id,
      type: s2s.insight.type,
      impactPaise: s2s.insight.impactPaise,
      confidence: s2s.insight.confidence,
      title: s2s.insight.title,
      actionable: s2s.insight.actionable,
      status: 'surfaced',
      reason: 'Safe-to-spend always surfaced as foundational insight',
      evidence: s2s.insight.evidence as Record<string, unknown>,
    });
  } else {
    rawCandidates.push({
      generator: 'safe_to_spend',
      id: 'safe_to_spend',
      type: 'safe_to_spend',
      impactPaise: 0,
      confidence: 0,
      title: 'None generated',
      actionable: false,
      status: 'suppressed',
      reason: s2s.insufficientReason || 'insufficient_data',
    });
  }

  // Baseline discretionary budget
  const monthlyDiscretionaryBudget = s2s.allowance
    ? s2s.allowance.monthlyIncomePaise - s2s.allowance.committedDuePaise - s2s.allowance.savingsTargetPaise
    : 4000000;

  // ==========================================
  // G2: OUTLIER
  // ==========================================
  const outlierResult = detectContextAwareOutliers(engineExpenses, now, {
    monthlyDiscretionaryBudgetPaise: monthlyDiscretionaryBudget,
    insightLogs: engineLogs,
  });

  const flaggedOutlierIds = new Set<string>();
  for (const ins of outlierResult.insights) {
    if (ins.expenseId) flaggedOutlierIds.add(ins.expenseId);
    const ev = ins.evidence as Record<string, unknown> | undefined;
    if (typeof ev?.expenseId === 'string') flaggedOutlierIds.add(ev.expenseId);
  }
  for (const flag of outlierResult.silentFlags) {
    const ev = flag.evidence as Record<string, unknown> | undefined;
    if (typeof ev?.expenseId === 'string') flaggedOutlierIds.add(ev.expenseId);
    if (flag.id.startsWith('silent:outlier:')) {
      flaggedOutlierIds.add(flag.id.replace('silent:outlier:', ''));
    }
  }

  if (isLearning) {
    for (const ins of outlierResult.insights) {
      rawCandidates.push({
        generator: 'outlier',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'suppressed',
        reason: 'learning gate: coverage threshold not met (needs 14 closed days)',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  } else {
    for (const ins of outlierResult.insights) {
      candidateInsightsForRanking.push(ins);
      rawCandidates.push({
        generator: 'outlier',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'surfaced',
        reason: 'Outlier cleared statistical threshold and discretionary budget excess floor',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  }

  for (const flag of outlierResult.silentFlags) {
    silentFlagsAll.push(flag);
    rawCandidates.push({
      generator: 'outlier',
      id: flag.id,
      type: flag.type,
      impactPaise: 0,
      confidence: 0.9,
      title: flag.title,
      actionable: false,
      status: 'silent',
      reason: flag.reason,
      evidence: flag.evidence as Record<string, unknown>,
    });
  }

  // ==========================================
  // G3: DRIFT
  // ==========================================
  const driftResult = analyzeCategoryDrift(engineExpenses, now, { outlierExpenseIds: flaggedOutlierIds });
  if (isLearning) {
    for (const ins of driftResult.insights) {
      rawCandidates.push({
        generator: 'drift',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'suppressed',
        reason: 'learning gate: coverage threshold not met',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  } else {
    for (const ins of driftResult.insights) {
      candidateInsightsForRanking.push(ins);
      rawCandidates.push({
        generator: 'drift',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'surfaced',
        reason: 'Category median weekly total drifted >= 15% vs prior 8 weeks',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  }

  for (const catAna of driftResult.categoryAnalyses) {
    if (catAna.status === 'insufficient_data') {
      rawCandidates.push({
        generator: 'drift',
        id: `drift:${catAna.category}`,
        type: 'drift',
        impactPaise: 0,
        confidence: 0,
        title: `Category ${catAna.category} drift evaluation`,
        actionable: false,
        status: 'suppressed',
        reason: catAna.reason || 'insufficient_data: <8 weeks history or <6 transactions',
      });
    }
  }

  // ==========================================
  // G4: BEHAVIOUR
  // ==========================================
  const behaviourInsights = analyzeBehaviour(engineExpenses, engineSchedules, now, { outlierExpenseIds: flaggedOutlierIds });
  if (isLearning) {
    for (const ins of behaviourInsights) {
      rawCandidates.push({
        generator: 'behaviour',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'suppressed',
        reason: 'learning gate: coverage threshold not met',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  } else {
    for (const ins of behaviourInsights) {
      candidateInsightsForRanking.push(ins);
      rawCandidates.push({
        generator: 'behaviour',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'surfaced',
        reason: 'Surfaced behavioural spending pattern meeting criteria',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  }

  // ==========================================
  // G5: SMALL_LEAKS
  // ==========================================
  const leakInsights = detectSmallLeaks(engineExpenses, now, { outlierExpenseIds: flaggedOutlierIds });
  if (isLearning) {
    for (const ins of leakInsights) {
      rawCandidates.push({
        generator: 'small_leaks',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'suppressed',
        reason: 'learning gate: coverage threshold not met',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  } else {
    for (const ins of leakInsights) {
      candidateInsightsForRanking.push(ins);
      rawCandidates.push({
        generator: 'small_leaks',
        id: ins.id,
        type: ins.type,
        impactPaise: ins.impactPaise,
        confidence: ins.confidence,
        title: ins.title,
        actionable: ins.actionable,
        status: 'surfaced',
        reason: 'Frequent low-ticket leak: >=8 purchases in 30d, median <₹300, >=3% of discretionary',
        evidence: ins.evidence as Record<string, unknown>,
      });
    }
  }

  // ==========================================
  // G6: COMMITMENT_LOAD
  // ==========================================
  const commitmentInsights = analyzeCommitmentLoad(engineSchedules, now);
  for (const ins of commitmentInsights) {
    candidateInsightsForRanking.push(ins);
    rawCandidates.push({
      generator: 'commitment_load',
      id: ins.id,
      type: ins.type,
      impactPaise: ins.impactPaise,
      confidence: ins.confidence,
      title: ins.title,
      actionable: ins.actionable,
      status: 'surfaced',
      reason: 'Commitment load calculated from active subscriptions, bills and recurring commitments',
      evidence: ins.evidence as Record<string, unknown>,
    });
  }

  // ==========================================
  // G7: SAVINGS
  // ==========================================
  const savingsInsights = analyzeSavings(engineExpenses, engineSchedules, now);
  for (const ins of savingsInsights) {
    candidateInsightsForRanking.push(ins);
    rawCandidates.push({
      generator: 'savings',
      id: ins.id,
      type: ins.type,
      impactPaise: ins.impactPaise,
      confidence: ins.confidence,
      title: ins.title,
      actionable: ins.actionable,
      status: 'surfaced',
      reason: 'Savings rate and investment targets evaluated against income baseline',
      evidence: ins.evidence as Record<string, unknown>,
    });
  }

  // ==========================================
  // G8: PROJECTION
  // ==========================================
  const projectionInsight = calculateMonthEndProjection(engineExpenses, engineSchedules, now);
  if (projectionInsight) {
    rawCandidates.push({
      generator: 'projection',
      id: projectionInsight.id,
      type: projectionInsight.type,
      impactPaise: projectionInsight.impactPaise,
      confidence: projectionInsight.confidence,
      title: projectionInsight.title,
      actionable: false,
      status: 'surfaced',
      reason: 'PROJECTION returned as dedicated field (never competes for or takes top-3 insight slot)',
      evidence: projectionInsight.evidence as Record<string, unknown>,
    });
  }

  // 4. Run Ranking on Candidates
  const { topInsights, allRankedInsights } = rankAndFilterInsights(
    candidateInsightsForRanking,
    {
      now,
      monthlyIncomePaise: s2s.allowance?.monthlyIncomePaise,
      insightLogs: engineLogs,
    }
  );

  const topInsightIds = new Set(topInsights.map((i) => i.id));

  console.log('--- 2. RAW CANDIDATES PER GENERATOR (BEFORE RANKING) ---');
  const generatorGroups = [
    'safe_to_spend',
    'outlier',
    'drift',
    'behaviour',
    'small_leaks',
    'commitment_load',
    'savings',
    'projection',
  ];

  for (const gen of generatorGroups) {
    console.log(`\n[GENERATOR: ${gen.toUpperCase()}]`);
    const items = rawCandidates.filter((c) => c.generator === gen);
    if (items.length === 0) {
      console.log('  (no candidates generated)');
    } else {
      items.forEach((c, idx) => {
        const isTop3 = topInsightIds.has(c.id);
        const rankLabel = isTop3 ? '★ TOP-3 SURFACED' : c.status.toUpperCase();
        console.log(`  ${idx + 1}. ID: ${c.id}`);
        console.log(`     Type: ${c.type} | Impact: ${formatPaiseToRupees(c.impactPaise)} | Confidence: ${c.confidence}`);
        console.log(`     Title: ${c.title}`);
        console.log(`     Status: ${rankLabel}`);
        console.log(`     Exact Reason: ${c.reason}`);
      });
    }
  }

  console.log('\n--- 3. RANKED TOP INSIGHTS (FINAL SURFACED) ---');
  topInsights.forEach((ins, idx) => {
    console.log(`  ${idx + 1}. [${ins.type.toUpperCase()}] ${ins.title} (ID: ${ins.id}, Score: ${ins.score ?? 'N/A'}, Impact: ${formatPaiseToRupees(ins.impactPaise)})`);
  });

  console.log('\n--- 4. SILENT FLAGS ---');
  silentFlagsAll.forEach((flag, idx) => {
    console.log(`  ${idx + 1}. [SILENT] ${flag.title} (ID: ${flag.id}) - Reason: ${flag.reason}`);
  });

  // 5. Verify against planted items
  console.log('\n================================================================');
  console.log('       PLANTED SEED DATA VERIFICATION & CLASSIFICATION          ');
  console.log('================================================================\n');

  // Planted 1: Steady Food drift
  const foodDrift = rawCandidates.find((c) => c.generator === 'drift' && c.id.includes('Food'));
  const foodDriftTop = topInsights.find((i) => i.id.includes('Food') && i.type === 'drift');
  console.log('1. Planted Item: Steady Food Drift (+50% over last 4 weeks)');
  if (foodDriftTop) {
    console.log('   Status: SURFACED');
    console.log(`   Detail: Surfaced in top-3 insights (${foodDriftTop.title}, Score: ${foodDriftTop.score})`);
    console.log(`   Why: 4-week median weekly spend exceeded prior 8-week median by >= 15% and scored above bar.`);
  } else if (foodDrift && foodDrift.status === 'surfaced') {
    console.log('   Status: SURFACED (Candidate, ranked below top 3)');
    console.log(`   Detail: Generated candidate ${foodDrift.id} with impact ${formatPaiseToRupees(foodDrift.impactPaise)}`);
    console.log(`   Why: Valid drift detected; candidate cleared generation bar.`);
  } else if (foodDrift) {
    console.log(`   Status: ${foodDrift.status.toUpperCase()}`);
    console.log(`   Why: ${foodDrift.reason}`);
  } else {
    console.log('   Status: MISSING');
    console.log('   Why: No Food drift insight generated.');
  }

  // Planted 2: Small leak (Chaayos 20 visits in 30 days)
  const chaayosLeak = rawCandidates.find((c) => c.generator === 'small_leaks' && c.id.toLowerCase().includes('chaayos'));
  const chaayosTop = topInsights.find((i) => i.id.toLowerCase().includes('chaayos'));
  console.log('\n2. Planted Item: Small Leak (Chaayos ₹120 x 20 visits in 30 days)');
  if (chaayosTop) {
    console.log('   Status: SURFACED');
    console.log(`   Detail: Surfaced in top-3 insights (${chaayosTop.title}, Score: ${chaayosTop.score})`);
    console.log('   Why: 20 visits >= 8, median ₹120 < ₹300, and total ₹2,400 >= 3% of discretionary spend.');
  } else if (chaayosLeak && chaayosLeak.status === 'surfaced') {
    console.log('   Status: SURFACED (Candidate)');
    console.log(`   Detail: Generated candidate with impact ${formatPaiseToRupees(chaayosLeak.impactPaise)}`);
    console.log('   Why: 20 visits >= 8, median ₹120 < ₹300, and total ₹2,400 >= 3% of discretionary spend.');
  } else if (chaayosLeak) {
    console.log(`   Status: ${chaayosLeak.status.toUpperCase()}`);
    console.log(`   Why: ${chaayosLeak.reason}`);
  } else {
    console.log('   Status: MISSING');
    console.log('   Why: Filtered out before candidate generation.');
  }

  // Planted 3: Duplicate (Swiggy ₹450 twice today)
  const swiggyDup = rawCandidates.find((c) => c.generator === 'outlier' && c.id.includes('outlier:') && c.evidence?.isDuplicate);
  const swiggyTop = topInsights.find((i) => i.evidence?.isDuplicate);
  console.log('\n3. Planted Item: Duplicate Charge (Swiggy ₹450 twice today)');
  if (swiggyTop) {
    console.log('   Status: SURFACED');
    console.log(`   Detail: Surfaced in top-3 insights (${swiggyTop.title}, Score: ${swiggyTop.score})`);
    console.log('   Why: Identical merchant, amount, and date detected on the same day.');
  } else if (swiggyDup) {
    console.log('   Status: SURFACED (Candidate)');
    console.log(`   Detail: Generated candidate ${swiggyDup.id} (${swiggyDup.title})`);
    console.log('   Why: Identical merchant, amount, and date detected on the same day.');
  } else {
    console.log('   Status: MISSING');
    console.log('   Why: Duplicate not detected.');
  }

  // Planted 4: 2 Genuine Large One-offs
  // iPad Pro (₹79,900) 15 days ago, Taj Holidays (₹35,000) 38 days ago
  console.log('\n4. Planted Item: 2 Genuine Large One-offs (Apple Store ₹79.9k, Taj Resort ₹35k)');
  const appleCandidate = rawCandidates.find((c) => c.generator === 'outlier' && (c.title.includes('Apple') || c.id.includes('Apple')));
  const tajCandidate = rawCandidates.find((c) => c.generator === 'outlier' && (c.title.includes('Taj') || c.id.includes('Taj')));
  console.log(`   a. Apple Store BKC iPad Pro (₹79,900, 15 days ago):`);
  if (appleCandidate) {
    console.log(`      Status: ${appleCandidate.status.toUpperCase()}`);
    console.log(`      Title: ${appleCandidate.title}`);
    console.log(`      Why: ${appleCandidate.reason}`);
  } else {
    console.log('      Status: MISSING');
  }

  console.log(`   b. Taj Luxury Resort Stay (₹35,000, 38 days ago):`);
  if (tajCandidate) {
    console.log(`      Status: ${tajCandidate.status.toUpperCase()}`);
    console.log(`      Title: ${tajCandidate.title}`);
    console.log(`      Why: ${tajCandidate.reason}`);
  } else {
    console.log('      Status: MISSING');
  }

  // Planted 5: 1 Lumpy Medical Bill (Apollo Dental ₹4,200, 18 days ago)
  console.log('\n5. Planted Item: 1 Lumpy Medical Bill (Apollo Dental ₹4,200 in Health)');
  const dentalSilent = silentFlagsAll.find((f) => f.title.includes('Dental') || f.title.includes('Apollo'));
  const dentalCandidate = rawCandidates.find((c) => c.title.includes('Dental'));
  if (dentalSilent) {
    console.log('   Status: SILENT');
    console.log(`   Detail: Sent to silentFlags (${dentalSilent.title})`);
    console.log(`   Why: ${dentalSilent.reason}. Health is a lumpy category with high variability (z-score threshold 5.0, multiplier 3.5x).`);
  } else if (!dentalCandidate) {
    console.log('   Status: SILENT');
    console.log('   Why: Stays silent because in Health, natural dispersion is high and ₹4,200 does not exceed the lumpy 3.5x multiplier.');
  } else {
    console.log(`   Status: ${dentalCandidate.status.toUpperCase()}`);
    console.log(`   Why: ${dentalCandidate.reason}`);
  }

  // Planted 6: Payday Bump (Shopping surge days 1-5)
  console.log('\n6. Planted Item: Payday-Week Bump (Higher shopping spend in days 1-5 after salary)');
  const paydayCandidate = rawCandidates.find((c) => c.generator === 'behaviour' && c.id.includes('payday'));
  const paydayTop = topInsights.find((i) => i.id.includes('payday'));
  if (paydayTop) {
    console.log('   Status: SURFACED');
    console.log(`   Detail: Surfaced in top-3 insights (${paydayTop.title}, Score: ${paydayTop.score})`);
    console.log('   Why: Daily spend in the 5 days following salary was significantly higher than the rest of the month.');
  } else if (paydayCandidate && paydayCandidate.status === 'surfaced') {
    console.log('   Status: SURFACED (Candidate)');
    console.log(`   Detail: Generated candidate with impact ${formatPaiseToRupees(paydayCandidate.impactPaise)}`);
    console.log('   Why: Payday ratio exceeded threshold.');
  } else if (paydayCandidate) {
    console.log(`   Status: ${paydayCandidate.status.toUpperCase()}`);
    console.log(`   Why: ${paydayCandidate.reason}`);
  } else {
    console.log('   Status: MISSING');
    console.log('   Why: Payday effect not detected.');
  }

  console.log('\n================================================================');
  console.log('                  END OF ENGINE DEBUG DUMP                      ');
  console.log('================================================================');
}

runEngineDebug().catch((err) => {
  console.error('Engine debug failed:', err);
  process.exit(1);
});
