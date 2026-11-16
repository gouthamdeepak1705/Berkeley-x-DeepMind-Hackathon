import { addDays, diffDays, formatShortDate, LIVE_END_DATE, LIVE_START_DATE } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { runSimulation, SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP, STORES } from '../engine/stores';
import {
  ActionDecision,
  AutonomyReaction,
  BuiltToolRecord,
  CardReaction,
  CardVisualMetrics,
  DayByDayChartEvent,
  DayByDayChartPoint,
  DayByDayEventKind,
  DoneForYouItem,
  Fact,
  MoneyAccountData,
  MoneyProblemBreakdown,
  MoneyStoreBreakdown,
  MoneyStoreProblemRow,
  NoticedAndLetGoItem,
  ProofTag,
  RaisedItem,
  StoreBoardEntry,
  StoreBoardStatus,
  StoreId,
  TurnedDownWarningItem,
  WatcherEvalRecord,
} from '../types/domain';

const baselineSimCache = new Map<number, SimulationRun>();

export function getBaselineSimulation(seed: number): SimulationRun {
  const cached = baselineSimCache.get(seed);
  if (cached) return cached;
  const run = runSimulation(seed, [], LIVE_END_DATE);
  baselineSimCache.set(seed, run);
  return run;
}

type CellKind = 'best_sellers' | 'knitwear' | 'refunds';

interface ProblemCellSpec {
  problemId: string;
  problemTitle: string;
  storeId: StoreId;
  kind: CellKind;
}

const PROBLEM_SPECS: Array<{
  problemId: string;
  title: string;
  storeNames: string;
  cells: ProblemCellSpec[];
}> = [
  {
    problemId: 'best_sellers',
    title: 'Best-sellers running out at three big stores',
    storeNames: 'Union Square, Palo Alto, Santana Row',
    cells: [
      {
        problemId: 'best_sellers',
        problemTitle: 'Best-sellers running out at three big stores',
        storeId: 'union_square',
        kind: 'best_sellers',
      },
      {
        problemId: 'best_sellers',
        problemTitle: 'Best-sellers running out at three big stores',
        storeId: 'palo_alto',
        kind: 'best_sellers',
      },
      {
        problemId: 'best_sellers',
        problemTitle: 'Best-sellers running out at three big stores',
        storeId: 'santana_row',
        kind: 'best_sellers',
      },
    ],
  },
  {
    problemId: 'walnut_creek_refunds',
    title: 'Cash refunds with no matching sale at Walnut Creek',
    storeNames: 'Walnut Creek',
    cells: [
      {
        problemId: 'walnut_creek_refunds',
        problemTitle: 'Cash refunds with no matching sale at Walnut Creek',
        storeId: 'walnut_creek',
        kind: 'refunds',
      },
    ],
  },
  {
    problemId: 'walnut_creek_knitwear',
    title: 'Knitwear running out at Walnut Creek',
    storeNames: 'Walnut Creek',
    cells: [
      {
        problemId: 'walnut_creek_knitwear',
        problemTitle: 'Knitwear running out at Walnut Creek',
        storeId: 'walnut_creek',
        kind: 'knitwear',
      },
    ],
  },
  {
    problemId: 'pasadena_knitwear',
    title: 'Knitwear running out at Pasadena',
    storeNames: 'Pasadena',
    cells: [
      {
        problemId: 'pasadena_knitwear',
        problemTitle: 'Knitwear running out at Pasadena',
        storeId: 'pasadena',
        kind: 'knitwear',
      },
    ],
  },
  {
    problemId: 'napa_knitwear',
    title: 'Knitwear running out at Napa',
    storeNames: 'Napa',
    cells: [
      {
        problemId: 'napa_knitwear',
        problemTitle: 'Knitwear running out at Napa',
        storeId: 'napa',
        kind: 'knitwear',
      },
    ],
  },
];

function getCellDailyLoss(
  sim: SimulationRun,
  day: string,
  storeId: StoreId,
  kind: CellKind,
  refundMap: Map<string, number>,
): number {
  const rec = sim.storeRecordsByDate[day]?.[storeId];
  if (!rec || !rec.isOpen) return 0;
  if (kind === 'best_sellers') {
    return Math.max(0, rec.groups.best_sellers.potentialSales - rec.groups.best_sellers.actualSales);
  }
  if (kind === 'knitwear') {
    return Math.max(0, rec.groups.knitwear.potentialSales - rec.groups.knitwear.actualSales);
  }
  return refundMap.get(day) ?? 0;
}

function buildDailyUnlinkedRefundMap(sim: SimulationRun, upToDate: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const rf of sim.walnutCreekRefunds) {
    if (rf.date > upToDate || rf.date < LIVE_START_DATE) continue;
    if (!rf.linkedOrder) {
      map.set(rf.date, (map.get(rf.date) ?? 0) + rf.amount);
    }
  }
  return map;
}

function isStoreProvenOnDate(params: {
  storeId: StoreId;
  kind: CellKind;
  decisions: ActionDecision[];
  doneForYou: DoneForYouItem[];
  date: string;
}): boolean {
  const { storeId, kind, decisions, doneForYou, date } = params;
  if (kind === 'refunds') return false;
  const provenIds = new Set(
    doneForYou
      .filter((d) => d.verdict === 'worked_proven' && d.closedOn <= date)
      .map((d) => d.decisionId),
  );
  return decisions.some(
    (dec) =>
      provenIds.has(dec.id) &&
      dec.kind === 'transfer' &&
      dec.groupId === kind &&
      !dec.undoneOnDate &&
      (dec.transferLines ?? []).some((line) => line.toStoreId === storeId),
  );
}

function resolveReactionStoreIds(rx: CardReaction, sim: SimulationRun): StoreId[] {
  if (rx.storeIds && rx.storeIds.length > 0) {
    return [...rx.storeIds];
  }
  const cid = rx.candidateId;
  if (cid.includes('refund')) return ['walnut_creek'];
  if (cid.startsWith('rollout:')) return ['santana_row'];
  if (cid.includes('best_sellers')) {
    const low = (['union_square', 'palo_alto', 'santana_row'] as StoreId[]).filter(
      (sid) => (sim.storeRecordsByDate[rx.date]?.[sid]?.groups.best_sellers.weeksOfCover ?? 99) < 3.0,
    );
    return low.length > 0 ? low : ['union_square', 'palo_alto', 'santana_row'];
  }
  if (cid.includes('knitwear')) {
    const low = (['walnut_creek', 'pasadena', 'napa'] as StoreId[]).filter(
      (sid) => (sim.storeRecordsByDate[rx.date]?.[sid]?.groups.knitwear.weeksOfCover ?? 99) < 3.0,
    );
    return low;
  }
  return [];
}

function classifyDayLossReason(params: {
  day: string;
  storeId: StoreId;
  kind: CellKind;
  sim: SimulationRun;
  decisions: ActionDecision[];
  reactions: CardReaction[];
  dismissedStockStores?: Record<string, string[]>;
}): string {
  const { day, storeId, kind, sim, decisions, reactions } = params;

  if (kind === 'refunds') {
    const activeSwitch = decisions.find(
      (d) => d.kind === 'refund_switch' && !d.undoneOnDate && d.date <= day,
    );
    if (activeSwitch) return 'refund rule turned on';
    const dismissed = reactions.some(
      (r) => r.reaction === 'dismiss' && r.candidateId.includes('refund') && r.date <= day,
    );
    if (dismissed) return 'after you dismissed the warning';
    const deferred = reactions.some(
      (r) => r.reaction === 'not_now' && r.candidateId.includes('refund') && r.date <= day,
    );
    if (deferred) return 'waiting, after you chose Not now';
    return 'before the rule started';
  }

  // Check if held back as comparison store on `day`
  const activeHoldout = decisions.find(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === kind &&
      d.holdoutStoreId === storeId &&
      !d.undoneOnDate &&
      d.date <= day,
  );
  const laterRollout = decisions.find(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === kind &&
      d.parentDecisionId &&
      !d.undoneOnDate &&
      (d.transferLines ?? []).some((l) => l.toStoreId === storeId) &&
      (d.arrivalDate ?? addDays(d.date, 2)) <= day,
  );
  if (activeHoldout && !laterRollout) {
    return 'held back for comparison';
  }

  // Check if transfer to storeId was undone
  const undoneTransfer = decisions.find(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === kind &&
      Boolean(d.undoneOnDate) &&
      (d.transferLines ?? []).some((l) => l.toStoreId === storeId) &&
      d.date <= day,
  );
  if (undoneTransfer) {
    return 'after transfer was undone';
  }

  // Check if transfer approved on/before day and hasn't arrived yet
  const pendingTransfer = decisions.find(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === kind &&
      !d.undoneOnDate &&
      d.date <= day &&
      (d.transferLines ?? []).some((l) => l.toStoreId === storeId) &&
      (d.arrivalDate ?? addDays(d.date, 2)) > day,
  );
  if (pendingTransfer) {
    return 'before the stock arrived';
  }

  // Check if approved at some point before losing sales
  const approvedAtAll = decisions.find(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === kind &&
      !d.undoneOnDate &&
      d.date <= day &&
      (d.transferLines ?? []).some((l) => l.toStoreId === storeId),
  );
  if (approvedAtAll) {
    return 'before the stock arrived';
  }

  // Check dismiss or not_now
  const relevantReactCandIds =
    kind === 'best_sellers'
      ? ['situation:stock_running_out:best_sellers', 'rollout:']
      : ['situation:stock_running_out:knitwear'];
  const matchesCand = (cid: string) =>
    relevantReactCandIds.some((prefix) => cid.startsWith(prefix)) &&
    (kind === 'best_sellers' ||
      cid.includes(storeId) ||
      reactions.some((rx) => rx.candidateId === cid));

  // If store was explicitly dismissed for stock shortage
  const dismissedKeys = params.dismissedStockStores?.[kind] ?? [];
  if (
    dismissedKeys.includes(storeId) &&
    reactions.some(
      (r) =>
        r.reaction === 'dismiss' &&
        r.date <= day &&
        matchesCand(r.candidateId) &&
        resolveReactionStoreIds(r, sim).includes(storeId),
    )
  ) {
    return 'after you dismissed the warning';
  }

  const deferredBefore = reactions.some(
    (r) =>
      r.reaction === 'not_now' &&
      r.date <= day &&
      (r.candidateId.includes(kind) || (r.candidateId.startsWith('rollout:') && kind === 'best_sellers')) &&
      resolveReactionStoreIds(r, sim).includes(storeId),
  );
  if (deferredBefore) {
    return 'waiting, after you chose Not now';
  }

  return 'before the stock arrived';
}

function summarizeProblemDecision(params: {
  problemId: string;
  sim: SimulationRun;
  decisions: ActionDecision[];
  reactions: CardReaction[];
  doneForYou: DoneForYouItem[];
  date: string;
}): { statusLabel: string; decisionLabel: string } {
  const { problemId, sim, decisions, reactions, doneForYou, date } = params;

  if (problemId === 'walnut_creek_refunds') {
    const sw = decisions.find(
      (d) => d.kind === 'refund_switch' && !d.undoneOnDate && d.date <= date,
    );
    if (sw) {
      const done = doneForYou.find((d) => d.decisionId === sw.id);
      return {
        statusLabel: done ? 'Done' : 'Waiting for check',
        decisionLabel: `Rule turned on (${formatShortDate(sw.date)})`,
      };
    }
    const mgrTask = decisions.find(
      (d) => d.kind === 'store_manager_task' && d.date <= date,
    );
    if (mgrTask) {
      return {
        statusLabel: 'Waiting for manager',
        decisionLabel: `Asked store manager (${formatShortDate(mgrTask.date)})`,
      };
    }
    const dis = reactions.find(
      (r) => r.reaction === 'dismiss' && r.candidateId.includes('refund') && r.date <= date,
    );
    if (dis) {
      return { statusLabel: 'Dismissed', decisionLabel: `Dismissed (${formatShortDate(dis.date)})` };
    }
    const def = reactions.find(
      (r) => r.reaction === 'not_now' && r.candidateId.includes('refund') && r.date <= date,
    );
    if (def) {
      return { statusLabel: 'Waiting', decisionLabel: `Chose Not now (${formatShortDate(def.date)})` };
    }
    return {
      statusLabel: date >= '2026-09-25' ? 'Needs decision' : 'Not started yet',
      decisionLabel: date >= '2026-09-25' ? 'Waiting for decision' : 'Starts later',
    };
  }

  const groupId: 'best_sellers' | 'knitwear' =
    problemId === 'best_sellers' ? 'best_sellers' : 'knitwear';
  const targetStores: StoreId[] =
    problemId === 'best_sellers'
      ? ['union_square', 'palo_alto', 'santana_row']
      : problemId === 'walnut_creek_knitwear'
        ? ['walnut_creek']
        : problemId === 'pasadena_knitwear'
          ? ['pasadena']
          : ['napa'];

  const activeDecs = decisions.filter(
    (d) =>
      d.kind === 'transfer' &&
      d.groupId === groupId &&
      d.date <= date &&
      (d.transferLines ?? []).some((l) => targetStores.includes(l.toStoreId)),
  );
  const nonUndone = activeDecs.filter((d) => !d.undoneOnDate || d.undoneOnDate > date);

  if (nonUndone.length > 0) {
    const latest = nonUndone[nonUndone.length - 1];
    const hasAuto = nonUndone.some((d) => d.isAutonomous);
    const allClosed = nonUndone.every((d) =>
      doneForYou.some((dfy) => dfy.decisionId === d.id && dfy.verdict !== 'autonomous_pending'),
    );
    const proven = nonUndone.some((d) =>
      doneForYou.some((dfy) => dfy.decisionId === d.id && dfy.verdict === 'worked_proven'),
    );
    if (hasAuto) {
      return {
        statusLabel: allClosed ? 'Acted alone' : 'Done without asking',
        decisionLabel: `Acted alone within limits (${formatShortDate(latest.date)})`,
      };
    }
    if (proven && problemId === 'best_sellers') {
      const rolloutDec = nonUndone.find((d) => d.parentDecisionId);
      return {
        statusLabel: allClosed ? 'Proven and solved' : 'Proven · sending rest',
        decisionLabel: rolloutDec
          ? `Approved (${formatShortDate(nonUndone[0].date)}), sent rest (${formatShortDate(rolloutDec.date)})`
          : `Approved (${formatShortDate(nonUndone[0].date)})`,
      };
    }
    return {
      statusLabel: allClosed ? 'Done' : 'On the way / checking',
      decisionLabel: `Approved (${formatShortDate(nonUndone[0].date)})`,
    };
  }

  if (activeDecs.some((d) => d.undoneOnDate && d.undoneOnDate <= date)) {
    return { statusLabel: 'Undone', decisionLabel: 'Sent stock back' };
  }

  const candPrefix =
    groupId === 'best_sellers'
      ? 'situation:stock_running_out:best_sellers'
      : 'situation:stock_running_out:knitwear';
  const dis = reactions.find(
    (r) =>
      r.reaction === 'dismiss' &&
      r.date <= date &&
      (r.candidateId === candPrefix || r.candidateId.includes(targetStores[0])) &&
      resolveReactionStoreIds(r, sim).some((sid) => targetStores.includes(sid)),
  );
  if (dis && (groupId === 'best_sellers' || dis.date >= '2026-09-24')) {
    return { statusLabel: 'Dismissed', decisionLabel: `Dismissed (${formatShortDate(dis.date)})` };
  }

  const def = reactions.find(
    (r) =>
      r.reaction === 'not_now' &&
      r.date <= date &&
      r.candidateId === candPrefix &&
      resolveReactionStoreIds(r, sim).some((sid) => targetStores.includes(sid)),
  );
  if (def) {
    return { statusLabel: 'Waiting', decisionLabel: `Chose Not now (${formatShortDate(def.date)})` };
  }

  return { statusLabel: 'Not raised yet', decisionLabel: 'No action needed yet' };
}

function combineProofTag(tags: ProofTag[]): ProofTag {
  const nonNone = tags.filter((t) => t !== 'none');
  if (nonNone.length === 0) return 'none';
  if (nonNone.every((t) => t === 'proven')) return 'proven';
  if (nonNone.every((t) => t === 'likely')) return 'likely';
  return 'mixed';
}

export function buildMoneyAccountData(params: {
  seed: number;
  sim: SimulationRun;
  date: string;
  raised: RaisedItem[];
  decisions: ActionDecision[];
  reactions: CardReaction[];
  autonomyReactions: AutonomyReaction[];
  doneForYou: DoneForYouItem[];
  noticedAndLetGo: NoticedAndLetGoItem[];
  builtTools: BuiltToolRecord[];
  watcherEvalLog: WatcherEvalRecord[];
  dismissedStockStores?: Record<string, string[]>;
  openSituationStoresByCandidate?: Record<string, StoreId[]>;
  signalsCheckedCount?: number;
  askedOwnerCount?: number;
}): MoneyAccountData {
  const {
    seed,
    sim,
    date,
    raised,
    decisions,
    reactions,
    doneForYou,
    noticedAndLetGo,
    builtTools,
    dismissedStockStores,
    openSituationStoresByCandidate,
  } = params;

  const baselineSim = getBaselineSimulation(seed);
  const liveDatesUpToToday = sim.liveDates.filter((d) => d <= date);

  const baselineRefundMap = buildDailyUnlinkedRefundMap(baselineSim, date);
  const actualRefundMap = buildDailyUnlinkedRefundMap(sim, date);

  // Build problem rows and store accumulators strictly from integer leaf cells
  const storeTotals = new Map<
    StoreId,
    { withoutUsd: number; lostUsd: number; savedUsd: number; proofs: ProofTag[]; reasons: string[] }
  >();
  for (const s of STORES) {
    storeTotals.set(s.id, { withoutUsd: 0, lostUsd: 0, savedUsd: 0, proofs: [], reasons: [] });
  }

  let totalWithoutUsd = 0;
  let totalLostUsd = 0;
  let totalProvenUsd = 0;
  let totalLikelyUsd = 0;

  const byProblem: MoneyProblemBreakdown[] = PROBLEM_SPECS.map((spec) => {
    const storeRows: MoneyStoreProblemRow[] = [];
    let probWithout = 0;
    let probLost = 0;
    let probProven = 0;
    let probLikely = 0;
    const probReasons = new Set<string>();
    const probProofs: ProofTag[] = [];

    for (const cell of spec.cells) {
      let rawWithout = 0;
      let rawLost = 0;
      const reasonLosses = new Map<string, number>();

      for (const d of liveDatesUpToToday) {
        const w = getCellDailyLoss(baselineSim, d, cell.storeId, cell.kind, baselineRefundMap);
        const l = getCellDailyLoss(sim, d, cell.storeId, cell.kind, actualRefundMap);
        rawWithout += w;
        rawLost += l;
        if (l > 0.5) {
          const reason = classifyDayLossReason({
            day: d,
            storeId: cell.storeId,
            kind: cell.kind,
            sim,
            decisions,
            reactions,
            dismissedStockStores,
          });
          reasonLosses.set(reason, (reasonLosses.get(reason) ?? 0) + l);
        }
      }

      const cellWithout = Math.round(rawWithout);
      const cellLost = Math.round(rawLost);
      const cellSaved = cellWithout - cellLost;
      const proven =
        cellSaved > 0 &&
        isStoreProvenOnDate({
          storeId: cell.storeId,
          kind: cell.kind,
          decisions,
          doneForYou,
          date,
        });

      const cellProof: ProofTag = cellSaved <= 0 ? 'none' : proven ? 'proven' : 'likely';
      if (cellSaved > 0) {
        if (proven) probProven += cellSaved;
        else probLikely += cellSaved;
      } else if (cellSaved < 0) {
        probLikely += cellSaved;
      }

      const sortedReasons = Array.from(reasonLosses.entries()).sort((a, b) => b[1] - a[1]);
      const dominantReason =
        sortedReasons.length > 0
          ? sortedReasons.map(([r]) => r).join(' and ')
          : cellLost === 0 && cellWithout > 0
            ? 'stopped before any loss happened'
            : 'no loss so far';

      if (cellLost > 0) probReasons.add(dominantReason);
      probProofs.push(cellProof);

      probWithout += cellWithout;
      probLost += cellLost;

      const storeName = STORE_MAP[cell.storeId].name;
      const proofNote =
        cellProof === 'proven'
          ? 'Proven: compared with the store held back for comparison'
          : cellProof === 'likely'
            ? 'Likely, not proven: measured before and after at one store'
            : cellWithout === 0
              ? 'No loss in either scenario up to today'
              : 'No money saved at this store up to today';

      storeRows.push({
        storeId: cell.storeId,
        storeName,
        problemId: spec.problemId,
        problemTitle: spec.title,
        withoutOpscienFact: createFact(
          `money:${spec.problemId}:${cell.storeId}:without:${date}`,
          `${storeName} loss without Opscien`,
          cellWithout,
          'USD',
          `Cumulative ${spec.title.toLowerCase()} loss at ${storeName} through ${date} when no action is taken.`,
        ),
        lostSoFarFact: createFact(
          `money:${spec.problemId}:${cell.storeId}:lost:${date}`,
          `${storeName} actual loss so far`,
          cellLost,
          'USD',
          `Actual ${spec.title.toLowerCase()} loss at ${storeName} through ${date} under current decisions.`,
        ),
        savedFact: createFact(
          `money:${spec.problemId}:${cell.storeId}:saved:${date}`,
          `${storeName} money saved so far`,
          cellSaved,
          'USD',
          `Loss without Opscien ($${cellWithout.toLocaleString('en-US')}) minus actual loss ($${cellLost.toLocaleString('en-US')}) through ${date}.`,
        ),
        proofStatus: cellProof,
        proofNote,
        lossReason: cellLost > 0 ? dominantReason : 'No loss so far',
      });

      const st = storeTotals.get(cell.storeId)!;
      st.withoutUsd += cellWithout;
      st.lostUsd += cellLost;
      st.savedUsd += cellSaved;
      if (cellProof !== 'none') st.proofs.push(cellProof);
      if (cellLost > 0) st.reasons.push(dominantReason);
    }

    const probSaved = probWithout - probLost;
    const probProof = combineProofTag(probProofs);
    const { statusLabel, decisionLabel } = summarizeProblemDecision({
      problemId: spec.problemId,
      sim,
      decisions,
      reactions,
      doneForYou,
      date,
    });

    totalWithoutUsd += probWithout;
    totalLostUsd += probLost;
    totalProvenUsd += probProven;
    totalLikelyUsd += probLikely;

    const probProofNote =
      probProof === 'proven'
        ? 'Proven against the store held back for comparison'
        : probProof === 'mixed'
          ? 'Two treated stores proven against the store held back; third store measured before and after'
          : probProof === 'likely'
            ? 'Likely, not proven: measured before and after at one store'
            : probWithout === 0
              ? 'No loss in the comparison yet'
              : 'No money saved on this problem yet';

    const lossReasonText =
      probLost > 0
        ? Array.from(probReasons).join(' · ')
        : probWithout > 0
          ? 'Action arrived before stock ran out'
          : 'No loss so far';

    return {
      problemId: spec.problemId,
      title: spec.title,
      storeNames: spec.storeNames,
      statusLabel,
      decisionLabel,
      withoutOpscienFact: createFact(
        `money:${spec.problemId}:without:${date}`,
        `${spec.title} — without Opscien`,
        probWithout,
        'USD',
        `Sum of do-nothing losses across ${spec.storeNames} from 1 August to ${date}.`,
      ),
      lostSoFarFact: createFact(
        `money:${spec.problemId}:lost:${date}`,
        `${spec.title} — lost so far`,
        probLost,
        'USD',
        `Sum of actual losses across ${spec.storeNames} from 1 August to ${date}.`,
      ),
      savedFact: createFact(
        `money:${spec.problemId}:saved:${date}`,
        `${spec.title} — saved so far`,
        probSaved,
        'USD',
        `Without Opscien ($${probWithout.toLocaleString('en-US')}) minus lost so far ($${probLost.toLocaleString('en-US')}).`,
      ),
      savedProvenUsd: probProven,
      savedLikelyUsd: probLikely,
      proofStatus: probProof,
      proofNote: probProofNote,
      lossReason: lossReasonText,
      stores: storeRows,
    };
  });

  const totalSavedUsd = totalWithoutUsd - totalLostUsd;

  const byStore: MoneyStoreBreakdown[] = STORES.map((s) => {
    const st = storeTotals.get(s.id)!;
    return {
      storeId: s.id,
      storeName: s.name,
      withoutOpscienFact: createFact(
        `money:store:${s.id}:without:${date}`,
        `${s.name} loss without Opscien`,
        st.withoutUsd,
        'USD',
        `Total simulated do-nothing loss at ${s.name} from 1 August to ${date}.`,
      ),
      lostSoFarFact: createFact(
        `money:store:${s.id}:lost:${date}`,
        `${s.name} lost so far`,
        st.lostUsd,
        'USD',
        `Actual sales and refund losses at ${s.name} from 1 August to ${date}.`,
      ),
      savedFact: createFact(
        `money:store:${s.id}:saved:${date}`,
        `${s.name} saved so far`,
        st.savedUsd,
        'USD',
        `Without Opscien ($${st.withoutUsd.toLocaleString('en-US')}) minus actual loss ($${st.lostUsd.toLocaleString('en-US')}) at ${s.name}.`,
      ),
      proofStatus: combineProofTag(st.proofs),
      lossReason: st.lostUsd > 0 ? Array.from(new Set(st.reasons)).join(' · ') : 'No loss so far',
    };
  });

  // Compute At Risk Now strictly from state <= date (weekly exposure on currently unresolved problems)
  let atRiskUsd = 0;
  const atRiskStoreGroups = new Set<string>();
  const addStoreGroupRisk = (key: string, weeklyUsd: number) => {
    if (atRiskStoreGroups.has(key) || weeklyUsd <= 0) return;
    atRiskStoreGroups.add(key);
    atRiskUsd += weeklyUsd;
  };

  for (const item of raised) {
    if (item.detectorKind === 'refunds_out_of_line') {
      addStoreGroupRisk('walnut_creek:refunds', item.todayStakePerWeek?.value ?? item.stakePerWeek.value);
    } else if (item.groupId === 'best_sellers' || item.groupId === 'knitwear') {
      if (item.stores && item.stores.length > 0) {
        for (const s of item.stores) {
          addStoreGroupRisk(
            `${s.storeId}:${item.groupId}`,
            (s.todayStakePerWeek ?? s.initialStakePerWeek).value,
          );
        }
      } else {
        addStoreGroupRisk(
          `${item.candidateId}:${item.groupId}`,
          (item.todayStakePerWeek ?? item.stakePerWeek).value,
        );
      }
    }
  }

  // Also include pre-arrival approved/control stores and turned-down ongoing shortages/refunds
  for (const dec of decisions) {
    if (dec.date > date || dec.undoneOnDate) continue;
    if (dec.kind === 'transfer' && dec.groupId && (dec.arrivalDate ?? addDays(dec.date, 2)) > date) {
      const gid = dec.groupId as 'best_sellers' | 'knitwear';
      for (const line of dec.transferLines ?? []) {
        const grpRec = sim.storeRecordsByDate[date]?.[line.toStoreId]?.groups[gid];
        if (grpRec && (grpRec.weeksOfCover === null || grpRec.weeksOfCover < 2.5)) {
          addStoreGroupRisk(`${line.toStoreId}:${gid}`, grpRec.potentialSales * 7);
        }
      }
    }
    if (
      dec.kind === 'transfer' &&
      dec.holdoutStoreId &&
      !decisions.some(
        (r) => r.parentDecisionId === dec.id && !r.undoneOnDate && r.date <= date,
      )
    ) {
      const closedProof = doneForYou.some(
        (d) => d.decisionId === dec.id && d.verdict === 'worked_proven' && d.closedOn <= date,
      );
      if (!closedProof && dec.groupId) {
        const gid = dec.groupId as 'best_sellers' | 'knitwear';
        const grpRec = sim.storeRecordsByDate[date]?.[dec.holdoutStoreId]?.groups[gid];
        if (grpRec && (grpRec.weeksOfCover === null || grpRec.weeksOfCover < 2.5)) {
          addStoreGroupRisk(`${dec.holdoutStoreId}:${gid}`, grpRec.potentialSales * 7);
        }
      }
    }
  }

  // Build Warnings you turned down (scoped per episode/store set, never overwritten by a later card at other stores)
  const turnedDownWarnings: TurnedDownWarningItem[] = [];
  interface TurnedDownEpisode {
    key: string;
    candidateId: string;
    reaction: 'not_now' | 'dismiss';
    reactionDate: string;
    reason?: CardReaction['reason'];
    storeIds: StoreId[];
  }
  const activeEpisodes: TurnedDownEpisode[] = [];
  const sortedRx = [...reactions]
    .filter((r) => r.date <= date)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  for (const rx of sortedRx) {
    const rxStores = resolveReactionStoreIds(rx, sim);
    if (rx.reaction === 'not_now' || rx.reaction === 'dismiss') {
      const epKey = `${rx.candidateId}::${[...rxStores].sort().join(',')}`;
      const ep: TurnedDownEpisode = {
        key: epKey,
        candidateId: rx.candidateId,
        reaction: rx.reaction,
        reactionDate: rx.date,
        reason: rx.reason,
        storeIds: rxStores,
      };
      const existingIdx = activeEpisodes.findIndex((e) => e.key === epKey);
      if (existingIdx >= 0) {
        activeEpisodes[existingIdx] = ep;
      } else {
        activeEpisodes.push(ep);
      }
    } else if (rx.reaction === 'approve') {
      for (let i = activeEpisodes.length - 1; i >= 0; i--) {
        const ep = activeEpisodes[i];
        if (ep.candidateId !== rx.candidateId) continue;
        ep.storeIds = ep.storeIds.filter((sid) => !rxStores.includes(sid));
        if (ep.storeIds.length === 0) {
          activeEpisodes.splice(i, 1);
        }
      }
    }
  }

  for (const ep of activeEpisodes) {
    const cid = ep.candidateId;
    const isRefund = cid.includes('refund');
    const isBestSellers = cid.includes('best_sellers') || cid.startsWith('rollout:');
    const isKnitwear = cid.includes('knitwear');

    if (isRefund) {
      const hasSwitch = decisions.some(
        (d) => d.kind === 'refund_switch' && !d.undoneOnDate && d.date <= date,
      );
      if (hasSwitch) continue;
      let lossSince = 0;
      for (const d of liveDatesUpToToday) {
        if (d < ep.reactionDate) continue;
        lossSince += actualRefundMap.get(d) ?? 0;
      }
      const recent7Refunds = liveDatesUpToToday
        .slice(-7)
        .reduce((s, d) => s + (actualRefundMap.get(d) ?? 0), 0);
      addStoreGroupRisk('walnut_creek:refunds', recent7Refunds);

      turnedDownWarnings.push({
        candidateId: cid,
        title: 'Cash refunds with no matching sale at Walnut Creek',
        reaction: ep.reaction,
        reactionDate: ep.reactionDate,
        dismissReasonLabel:
          ep.reason === 'not_important'
            ? 'Not important'
            : ep.reason === 'already_known'
              ? 'Already known'
              : ep.reason === 'wrong'
                ? 'Wrong'
                : ep.reason === 'not_mine'
                  ? 'Not mine'
                  : undefined,
        isReRaised: raised.some((r) => r.candidateId === cid),
        weeklyStakeFact: createFact(
          `td:${ep.key}:weekly:${date}`,
          'Weekly cash refunds at risk',
          recent7Refunds,
          'USD',
          `Cash refunds with no matching sale at Walnut Creek over the last 7 days ending ${date}.`,
        ),
        lostSinceTurnedDownFact: createFact(
          `td:${ep.key}:lost:${date}`,
          'Lost since you turned this down',
          Math.round(lossSince),
          'USD',
          `Actual unlinked cash refunds at Walnut Creek from ${ep.reactionDate} through ${date}.`,
        ),
        byStore: [
          {
            storeId: 'walnut_creek',
            storeName: 'Walnut Creek',
            lostFact: createFact(
              `td:${ep.key}:walnut_creek:lost:${date}`,
              'Walnut Creek loss since warning turned down',
              Math.round(lossSince),
              'USD',
              `Actual cash refunds with no matching sale at Walnut Creek from ${ep.reactionDate} through ${date}.`,
            ),
          },
        ],
      });
    } else if (isBestSellers || isKnitwear) {
      const gid: 'best_sellers' | 'knitwear' = isBestSellers ? 'best_sellers' : 'knitwear';
      const sitStores = openSituationStoresByCandidate?.[cid];
      const baseStores: StoreId[] =
        ep.storeIds.length > 0
          ? ep.storeIds
          : sitStores && sitStores.length > 0
            ? sitStores
            : [];

      const unapprovedStores = baseStores.filter(
        (sid) =>
          !decisions.some(
            (d) =>
              d.kind === 'transfer' &&
              d.groupId === gid &&
              !d.undoneOnDate &&
              d.date <= date &&
              (d.transferLines ?? []).some((l) => l.toStoreId === sid),
          ),
      );
      if (unapprovedStores.length === 0) continue;

      const byStore = unapprovedStores.map((sid) => {
        let storeLoss = 0;
        for (const d of liveDatesUpToToday) {
          if (d < ep.reactionDate) continue;
          const rec = sim.storeRecordsByDate[d]?.[sid];
          if (!rec || !rec.isOpen) continue;
          storeLoss += Math.max(0, rec.groups[gid].potentialSales - rec.groups[gid].actualSales);
        }
        const currRec = sim.storeRecordsByDate[date]?.[sid]?.groups[gid];
        if (currRec && (currRec.weeksOfCover === null || currRec.weeksOfCover < 2.5)) {
          addStoreGroupRisk(`${sid}:${gid}`, currRec.potentialSales * 7);
        }
        return {
          storeId: sid,
          storeName: STORE_MAP[sid].name,
          lostFact: createFact(
            `td:${ep.key}:${sid}:lost:${date}`,
            `${STORE_MAP[sid].name} lost sales since warning turned down`,
            Math.round(storeLoss),
            'USD',
            `Lost ${gid === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} sales at ${STORE_MAP[sid].name} from ${ep.reactionDate} through ${date}.`,
          ),
        };
      });

      const totalLost = byStore.reduce((s, b) => s + b.lostFact.value, 0);
      const totalWeeklyStake = unapprovedStores.reduce((s, sid) => {
        const rec = sim.storeRecordsByDate[date]?.[sid];
        return s + (rec ? rec.groups[gid].potentialSales * 7 : 0);
      }, 0);

      const matchesRaisedStore = raised.some(
        (r) =>
          r.candidateId === cid &&
          (!r.stores ||
            r.stores.length === 0 ||
            r.stores.some((s) => unapprovedStores.includes(s.storeId))),
      );

      turnedDownWarnings.push({
        candidateId: cid,
        title:
          gid === 'best_sellers'
            ? cid.startsWith('rollout:')
              ? 'Best-sellers running low at Santana Row'
              : `Best-sellers running low at ${unapprovedStores.map((id) => STORE_MAP[id].name).join(', ')}`
            : `Knitwear running low at ${unapprovedStores.map((id) => STORE_MAP[id].name).join(', ')}`,
        reaction: ep.reaction,
        reactionDate: ep.reactionDate,
        dismissReasonLabel:
          ep.reason === 'not_important'
            ? 'Not important'
            : ep.reason === 'already_known'
              ? 'Already known'
              : ep.reason === 'wrong'
                ? 'Wrong'
                : ep.reason === 'not_mine'
                  ? 'Not mine'
                  : undefined,
        isReRaised: matchesRaisedStore,
        weeklyStakeFact: createFact(
          `td:${ep.key}:weekly:${date}`,
          'Weekly sales at risk',
          totalWeeklyStake,
          'USD',
          `Estimated weekly ${gid === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} sales across unfixed stores on ${date}.`,
        ),
        lostSinceTurnedDownFact: createFact(
          `td:${ep.key}:lost:${date}`,
          'Lost since you turned this down',
          totalLost,
          'USD',
          `Actual lost sales across ${unapprovedStores.map((id) => STORE_MAP[id].name).join(', ')} from ${ep.reactionDate} through ${date}.`,
        ),
        byStore,
      });
    }
  }

  // Work counters strictly up to `date`
  const signalsChecked = params.signalsCheckedCount ?? noticedAndLetGo.length;
  const stayedQuiet = noticedAndLetGo.length;
  const askedOwner = params.askedOwnerCount ?? 0;
  const activeTransfers = decisions.filter(
    (d) =>
      d.kind === 'transfer' &&
      d.date <= date &&
      (!d.undoneOnDate || d.undoneOnDate > date),
  );
  const actedAlone = activeTransfers.filter((d) => d.isAutonomous).length;
  const unitsMoved = activeTransfers.reduce(
    (s, d) => s + (d.totalUnits ?? (d.transferLines ?? []).reduce((ls, l) => ls + l.units, 0)),
    0,
  );
  const toolsBuilt = builtTools.filter((t) => t.installedOn <= date).length;

  // Part B: Day by Day Chart (Sales + Money series + axis events strictly <= date)
  const { dayByDayPoints, dayByDayEvents } = buildDayByDayData({
    sim,
    baselineSim,
    liveDatesUpToToday,
    baselineRefundMap,
    actualRefundMap,
    decisions,
    reactions,
    doneForYou,
    noticedAndLetGo,
    watcherEvalLog: params.watcherEvalLog,
    autonomyReactions: params.autonomyReactions,
    builtTools,
  });

  return {
    asOfDate: date,
    withoutOpscienFact: createFact(
      `money:without:${date}`,
      'Lost without Opscien',
      totalWithoutUsd,
      'USD',
      `Total simulated stockout sales losses and extra unlinked cash refunds across all stores from 1 August through ${date} when no action is taken.`,
    ),
    lostSoFarFact: createFact(
      `money:lost:${date}`,
      'Lost so far',
      totalLostUsd,
      'USD',
      `Actual stockout sales losses and unlinked cash refunds across all stores from 1 August through ${date}.`,
    ),
    savedSoFarFact: createFact(
      `money:saved:${date}`,
      'Saved so far',
      totalSavedUsd,
      'USD',
      `Lost without Opscien ($${totalWithoutUsd.toLocaleString('en-US')}) minus Lost so far ($${totalLostUsd.toLocaleString('en-US')}) through ${date}.`,
    ),
    savedProvenFact: createFact(
      `money:saved_proven:${date}`,
      'From proven actions',
      totalProvenUsd,
      'USD',
      `Proven in a test against the store held back for comparison; this amount is estimated from the difference between running with and without Opscien through ${date}.`,
    ),
    savedLikelyFact: createFact(
      `money:saved_likely:${date}`,
      'From likely actions',
      totalLikelyUsd,
      'USD',
      `Measured before and after at one store (not tested against a store held back for comparison); estimated from running with and without Opscien through ${date}.`,
    ),
    atRiskNowFact: createFact(
      `money:at_risk:${date}`,
      'At risk right now per week',
      Math.round(atRiskUsd),
      'USD',
      `Estimated weekly sales or cash refunds currently exposed on unresolved warnings or in-transit transfers on ${date}.`,
    ),
    byProblem,
    byStore,
    turnedDownWarnings,
    workCounters: {
      signalsCheckedFact: createFact(
        `work:signals:${date}`,
        'Signals checked',
        signalsChecked,
        'count',
        `Total daily detector checks evaluated from 1 August through ${date}.`,
      ),
      stayedQuietFact: createFact(
        `work:quiet:${date}`,
        'Stayed quiet',
        stayedQuiet,
        'count',
        `Signals noticed, checked against trading calendar or store rules, and kept quiet through ${date}.`,
      ),
      askedOwnerFact: createFact(
        `work:asked:${date}`,
        'Asked you',
        askedOwner,
        'count',
        `Cards raised for your decision from 1 August through ${date}.`,
      ),
      actedAloneFact: createFact(
        `work:auto:${date}`,
        'Acted alone',
        actedAlone,
        'count',
        `Stock transfers under 500 units carried out automatically within your rules through ${date}.`,
      ),
      unitsMovedFact: createFact(
        `work:units:${date}`,
        'Units moved',
        unitsMoved,
        'units',
        `Total existing units moved from stores with stock to spare through ${date} (zero new stock bought).`,
      ),
      toolsBuiltFact: createFact(
        `work:tools:${date}`,
        'Tools built',
        toolsBuilt,
        'count',
        `Custom store tools written and verified in a sandbox through ${date}.`,
      ),
    },
    dayByDayPoints,
    dayByDayEvents,
  };
}

function buildDayByDayData(params: {
  sim: SimulationRun;
  baselineSim: SimulationRun;
  liveDatesUpToToday: string[];
  baselineRefundMap: Map<string, number>;
  actualRefundMap: Map<string, number>;
  decisions: ActionDecision[];
  reactions: CardReaction[];
  doneForYou: DoneForYouItem[];
  noticedAndLetGo: NoticedAndLetGoItem[];
  watcherEvalLog: WatcherEvalRecord[];
  autonomyReactions: AutonomyReaction[];
  builtTools: BuiltToolRecord[];
}): {
  dayByDayPoints: DayByDayChartPoint[];
  dayByDayEvents: DayByDayChartEvent[];
} {
  const {
    sim,
    baselineSim,
    liveDatesUpToToday,
    baselineRefundMap,
    actualRefundMap,
    decisions,
    reactions,
    doneForYou,
    noticedAndLetGo,
    watcherEvalLog,
    autonomyReactions,
    builtTools,
  } = params;

  const allCells = PROBLEM_SPECS.flatMap((p) => p.cells);
  const rawWithoutByCell = new Array<number>(allCells.length).fill(0);
  const rawLostByCell = new Array<number>(allCells.length).fill(0);

  const dayByDayPoints: DayByDayChartPoint[] = [];
  const dayByDayEvents: DayByDayChartEvent[] = [];

  // Map distinct quiet groups by date
  const quietByDate = new Map<string, Map<string, NoticedAndLetGoItem>>();
  for (const lg of noticedAndLetGo) {
    let m = quietByDate.get(lg.date);
    if (!m) {
      m = new Map();
      quietByDate.set(lg.date, m);
    }
    if (!m.has(lg.groupSummaryKey)) {
      m.set(lg.groupSummaryKey, lg);
    }
  }

  for (const d of liveDatesUpToToday) {
    const dIdx = sim.dates.indexOf(d);
    let sales7dWith = 0;
    let sales7dWithout = 0;
    for (let k = Math.max(0, dIdx - 6); k <= dIdx; k++) {
      const kd = sim.dates[k];
      const wRecs = sim.storeRecordsByDate[kd];
      const woRecs = baselineSim.storeRecordsByDate[kd];
      for (const st of STORES) {
        if (wRecs?.[st.id]?.isOpen) sales7dWith += wRecs[st.id].actualSales;
        if (woRecs?.[st.id]?.isOpen) sales7dWithout += woRecs[st.id].actualSales;
      }
    }

    let dayWithoutUsd = 0;
    let dayLostUsd = 0;
    for (let c = 0; c < allCells.length; c++) {
      const cell = allCells[c];
      rawWithoutByCell[c] += getCellDailyLoss(
        baselineSim,
        d,
        cell.storeId,
        cell.kind,
        baselineRefundMap,
      );
      rawLostByCell[c] += getCellDailyLoss(sim, d, cell.storeId, cell.kind, actualRefundMap);
      dayWithoutUsd += Math.round(rawWithoutByCell[c]);
      dayLostUsd += Math.round(rawLostByCell[c]);
    }
    const daySavedUsd = dayWithoutUsd - dayLostUsd;

    dayByDayPoints.push({
      date: d,
      sales7dWithOpscien: Math.round(sales7dWith),
      sales7dWithoutOpscien: Math.round(sales7dWithout),
      withoutOpscienUsd: dayWithoutUsd,
      lostSoFarUsd: dayLostUsd,
      savedSoFarUsd: daySavedUsd,
    });

    // Summarize significant event on date `d` (1 dot per notable day: acted > raised > quiet)
    const dayDecs = decisions.filter((dec) => dec.date === d && !dec.undoneOnDate);
    const dayAutoEnabled = autonomyReactions.find(
      (ar) => ar.date === d && ar.reaction === 'enable_autonomy',
    );
    const dayBuilt = builtTools.find((t) => t.installedOn === d);
    const dayProven = doneForYou.find((dfy) => dfy.closedOn === d && dfy.verdict === 'worked_proven');
    const dayRaises = watcherEvalLog.filter((w) => w.date === d && w.decisionChoice === 'raise_now');
    const dayRx = reactions.filter((r) => r.date === d);
    const dayQuietGroups = Array.from(quietByDate.get(d)?.values() ?? []);

    let kind: DayByDayEventKind | null = null;
    let title = '';
    let summary = '';

    if (dayDecs.length > 0 || dayAutoEnabled || dayBuilt || dayProven) {
      kind = 'acted';
      if (dayDecs.some((dec) => dec.kind === 'refund_switch')) {
        title = 'Refund desk and $50 rule';
        summary = 'Built the Walnut Creek refund desk and turned on manager approval over $50.';
      } else if (dayDecs.some((dec) => dec.isAutonomous)) {
        const autoDec = dayDecs.find((dec) => dec.isAutonomous)!;
        const toStore = autoDec.transferLines?.[0]?.toStoreName ?? 'the store';
        title = `Sent stock to ${toStore} automatically`;
        summary = `Handled ${toStore} Knitwear shortage automatically (${(autoDec.totalUnits ?? 0).toLocaleString('en-US')} units within your 500-unit rule).`;
      } else if (dayDecs.some((dec) => Boolean(dec.parentDecisionId))) {
        title = 'Proved and sent the rest';
        summary = `Proved the test against ${dayDecs[0]?.holdoutStoreName ?? 'Santana Row'} and approved sending the remaining Best-sellers stock.`;
      } else if (dayDecs.some((dec) => dec.kind === 'transfer')) {
        const tDec = dayDecs.find((dec) => dec.kind === 'transfer')!;
        title = tDec.groupId === 'best_sellers' ? 'Approved Best-sellers move' : 'Approved Knitwear move';
        summary = tDec.holdoutStoreName
          ? `Approved moving ${(tDec.totalUnits ?? 0).toLocaleString('en-US')} units while holding ${tDec.holdoutStoreName} back to compare.`
          : `Approved moving ${(tDec.totalUnits ?? 0).toLocaleString('en-US')} units from stores with spare stock.`;
      } else if (dayAutoEnabled) {
        title = 'Earned automatic rule';
        summary = 'Three transfers worked in a row, so you allowed automatic transfers under 500 units.';
      } else if (dayProven) {
        title = 'Proved against comparison store';
        summary = dayProven.verdictSentence;
      } else if (dayBuilt) {
        title = 'Built store refund desk';
        summary = 'Built and verified the Walnut Creek refund desk across three sandbox tests.';
      }
    } else if (dayRaises.length > 0 || dayRx.length > 0) {
      kind = 'raised';
      const latestDis = dayRx.find((r) => r.reaction === 'dismiss');
      const latestNotNow = dayRx.find((r) => r.reaction === 'not_now');
      if (latestDis) {
        title = 'Warning dismissed';
        summary = `You dismissed a warning on ${formatShortDate(d)}.`;
      } else if (latestNotNow) {
        title = 'Put aside (Not now)';
        summary = `You chose Not now on ${formatShortDate(d)}; Opscien kept watching daily.`;
      } else {
        const firstRaise = dayRaises[0];
        const situationLabel = firstRaise.situationId.includes('best_sellers')
          ? 'Best-sellers running out'
          : firstRaise.situationId.includes('knitwear')
            ? 'Knitwear running out'
            : firstRaise.situationId.includes('refunds')
              ? 'Cash refunds at Walnut Creek'
              : 'this warning';
        title = 'Raised warning for your decision';
        summary = `Opscien checked ${situationLabel.toLowerCase()} and asked you to decide.`;
      }
    } else if (dayQuietGroups.length > 0) {
      kind = 'quiet';
      const primaryQuiet = dayQuietGroups[0];
      title = 'Checked and stayed quiet';
      summary = primaryQuiet.reason;
    }

    if (kind) {
      dayByDayEvents.push({
        date: d,
        kind,
        title,
        summary,
        facts: [
          createFact(
            `dbd:${d}:sales7d`,
            `7-day sales on ${formatShortDate(d)}`,
            Math.round(sales7dWith),
            'USD',
            `Actual 7-day sales across all open stores through ${d} ($${Math.round(sales7dWith).toLocaleString('en-US')}) vs without Opscien ($${Math.round(sales7dWithout).toLocaleString('en-US')}).`,
          ),
          createFact(
            `dbd:${d}:saved`,
            `Saved so far through ${formatShortDate(d)}`,
            daySavedUsd,
            'USD',
            `Lost without Opscien ($${dayWithoutUsd.toLocaleString('en-US')}) minus Lost so far ($${dayLostUsd.toLocaleString('en-US')}) through ${d}.`,
          ),
        ],
      });
    }
  }

  return { dayByDayPoints, dayByDayEvents };
}

export function computeProofBarDataForDecision(params: {
  sim: SimulationRun;
  decision: ActionDecision;
  closedOn: string;
}): CardVisualMetrics['proofBarData'] | undefined {
  const { sim, decision, closedOn } = params;
  if (
    decision.kind !== 'transfer' ||
    !decision.holdoutStoreId ||
    !decision.transferLines ||
    decision.transferLines.length === 0
  ) {
    return undefined;
  }

  const arrivalDate = decision.arrivalDate ?? addDays(decision.date, 2);
  const startIdx = Math.max(0, sim.dates.indexOf(arrivalDate));
  const endIdx = sim.dates.indexOf(closedOn);
  if (startIdx < 0 || endIdx < startIdx) return undefined;

  const treatedIds = Array.from(new Set(decision.transferLines.map((l) => l.toStoreId)));
  const holdoutId = decision.holdoutStoreId;
  const days = endIdx - startIdx + 1;

  let treatedAct = 0;
  let treatedExp = 0;
  let holdoutAct = 0;
  let holdoutExp = 0;

  for (let k = startIdx; k <= endIdx; k++) {
    const recs = sim.storeRecordsByDate[sim.dates[k]];
    for (const tid of treatedIds) {
      treatedAct += recs[tid].actualSales;
      treatedExp += recs[tid].expectedSales ?? recs[tid].potentialSales;
    }
    holdoutAct += recs[holdoutId].actualSales;
    holdoutExp += recs[holdoutId].expectedSales ?? recs[holdoutId].potentialSales;
  }

  const treatedPct = treatedExp > 0 ? (treatedAct / treatedExp) * 100 : 100;
  const holdoutPct = holdoutExp > 0 ? (holdoutAct / holdoutExp) * 100 : 100;
  const treatedNames = treatedIds.map((id) => STORE_MAP[id].name).join(' and ');
  const holdoutName = STORE_MAP[holdoutId].name;

  return {
    treatedNames,
    holdoutName,
    treatedActualSalesFact: createFact(
      `proofbar:${decision.id}:t_act:${closedOn}`,
      `${treatedNames} sales during test`,
      treatedAct,
      'USD',
      `Total store sales at ${treatedNames} over ${days} days from ${arrivalDate} to ${closedOn}.`,
    ),
    treatedExpectedSalesFact: createFact(
      `proofbar:${decision.id}:t_exp:${closedOn}`,
      `${treatedNames} expected sales`,
      treatedExp,
      'USD',
      `Expected store sales at ${treatedNames} over ${days} days from ${arrivalDate} to ${closedOn}.`,
    ),
    holdoutActualSalesFact: createFact(
      `proofbar:${decision.id}:h_act:${closedOn}`,
      `${holdoutName} sales during test`,
      holdoutAct,
      'USD',
      `Total store sales at ${holdoutName} (held back for comparison) over ${days} days from ${arrivalDate} to ${closedOn}.`,
    ),
    holdoutExpectedSalesFact: createFact(
      `proofbar:${decision.id}:h_exp:${closedOn}`,
      `${holdoutName} expected sales`,
      holdoutExp,
      'USD',
      `Expected store sales at ${holdoutName} over ${days} days from ${arrivalDate} to ${closedOn}.`,
    ),
    treatedPctFact: createFact(
      `proofbar:${decision.id}:t_pct:${closedOn}`,
      `${treatedNames} sales vs expected`,
      treatedPct,
      'share_percent',
      `Actual sales divided by expected sales at ${treatedNames} from ${arrivalDate} to ${closedOn}.`,
    ),
    holdoutPctFact: createFact(
      `proofbar:${decision.id}:h_pct:${closedOn}`,
      `${holdoutName} sales vs expected`,
      holdoutPct,
      'share_percent',
      `Actual sales divided by expected sales at ${holdoutName} from ${arrivalDate} to ${closedOn}.`,
    ),
  };
}

export function computeCardVisualMetrics(params: {
  sim: SimulationRun;
  date: string;
  item: RaisedItem;
  decisions: ActionDecision[];
  doneForYou: DoneForYouItem[];
}): CardVisualMetrics | undefined {
  const { sim, date, item, decisions, doneForYou } = params;

  if (item.detectorKind === 'refunds_out_of_line') {
    const endIdx = sim.dates.indexOf(date);
    const startIdx = Math.max(0, endIdx - 27);
    const rows = ESTABLISHED_STORES.map((store) => {
      let sales = 0;
      let refunds = 0;
      for (let k = startIdx; k <= endIdx; k++) {
        const rec = sim.storeRecordsByDate[sim.dates[k]]?.[store.id];
        if (!rec || !rec.isOpen) continue;
        sales += rec.actualSales;
        refunds += rec.refundAmount;
      }
      const ratePct = sales > 0 ? (refunds / sales) * 100 : 0;
      return {
        storeId: store.id,
        storeName: store.name,
        isFlagged: store.id === 'walnut_creek',
        refundRateFact: createFact(
          `vis:${item.candidateId}:ref:${store.id}:${date}`,
          `${store.name} 28-day refund rate`,
          ratePct,
          'share_percent',
          `Total refunds ($${Math.round(refunds).toLocaleString('en-US')}) divided by total sales ($${Math.round(sales).toLocaleString('en-US')}) at ${store.name} over 28 days through ${date}.`,
        ),
      };
    }).sort((a, b) => b.refundRateFact.value - a.refundRateFact.value);

    const wcRow = rows.find((r) => r.storeId === 'walnut_creek');
    const peerValues = rows
      .filter((r) => r.storeId !== 'walnut_creek')
      .map((r) => r.refundRateFact.value)
      .sort((a, b) => a - b);
    const mid = Math.floor(peerValues.length / 2);
    const peerMedian =
      peerValues.length === 0
        ? 0
        : peerValues.length % 2 === 1
          ? peerValues[mid]
          : (peerValues[mid - 1] + peerValues[mid]) / 2;

    return {
      refundStoreComparison: rows,
      walnutCreekRefundRateFact: wcRow?.refundRateFact,
      peerRefundRateFact: createFact(
        `vis:${item.candidateId}:peer_ref:${date}`,
        'Other 7 stores typical 28-day refund rate',
        peerMedian,
        'share_percent',
        `Typical 28-day refund rate across the other 7 stores open more than 18 months through ${date}.`,
      ),
    };
  }

  if (item.detectorKind === 'stock_running_out') {
    const gid: 'best_sellers' | 'knitwear' =
      item.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';

    const targetStoreId: StoreId =
      item.stores && item.stores.length > 0
        ? item.stores.reduce((worst, cur) => {
            const wCov = (worst.todayActual ?? worst.initialActual).value;
            const cCov = (cur.todayActual ?? cur.initialActual).value;
            return cCov < wCov ? cur : worst;
          }).storeId
        : 'union_square';

    const storeRec = sim.storeRecordsByDate[date]?.[targetStoreId];
    const currentCover =
      storeRec?.groups[gid].weeksOfCover ?? (item.todayActual ?? item.actual).value;
    const daysLeft = Math.max(0, Math.round(currentCover * 7));

    const nextDelivery = sim.scheduledDeliveries
      .filter(
        (del) =>
          del.groupId === gid &&
          (del.storeId === 'all' || del.storeId === targetStoreId) &&
          del.date > date,
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];

    const daysUntilDelivery = nextDelivery ? diffDays(date, nextDelivery.date) : null;
    const emptyShelfDays =
      daysUntilDelivery !== null ? Math.max(0, daysUntilDelivery - daysLeft) : null;

    const weeklyStake = (item.todayStakePerWeek ?? item.stakePerWeek).value;
    const projectionDays = emptyShelfDays !== null && emptyShelfDays > 0 ? emptyShelfDays : 28;
    const doNothingUsd = (weeklyStake / 7) * projectionDays;

    // Spare stores count and total spare units above each store's own safety floor
    const nextAnyDel = sim.scheduledDeliveries
      .filter((d) => d.groupId === gid && d.date > date)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    const daysUntilAnyDel = nextAnyDel ? Math.max(1, diffDays(date, nextAnyDel.date)) : null;
    const donorFloorWeeks = Math.max(8, daysUntilAnyDel !== null ? daysUntilAnyDel / 7 + 1 : 0);
    const avgPrice = gid === 'best_sellers' ? 120 : 90;
    const grpShare = gid === 'best_sellers' ? 0.35 : 0.15;
    const receiverSet = new Set<StoreId>((item.stores ?? []).map((s) => s.storeId));

    let spareStoreCount = 0;
    let spareTotalUnits = 0;
    for (const st of STORES) {
      const rec = sim.storeRecordsByDate[date]?.[st.id];
      if (!rec || !rec.isOpen) continue;
      if (receiverSet.has(st.id)) continue;
      const gs = rec.groups[gid];
      const cov = gs.weeksOfCover ?? 0;
      const baselineW = (st.baseDailySales * 7 * grpShare * 1.06) / avgPrice;
      const avgW = cov > 0.01 ? gs.endingStock / cov : baselineW;
      const donorDemand = Math.max(avgW, baselineW);
      const spare = Math.floor(gs.endingStock - donorFloorWeeks * donorDemand);
      if (spare >= 10) {
        spareStoreCount += 1;
        spareTotalUnits += spare;
      }
    }

    let proofBarData: CardVisualMetrics['proofBarData'] | undefined;
    if (item.isRollout && item.parentDecisionId) {
      const parentDec = decisions.find((d) => d.id === item.parentDecisionId);
      const parentDone = doneForYou.find((d) => d.decisionId === item.parentDecisionId);
      if (parentDec && parentDone) {
        const computedBar = computeProofBarDataForDecision({
          sim,
          decision: parentDec,
          closedOn: parentDone.closedOn,
        });
        if (computedBar) {
          proofBarData = {
            ...computedBar,
            provenGainFact: parentDone.provenMoneyFact,
          };
        }
      }
    }

    return {
      currentCoverFact: createFact(
        `vis:${item.candidateId}:cov:${date}`,
        'Current stock left',
        currentCover,
        'weeks',
        `Stock on hand at ${STORE_MAP[targetStoreId].name} divided by recent weekly sales pace on ${date}.`,
      ),
      alarmCoverFact: createFact(
        `vis:${item.candidateId}:alarm:${date}`,
        'Safety alarm line',
        2.5,
        'weeks',
        'Opscien raises a warning when stock drops below 2.5 weeks.',
      ),
      daysOfStockLeftFact: createFact(
        `vis:${item.candidateId}:days_left:${date}`,
        'Days of stock left',
        daysLeft,
        'days',
        `${currentCover.toFixed(1)} weeks of stock left multiplied by 7 days (${STORE_MAP[targetStoreId].name} on ${date}).`,
      ),
      daysUntilDeliveryFact:
        daysUntilDelivery !== null
          ? createFact(
              `vis:${item.candidateId}:next_del:${date}`,
              'Days until next delivery',
              daysUntilDelivery,
              'days',
              `Calendar days from ${date} until the next scheduled delivery (${nextDelivery!.date}).`,
            )
          : undefined,
      emptyShelfDaysFact:
        emptyShelfDays !== null
          ? createFact(
              `vis:${item.candidateId}:empty:${date}`,
              'Days with empty shelves if nothing is done',
              emptyShelfDays,
              'days',
              `${daysUntilDelivery} days until next delivery minus ${daysLeft} days of stock left.`,
            )
          : undefined,
      doNothingLossFact:
        daysUntilDelivery !== null
          ? createFact(
              `vis:${item.candidateId}:donothing:${date}`,
              'Expected lost sales if you do nothing',
              doNothingUsd,
              'USD',
              `Estimated sales lost across affected stores over ${projectionDays} days of empty shelves based on current weekly demand.`,
            )
          : undefined,
      spareStoreCountFact: createFact(
        `vis:${item.candidateId}:spare_cnt:${date}`,
        'Stores with spare stock',
        spareStoreCount,
        'count',
        `Number of open stores on ${date} holding at least 10 spare ${gid === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} units above their own safety limit.`,
      ),
      spareTotalUnitsFact: createFact(
        `vis:${item.candidateId}:spare_units:${date}`,
        'Spare units at other stores',
        spareTotalUnits,
        'units',
        `Total spare ${gid === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} units across ${spareStoreCount} stores above each store's own safety limit on ${date}.`,
      ),
      proofBarData,
    };
  }

  return undefined;
}

export function buildStoreBoard(params: {
  sim: SimulationRun;
  date: string;
  raised: RaisedItem[];
  decisions: ActionDecision[];
  doneForYou: DoneForYouItem[];
  activeControlStores: Set<string>;
  moneyAccount: MoneyAccountData;
}): StoreBoardEntry[] {
  const { sim, date, raised, decisions, doneForYou, activeControlStores, moneyAccount } = params;
  const dateIdx = sim.dates.indexOf(date);
  const storeMoneyMap = new Map(moneyAccount.byStore.map((s) => [s.storeId, s]));

  // Sort stores largest first by baseDailySales
  const sortedStores = [...STORES].sort((a, b) => b.baseDailySales - a.baseDailySales);

  return sortedStores.map((store) => {
    const rec = sim.storeRecordsByDate[date]?.[store.id];
    const isOpen = Boolean(rec && rec.isOpen);
    const sm = storeMoneyMap.get(store.id)!;

    // 7-day and 28-day sales strictly <= date
    let s7Act = 0;
    let s7Exp = 0;
    let s28Act = 0;
    let s28Exp = 0;
    const start7 = Math.max(0, dateIdx - 6);
    const start28 = Math.max(0, dateIdx - 27);
    for (let k = start28; k <= dateIdx; k++) {
      const r = sim.storeRecordsByDate[sim.dates[k]]?.[store.id];
      if (!r || !r.isOpen) continue;
      s28Act += r.actualSales;
      s28Exp += r.expectedSales ?? r.potentialSales;
      if (k >= start7) {
        s7Act += r.actualSales;
        s7Exp += r.expectedSales ?? r.potentialSales;
      }
    }

    const vsExpPct = s7Exp > 0 ? ((s7Act / s7Exp) - 1) * 100 : 0;

    // 7-day trailing chart points strictly inside liveDates <= date
    const chartPoints = sim.liveDates
      .filter((d) => d <= date)
      .slice(-42)
      .map((d) => {
        const idx = sim.dates.indexOf(d);
        let a7 = 0;
        let e7 = 0;
        for (let k = Math.max(0, idx - 6); k <= idx; k++) {
          const r = sim.storeRecordsByDate[sim.dates[k]]?.[store.id];
          if (!r || !r.isOpen) continue;
          a7 += r.actualSales;
          e7 += r.expectedSales ?? r.potentialSales;
        }
        return {
          date: d,
          actual7d: Math.round(a7),
          expected7d: Math.round(e7),
        };
      });

    // Status determination
    let status: StoreBoardStatus = 'fine';
    let statusLabel = 'Fine';

    const bsOut = isOpen && (rec.groups.best_sellers.endingStock ?? 0) <= 0.01;
    const kwOut = isOpen && (rec.groups.knitwear.endingStock ?? 0) <= 0.01;
    const incomingTransfer = decisions.some(
      (d) =>
        d.kind === 'transfer' &&
        !d.undoneOnDate &&
        d.date <= date &&
        (d.arrivalDate ?? addDays(d.date, 2)) > date &&
        (d.transferLines ?? []).some((l) => l.toStoreId === store.id),
    );
    const hasRaisedIssueForStore = raised.some(
      (r) =>
        (r.detectorKind === 'refunds_out_of_line' && store.id === 'walnut_creek') ||
        (r.stores ?? []).some((s) => s.storeId === store.id),
    );
    const lowStock =
      isOpen &&
      ((rec.groups.best_sellers.weeksOfCover ?? 99) < 2.5 ||
        (rec.groups.knitwear.weeksOfCover ?? 99) < 2.5);

    if (!isOpen) {
      status = 'not_open';
      statusLabel = `Opens ${formatShortDate(store.openedDate)}`;
    } else if (bsOut || kwOut) {
      status = 'losing_sales';
      statusLabel = 'Losing sales';
    } else if (activeControlStores.has(store.id)) {
      status = 'held_back';
      statusLabel = 'Held back for comparison';
    } else if (incomingTransfer) {
      status = 'stock_on_the_way';
      statusLabel = 'Stock on the way';
    } else if (hasRaisedIssueForStore || lowStock) {
      status = 'at_risk';
      statusLabel = 'At risk';
    }

    // Store events <= date
    const events: Array<{ date: string; summary: string }> = [];
    if (!store.isEstablished && date >= store.openedDate) {
      events.push({ date: store.openedDate, summary: `${store.name} store opened.` });
    }
    for (const dec of decisions) {
      if (dec.date > date) continue;
      if (dec.kind === 'transfer') {
        const receiving = (dec.transferLines ?? []).filter((l) => l.toStoreId === store.id);
        const giving = (dec.transferLines ?? []).filter((l) => l.fromStoreId === store.id);
        if (receiving.length > 0) {
          const u = receiving.reduce((s, l) => s + l.units, 0);
          events.push({
            date: dec.date,
            summary: `${dec.isAutonomous ? 'Sent automatically' : 'Approved'}: ${u.toLocaleString('en-US')} ${dec.groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} units on the way.`,
          });
          const arr = dec.arrivalDate ?? addDays(dec.date, 2);
          if (arr <= date) {
            events.push({
              date: arr,
              summary: `${u.toLocaleString('en-US')} ${dec.groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} units arrived at ${store.name}.`,
            });
          }
        }
        if (giving.length > 0) {
          const u = giving.reduce((s, l) => s + l.units, 0);
          events.push({
            date: dec.date,
            summary: `Shared ${u.toLocaleString('en-US')} spare ${dec.groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} units with another store.`,
          });
        }
        if (dec.holdoutStoreId === store.id) {
          events.push({
            date: dec.date,
            summary: `Held back for comparison to prove the transfer worked.`,
          });
        }
        if (dec.undoneOnDate && dec.undoneOnDate <= date && receiving.length > 0) {
          events.push({
            date: dec.undoneOnDate,
            summary: `Transfer undone; unsold units returned.`,
          });
        }
      } else if (dec.kind === 'refund_switch' && store.id === 'walnut_creek') {
        events.push({
          date: dec.date,
          summary: `Turned on manager approval rule for cash refunds over $50.`,
        });
      }
    }
    for (const dfy of doneForYou) {
      if (dfy.closedOn > date) continue;
      const dec = decisions.find((d) => d.id === dfy.decisionId);
      if (!dec) continue;
      const applies =
        (dec.kind === 'refund_switch' && store.id === 'walnut_creek') ||
        (dec.transferLines ?? []).some((l) => l.toStoreId === store.id);
      if (applies) {
        events.push({
          date: dfy.closedOn,
          summary:
            dfy.verdict === 'worked_proven'
              ? 'Check finished: proven against the comparison store.'
              : dfy.verdict === 'worked_single_store' || dfy.verdict === 'worked_before_after'
                ? 'Check finished: worked on before-and-after numbers.'
                : dfy.verdictSentence,
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));

    const bsCover =
      isOpen && rec.groups.best_sellers.weeksOfCover !== null
        ? createFact(
            `sb:${store.id}:bs:${date}`,
            `${store.name} Best-sellers stock left`,
            rec.groups.best_sellers.weeksOfCover,
            'weeks',
            `Best-sellers units on hand at ${store.name} divided by weekly sales pace on ${date}.`,
          )
        : null;

    const kwCover =
      isOpen && rec.groups.knitwear.weeksOfCover !== null
        ? createFact(
            `sb:${store.id}:kw:${date}`,
            `${store.name} Knitwear stock left`,
            rec.groups.knitwear.weeksOfCover,
            'weeks',
            `Knitwear units on hand at ${store.name} divided by weekly sales pace on ${date}.`,
          )
        : null;

    return {
      storeId: store.id,
      storeName: store.name,
      baseDailySales: store.baseDailySales,
      isOpen,
      openedDate: store.openedDate,
      status,
      statusLabel,
      bestSellersCoverFact: bsCover,
      knitwearCoverFact: kwCover,
      sales7dActualFact: createFact(
        `sb:${store.id}:7d_act:${date}`,
        `${store.name} last 7 days sales`,
        s7Act,
        'USD',
        `Total sales at ${store.name} over the 7 days ending ${date}.`,
      ),
      sales7dExpectedFact: createFact(
        `sb:${store.id}:7d_exp:${date}`,
        `${store.name} last 7 days expected`,
        s7Exp,
        'USD',
        `Expected sales at ${store.name} over the 7 days ending ${date}.`,
      ),
      sales28dActualFact: createFact(
        `sb:${store.id}:28d_act:${date}`,
        `${store.name} last 28 days sales`,
        s28Act,
        'USD',
        `Total sales at ${store.name} over the 28 days ending ${date}.`,
      ),
      sales28dExpectedFact: createFact(
        `sb:${store.id}:28d_exp:${date}`,
        `${store.name} last 28 days expected`,
        s28Exp,
        'USD',
        `Expected sales at ${store.name} over the 28 days ending ${date}.`,
      ),
      salesVsExpectedPctFact: createFact(
        `sb:${store.id}:vs_exp:${date}`,
        `${store.name} 7-day sales vs expected`,
        vsExpPct,
        'percent',
        `Last 7 days sales ($${Math.round(s7Act).toLocaleString('en-US')}) compared with expected ($${Math.round(s7Exp).toLocaleString('en-US')}) at ${store.name}.`,
      ),
      savedSoFarFact: sm.savedFact,
      lostSoFarFact: sm.lostSoFarFact,
      chartPoints,
      events,
    };
  });
}

export function attachDoneForYouProofBars(params: {
  sim: SimulationRun;
  doneForYou: DoneForYouItem[];
  decisions: ActionDecision[];
}): Record<string, NonNullable<CardVisualMetrics['proofBarData']>> {
  const { sim, doneForYou, decisions } = params;
  const out: Record<string, NonNullable<CardVisualMetrics['proofBarData']>> = {};
  for (const item of doneForYou) {
    if (item.verdict !== 'worked_proven') continue;
    const dec = decisions.find((d) => d.id === item.decisionId);
    if (!dec) continue;
    const bar = computeProofBarDataForDecision({
      sim,
      decision: dec,
      closedOn: item.closedOn,
    });
    if (bar) {
      out[item.decisionId] = bar;
    }
  }
  return out;
}
