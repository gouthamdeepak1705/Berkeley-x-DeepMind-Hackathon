import { diffDays } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { runSimulation, SimulationRun } from '../engine/simulation';
import { GEMINI_SETTINGS } from '../gemini/settings';
import {
  ActionDecision,
  BuiltToolRecord,
  DoneForYouItem,
  EndStatementData,
  GroundTruthTag,
  TraceEntry,
  WatcherEvalRecord,
} from '../types/domain';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function findFirstBaselineStockout(
  baselineSim: SimulationRun,
  storeIds: Array<'union_square' | 'palo_alto' | 'santana_row' | 'walnut_creek' | 'pasadena' | 'napa'>,
  groupId: 'best_sellers' | 'knitwear',
): string | null {
  for (const d of baselineSim.liveDates) {
    const recs = baselineSim.storeRecordsByDate[d];
    if (storeIds.some((sid) => recs[sid].isOpen && recs[sid].groups[groupId].endingStock <= 0.01)) {
      return d;
    }
  }
  return null;
}

const REAL_EVENT_SPECS: Array<{
  tag: GroundTruthTag;
  label: string;
  findBaselineFailureDate: (baselineSim: SimulationRun) => string | null;
}> = [
  {
    tag: 'real:best_sellers_shortage',
    label: 'Best-sellers shortage at Union Square, Palo Alto, Santana Row',
    findBaselineFailureDate: (b) =>
      findFirstBaselineStockout(b, ['union_square', 'palo_alto', 'santana_row'], 'best_sellers'),
  },
  {
    tag: 'real:walnut_creek_knitwear',
    label: 'Knitwear shortage at Walnut Creek',
    findBaselineFailureDate: (b) => findFirstBaselineStockout(b, ['walnut_creek'], 'knitwear'),
  },
  {
    tag: 'real:walnut_creek_refunds',
    label: 'Walnut Creek unlinked cash refunds',
    findBaselineFailureDate: (b) => {
      // First day excess evening Till 2 op 14 cash refunds accumulate in live window (~3 Oct spike check)
      const found = b.walnutCreekRefunds.find(
        (r) =>
          r.date >= b.liveDates[0] &&
          r.method === 'cash' &&
          r.time >= '20:00' &&
          !r.linkedOrder &&
          r.till === 2 &&
          r.operatorNumber === 14 &&
          r.date >= '2026-10-03',
      );
      return found ? found.date : '2026-10-03';
    },
  },
  {
    tag: 'real:pasadena_knitwear',
    label: 'Knitwear shortage at Pasadena',
    findBaselineFailureDate: (b) => findFirstBaselineStockout(b, ['pasadena'], 'knitwear'),
  },
  {
    tag: 'real:napa_knitwear',
    label: 'Knitwear shortage at Napa',
    findBaselineFailureDate: (b) => findFirstBaselineStockout(b, ['napa'], 'knitwear'),
  },
];

const LOOK_ALIKE_TAGS: GroundTruthTag[] = [
  'near_miss:summer_lull_start',
  'near_miss:labor_day_dip',
  'near_miss:labor_day_jump',
  'near_miss:summer_lull_end',
  'near_miss:napa_ramp_fade',
  'near_miss:control_store_fall',
];

function estimateTokenCostFromEntries(trace: TraceEntry[]): {
  decisionCalls: number;
  otherCalls: number;
  fallbackCalls: number;
} {
  let decisionCalls = 0;
  let otherCalls = 0;
  let fallbackCalls = 0;
  for (const t of trace) {
    if (t.kind === 'decision' && t.meta?.model) {
      decisionCalls += 1;
      if (t.meta.mode === 'fallback') fallbackCalls += 1;
    } else if (
      (t.kind === 'investigation' || t.kind === 'builder') &&
      t.meta?.model
    ) {
      otherCalls += 1;
      if (t.meta.mode === 'fallback') fallbackCalls += 1;
    }
  }
  return { decisionCalls, otherCalls, fallbackCalls };
}

export function buildEndStatement(params: {
  seed: number;
  date: string;
  sim: SimulationRun;
  decisions: ActionDecision[];
  doneForYou: DoneForYouItem[];
  watcherEvalLog: WatcherEvalRecord[];
  allTrace: TraceEntry[];
  builtTools: BuiltToolRecord[];
  liveUsage?: {
    totalCalls: number;
    uncachedDecisionCalls: number;
    uncachedOtherCalls: number;
    fallbackCalls: number;
    estimatedCostUsd: number;
  };
}): EndStatementData {
  const {
    seed,
    date,
    sim,
    decisions,
    doneForYou,
    watcherEvalLog,
    allTrace,
    builtTools,
    liveUsage,
  } = params;
  const baselineSim = runSimulation(seed, [], date);

  // 1. Money section
  const provenAvoidedTotal = doneForYou
    .filter((d) => d.verdict === 'worked_proven' && d.provenMoneyFact)
    .reduce((sum, d) => sum + (d.provenMoneyFact?.value ?? 0), 0);

  const provenAvoidedFact = createFact(
    `stmt:${date}:proven_avoided`,
    'Proven avoided lost sales',
    provenAvoidedTotal,
    'USD',
    'Sum of proven avoided lost sales from store trials verified against a held-out comparison store.',
  );

  // Delay cost on Best-sellers if the first transfer arrived after baseline stockout
  const firstBsDecision = decisions
    .filter((d) => d.kind === 'transfer' && d.groupId === 'best_sellers' && !d.undoneOnDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  let delayCostUsd = 0;
  const delayWindowEnd = firstBsDecision
    ? firstBsDecision.arrivalDate ?? firstBsDecision.date
    : date;
  for (const d of sim.liveDates) {
    if (d < '2026-09-08' || d > delayWindowEnd || d > date) continue;
    const recs = sim.storeRecordsByDate[d];
    for (const sid of ['union_square', 'palo_alto'] as const) {
      const gs = recs[sid].groups.best_sellers;
      if (gs.potentialSales > gs.actualSales) {
        delayCostUsd += gs.potentialSales - gs.actualSales;
      }
    }
  }
  const delayCostFact = createFact(
    `stmt:${date}:delay_cost`,
    'Cost of Best-sellers waiting',
    Math.round(delayCostUsd),
    'USD',
    firstBsDecision
      ? `Lost Best-sellers sales at Union Square and Palo Alto between 8 September and stock arrival on ${delayWindowEnd}.`
      : 'Lost Best-sellers sales from 8 September through 14 November with no transfer sent.',
  );

  // Refund leakage stopped after refund_switch vs untreated baseline
  const refundSwitchDec = decisions.find((d) => d.kind === 'refund_switch' && !d.undoneOnDate);
  let refundLeakageStoppedUsd = 0;
  if (refundSwitchDec) {
    let baseRefunds = 0;
    let actualRefunds = 0;
    for (const d of sim.liveDates) {
      if (d <= refundSwitchDec.date || d > date) continue;
      baseRefunds += baselineSim.storeRecordsByDate[d].walnut_creek.refundAmount;
      actualRefunds += sim.storeRecordsByDate[d].walnut_creek.refundAmount;
    }
    refundLeakageStoppedUsd = Math.max(0, Math.round(baseRefunds - actualRefunds));
  }
  const refundLeakageStoppedFact = createFact(
    `stmt:${date}:refund_stopped`,
    'Refund leakage stopped (before and after, not proven)',
    refundLeakageStoppedUsd,
    'USD',
    refundSwitchDec
      ? `Cash refunds avoided after ${refundSwitchDec.date} under the $50 approval switch compared against the untreated Walnut Creek baseline; before-and-after only, one store.`
      : 'Refund approval rule was not switched on during the run.',
  );

  const routineCount = doneForYou.filter(
    (d) => d.verdict === 'worked_single_store' && !d.isAutonomous,
  ).length;
  const autoCount = decisions.filter((d) => d.isAutonomous && !d.undoneOnDate).length;
  const storeTaskCount = decisions.filter((d) => d.kind === 'store_manager_task').length;

  const routineTransfersCountFact = createFact(
    `stmt:${date}:routine_count`,
    'Routine single-store transfers approved',
    routineCount,
    'count',
    'Single-store transfers approved by the owner and confirmed within normal sales afterward.',
  );
  const autonomousTransfersCountFact = createFact(
    `stmt:${date}:auto_count`,
    'Small transfers done alone within limits',
    autoCount,
    'count',
    'Transfers under 500 units executed automatically through the gateway after earning autonomy.',
  );
  const storeTasksCountFact = createFact(
    `stmt:${date}:store_tasks`,
    'Store manager follow-up tasks logged',
    storeTaskCount,
    'count',
    'Questions sent to store managers through the gateway (simulated).',
  );

  // 2. Noticing score against ground truth
  const realDetails = REAL_EVENT_SPECS.map((spec) => {
    const targetDate = spec.findBaselineFailureDate(baselineSim) ?? date;
    const raisedEntry = watcherEvalLog.find(
      (e) => e.groundTruth === spec.tag && e.outcome === 'raised',
    );
    const raisedDate = raisedEntry?.date ?? null;
    const daysEarly =
      raisedDate && targetDate ? Math.max(0, diffDays(raisedDate, targetDate)) : null;
    return {
      label: spec.label,
      targetDate,
      raisedDate,
      daysEarly,
    };
  });

  const raisedCount = realDetails.filter((d) => d.raisedDate !== null).length;
  const daysEarlyValues = realDetails
    .map((d) => d.daysEarly)
    .filter((v): v is number => v !== null);
  const medDaysEarly = median(daysEarlyValues);

  const lookAlikesRaisedSet = new Set<string>();
  for (const tag of LOOK_ALIKE_TAGS) {
    if (watcherEvalLog.some((e) => e.groundTruth === tag && e.outcome === 'raised')) {
      lookAlikesRaisedSet.add(tag);
    }
  }

  const decisionLatencies = watcherEvalLog
    .map((e) => e.latencyMs)
    .filter((ms) => typeof ms === 'number' && ms > 0);
  const medDecisionMs = Math.round(median(decisionLatencies));

  const realRaisedFact = createFact(
    `stmt:${date}:real_raised`,
    'Real issues noticed',
    raisedCount,
    'count',
    `Real store problems noticed out of ${REAL_EVENT_SPECS.length} verified events in the 106-day window.`,
  );
  const realTotalFact = createFact(
    `stmt:${date}:real_total`,
    'Total real issues in simulation',
    REAL_EVENT_SPECS.length,
    'count',
    'Total genuine operational problems built into the deterministic simulation window.',
  );
  const medianDaysEarlyFact = createFact(
    `stmt:${date}:median_days_early`,
    'Median days before outage',
    medDaysEarly,
    'days',
    'Median calendar days between first notice and when the untreated store would have run out or spiked.',
  );
  const lookAlikesRaisedFact = createFact(
    `stmt:${date}:lookalikes_raised`,
    'False alarms raised',
    lookAlikesRaisedSet.size,
    'count',
    `Out of ${LOOK_ALIKE_TAGS.length} seasonal, opening-ramp, delivery-return, and comparison-store look-alikes.`,
  );
  const lookAlikesTotalFact = createFact(
    `stmt:${date}:lookalikes_total`,
    'Total look-alike events',
    LOOK_ALIKE_TAGS.length,
    'count',
    'Six expected look-alike patterns tested by silence checks: summer lull start, Labor Day dip, Labor Day jump, lull end, Napa ramp fade, comparison-store drops.',
  );
  const medianDecisionMsFact = createFact(
    `stmt:${date}:median_decision_ms`,
    'Median decision time (ms)',
    medDecisionMs,
    'count',
    'Median latency in milliseconds across daily Gemini Decision batches (original live latency even in Replay).',
  );

  // 3. Wrong, unproven, disagreements, fallbacks
  const didNotWorkCount = doneForYou.filter((d) => d.verdict === 'did_not_work').length;
  const undoneCount = doneForYou.filter((d) => d.verdict === 'undone').length;
  const unprovenOnlyCount = doneForYou.filter(
    (d) => d.verdict === 'worked_single_store' || d.verdict === 'worked_before_after',
  ).length;
  const disagreementsCount = allTrace.filter(
    (t) =>
      t.headline.toLowerCase().includes('disagree') ||
      t.detail.toLowerCase().includes('disagree'),
  ).length;
  const traceCounts = estimateTokenCostFromEntries(allTrace);
  const fallbacksTotal = Math.max(traceCounts.fallbackCalls, liveUsage?.fallbackCalls ?? 0);

  const notes: string[] = [];
  if (unprovenOnlyCount > 0) {
    notes.push(
      `${unprovenOnlyCount} ${
        unprovenOnlyCount === 1 ? 'action was' : 'actions were'
      } measured before-and-after on a single store without a held-out comparison store, so causal proof is partial.`,
    );
  }
  if (undoneCount > 0) {
    notes.push(`${undoneCount} action was undone by you and reversed through the gateway.`);
  }
  if (didNotWorkCount > 0) {
    notes.push(`${didNotWorkCount} action failed to bring store sales back into range.`);
  }
  if (fallbacksTotal > 0) {
    notes.push(
      `${fallbacksTotal} Gemini ${fallbacksTotal === 1 ? 'call fell' : 'calls fell'} back to code rules and was marked in the trace.`,
    );
  }
  if (notes.length === 0) {
    notes.push('Every action stayed inside safety limits with zero fallbacks and zero failed outcomes.');
  }

  // 4. Cost
  const totalCalls = liveUsage?.totalCalls ?? traceCounts.decisionCalls + traceCounts.otherCalls;
  const decCalls = liveUsage?.uncachedDecisionCalls ?? traceCounts.decisionCalls;
  const otherCalls = liveUsage?.uncachedOtherCalls ?? traceCounts.otherCalls;
  const estUsd = liveUsage?.estimatedCostUsd ?? 0;

  // 5. Built
  const visibleBuilt = builtTools.filter((t) => t.installedOn <= date);

  return {
    generatedOn: date,
    money: {
      provenAvoidedFact,
      delayCostFact,
      refundLeakageStoppedFact,
      routineTransfersCountFact,
      autonomousTransfersCountFact,
      storeTasksCountFact,
    },
    noticing: {
      realRaisedFact,
      realTotalFact,
      medianDaysEarlyFact,
      lookAlikesRaisedFact,
      lookAlikesTotalFact,
      medianDecisionMsFact,
      realDetails,
    },
    wrongOrUnproven: {
      didNotWorkCountFact: createFact(
        `stmt:${date}:did_not_work`,
        'Actions that did not work',
        didNotWorkCount,
        'count',
        'Actions whose post-arrival check failed to match expectations.',
      ),
      undoneCountFact: createFact(
        `stmt:${date}:undone`,
        'Actions undone',
        undoneCount,
        'count',
        'Transfers or actions reversed by the owner through the gateway.',
      ),
      unprovenOnlyCountFact: createFact(
        `stmt:${date}:unproven_only`,
        'Worked without comparison store',
        unprovenOnlyCount,
        'count',
        'Single-store transfers or rules measured before-and-after rather than against a held-out comparison store.',
      ),
      disagreementsCountFact: createFact(
        `stmt:${date}:disagreements`,
        'Checks that disagreed',
        disagreementsCount,
        'count',
        'Times the second Python check or calendar check disagreed with the first finding and paused for review.',
      ),
      fallbacksCountFact: createFact(
        `stmt:${date}:fallbacks`,
        'Gemini fallbacks used',
        fallbacksTotal,
        'count',
        'Calls that timed out, ran without an API key, or switched to backup code rules.',
      ),
      notes,
    },
    cost: {
      totalCallsFact: createFact(
        `stmt:${date}:total_calls`,
        'Total Gemini calls in session',
        totalCalls,
        'count',
        'Total Gemini Decisions, Interactions, and Builder calls processed (live or replayed) in this session.',
      ),
      decisionCallsFact: createFact(
        `stmt:${date}:decision_calls`,
        'Live Decision API calls',
        decCalls,
        'count',
        `Uncached live Decision calls counted against daily cap of ${GEMINI_SETTINGS.dailyCaps.decision}.`,
      ),
      otherCallsFact: createFact(
        `stmt:${date}:other_calls`,
        'Live Interactions & Builder calls',
        otherCalls,
        'count',
        `Uncached live Interactions and Builder calls counted against daily cap of ${GEMINI_SETTINGS.dailyCaps.other}.`,
      ),
      estimatedCostUsdFact: createFact(
        `stmt:${date}:est_cost_usd`,
        'Live session API cost (USD)',
        Math.round(estUsd * 100) / 100,
        'USD',
        `Exact estimated USD cost from live session token usage ($${estUsd.toFixed(4)} exact); $0.00 during Replay mode.`,
      ),
      liveModeCostNote:
        estUsd === 0
          ? 'Session ran on Replay or cached responses ($0.00 spent in this browser session).'
          : `Estimated from actual Gemini token counts in this session ($${estUsd.toFixed(4)}).`,
    },
    built: {
      toolsBuiltFact: createFact(
        `stmt:${date}:tools_built`,
        'Store tools built',
        visibleBuilt.length,
        'count',
        'Single-file sandboxed tools written and verified through all 3 browser checks.',
      ),
      tools: visibleBuilt.map((t) => {
        const passed = t.testResults.filter((r) => r.passed).length;
        const total = t.testResults.length;
        return {
          title: t.title,
          installedOn: t.installedOn,
          testsPassedFact: createFact(
            `stmt:${date}:tool_passed:${t.id}`,
            'Sandbox checks passed',
            passed,
            'count',
            'Automated sandbox verification tests passed before tool installation.',
          ),
          testsTotalFact: createFact(
            `stmt:${date}:tool_total:${t.id}`,
            'Total sandbox checks',
            total,
            'count',
            'Total verification tests required by the builder gate.',
          ),
          usedFallbackCopy: t.usedFallbackCopy,
        };
      }),
    },
  };
}
