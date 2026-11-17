import { createHash } from 'node:crypto';
import { evaluateAutonomyRecord } from '../autonomy/record';
import { computeExpectedFlaggedStats } from '../builder/builder';
import { runSituationInvestigation } from '../checker/checker';
import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { runDetectorsForDay } from '../detectors/detectors';
import { applySilenceChecks } from '../detectors/silenceChecks';
import { evaluateActionsUpToDate } from '../followup/proof';
import {
  getGeminiCapBanner,
  getGeminiPlaybackMode,
  getGeminiUsageSummary,
} from '../gemini/client';
import { executeActionThroughGateway, getGatewayAttemptLog } from '../gateway/gateway';
import {
  attachDoneForYouProofBars,
  buildMoneyAccountData,
  buildStoreBoard,
  computeCardVisualMetrics,
} from '../money/account';
import { buildEndStatement } from '../statement/statement';
import { evaluateWatcherBatch, WatcherSubjectOutcome } from '../watcher/watcher';
import { WatcherSubject } from '../watcher/briefing';
import {
  ActionDecision,
  AutonomyReaction,
  BuiltToolRecord,
  Candidate,
  CardReaction,
  DayState,
  DecisionTraceRow,
  Fact,
  GroupedLetGoItem,
  InvestigationResult,
  NoticedAndLetGoItem,
  ProductGroupId,
  RaisedItem,
  RaisedStoreSnapshot,
  StoreId,
  SupportingEvidence,
  TextSegment,
  TraceEntry,
  WatcherEvalRecord,
} from '../types/domain';
import {
  addDays,
  diffDays,
  formatShortDate,
  getCalendarLabelsForDate,
  getIsoWeekKey,
  getIsoWeekdayIndex,
  LIVE_END_DATE,
} from './calendar';
import { createFact } from './facts';
import { DEFAULT_SEED } from './prng';
import { runSimulation, SimulationRun } from './simulation';
import { ESTABLISHED_STORES, STORE_MAP, STORES } from './stores';

export interface Stage2StepResponse {
  dayState: DayState;
  sim: SimulationRun;
  pendingSituation?: RaisedItem;
  decisions: ActionDecision[];
  dismissedStockStores?: Map<string, Set<StoreId>>;
}

interface InternalSituation {
  id: string;
  firstDetectedOn: string;
  lastSeenOn: string;
  title: string;
  summary: string;
  detectorKind: Candidate['kind'];
  groupId?: ProductGroupId;
  initialExpected: Fact;
  initialActual: Fact;
  initialStakePerWeek: Fact;
  todayDate: string;
  todayExpected: Fact;
  todayActual: Fact;
  todayStakePerWeek: Fact;
  stores: Map<StoreId, RaisedStoreSnapshot>;
  evidence: Map<string, SupportingEvidence>;
  groundTruth?: Candidate['groundTruth'];
  instinctMeta?: RaisedItem['instinctMeta'];
  investigation?: InvestigationResult;
  deferredOn?: string;
  reRaisedOn?: string;
  reRaiseReason?: string;
}

interface DeferredSituationState {
  deferredOn: string;
  evidenceCountAtDefer: number;
  consecutiveLostDaysAfterDefer: number;
}

interface WatchedState {
  firstSeenOn: string;
  lastAskedOn: string;
  lastActualValue: number;
  lastStakeValue: number;
  lastStoreCount: number;
}

function cloneFact(f: Fact): Fact {
  return { ...f };
}

function getGroupDisplayName(groupId: ProductGroupId): string {
  if (groupId === 'best_sellers') return 'Best-sellers';
  if (groupId === 'knitwear') return 'Knitwear';
  return 'Everything else';
}

function sumLostSalesForWindow(
  sim: SimulationRun,
  storeIds: StoreId[],
  groupId: 'best_sellers' | 'knitwear',
  startDate: string,
  endDate: string,
): number {
  const startIdx = sim.dates.indexOf(startDate);
  const endIdx = sim.dates.indexOf(endDate);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return 0;
  let totalLost = 0;
  for (let k = startIdx; k <= endIdx; k++) {
    const recs = sim.storeRecordsByDate[sim.dates[k]];
    for (const sid of storeIds) {
      const grp = recs[sid].groups[groupId];
      totalLost += Math.max(0, grp.potentialSales - grp.actualSales);
    }
  }
  return totalLost;
}

function buildLetGoMeta(
  cand: Candidate,
  date: string,
  overrideReason?: string,
): {
  weekKey: string;
  groupSummaryKey: string;
  groupHeadline: string;
  checkKind: NoticedAndLetGoItem['checkKind'];
  reason: string;
  storeName?: string;
} {
  const weekKey = getIsoWeekKey(date);
  const storeName = cand.storeId ? STORE_MAP[cand.storeId].name : undefined;
  const check = cand.explainedBy?.check ?? 'instinct';
  const reason = overrideReason ?? cand.explainedBy?.reason ?? 'Noted and let go by instinct.';

  if (check === 'calendar' && cand.kind === 'drop_or_jump') {
    const dir = cand.thing.endsWith(':drop') ? 'drop' : 'jump';
    const isLullEnded = reason.toLowerCase().includes('ended after');
    const variant = isLullEnded ? 'lull_ended' : dir;
    return {
      weekKey,
      groupSummaryKey: `calendar:doj:${variant}:${weekKey}`,
      groupHeadline:
        dir === 'drop'
          ? 'Summer lull: sales fell, as they did last year'
          : isLullEnded
            ? 'Summer lull ended: sales rebounded to normal baseline'
            : 'Calendar shift: weekly sales jumped',
      checkKind: check,
      reason,
      storeName,
    };
  }

  if (check === 'stock_returned') {
    return {
      weekKey,
      groupSummaryKey: `stock_returned:${cand.kind}:${weekKey}`,
      groupHeadline: 'Stock returned after delivery: sales rebounded',
      checkKind: check,
      reason,
      storeName,
    };
  }

  if (check === 'already_handled') {
    const isControl = reason.toLowerCase().includes('control store');
    return {
      weekKey,
      groupSummaryKey: isControl
        ? `already_handled:control:${cand.storeId ?? 'store'}:${weekKey}`
        : `already_handled:decision:${weekKey}:${reason}`,
      groupHeadline: reason,
      checkKind: check,
      reason,
      storeName,
    };
  }

  return {
    weekKey,
    groupSummaryKey: `${check}:${cand.id}:${weekKey}`,
    groupHeadline: reason,
    checkKind: check,
    reason,
    storeName,
  };
}

function buildGroupedLetGo(items: NoticedAndLetGoItem[]): GroupedLetGoItem[] {
  const groups = new Map<string, NoticedAndLetGoItem[]>();
  for (const item of items) {
    const existing = groups.get(item.groupSummaryKey);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.groupSummaryKey, [item]);
    }
  }

  const out: GroupedLetGoItem[] = [];
  for (const [key, groupItems] of groups.entries()) {
    const storeItems = groupItems.filter((i) => i.storeId !== undefined);
    const uniqueStoreCount = new Set(storeItems.map((i) => i.storeId!)).size;
    const mostRecentDate = groupItems.reduce(
      (maxD, it) => (it.date > maxD ? it.date : maxD),
      groupItems[0].date,
    );

    let headline = groupItems[0].reason;
    if (uniqueStoreCount > 1) {
      const checkKind = groupItems[0].checkKind;
      if (checkKind === 'calendar' && key.includes(':drop:')) {
        headline = `Summer lull: sales fell at ${uniqueStoreCount} stores, as they did last year`;
      } else if (checkKind === 'calendar' && key.includes(':lull_ended:')) {
        headline = `Summer lull ended: sales jumped at ${uniqueStoreCount} stores returning to baseline`;
      } else if (checkKind === 'calendar') {
        headline = `Trading calendar: sales shifted at ${uniqueStoreCount} stores`;
      } else if (checkKind === 'stock_returned') {
        const match = groupItems[0].reason.match(/delivery of ([A-Za-z]+ \d+)/);
        const delDate = match ? match[1].trim() : '';
        headline = `Stock returned${delDate ? ` after ${delDate} delivery` : ''}: sales jumped at ${uniqueStoreCount} stores`;
      } else {
        headline = `${groupItems[0].groupHeadline} (${uniqueStoreCount} stores)`;
      }
    } else if (groupItems.length > 1) {
      headline = groupItems[0].groupHeadline;
    }

    const confs = groupItems
      .map((it) => it.confidence)
      .filter((c): c is number => typeof c === 'number');
    const avgConf =
      confs.length > 0
        ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) / 100
        : undefined;

    out.push({
      id: key,
      date: mostRecentDate,
      weekKey: groupItems[0].weekKey,
      checkKind: groupItems[0].checkKind,
      headline,
      confidence: avgConf,
      items: groupItems.map((it) => ({
        ...it,
        expected: cloneFact(it.expected),
        actual: cloneFact(it.actual),
      })),
    });
  }

  out.sort((a, b) => (a.date === b.date ? 0 : a.date > b.date ? -1 : 1));
  return out;
}

function addInvestigationTraceEntries(
  allTrace: TraceEntry[],
  date: string,
  situationTitle: string,
  inv: InvestigationResult,
): void {
  const modeLabel = inv.mode === 'fallback' ? 'fallback, Gemini not used' : inv.mode;
  const routineTag = inv.jobKey === 'investigate_routine' ? 'routine kind, fast model · ' : '';
  for (const t of inv.toolTrace) {
    allTrace.push({
      id: `trace:${date}:ds:tool:${inv.candidateId}:r${t.round}:${t.toolName}:${allTrace.length}`,
      date,
      lane: 'data_scientist',
      kind: 'tool_call',
      headline: `${t.toolName} (${t.argsSummary})`,
      detail: `${routineTag}${situationTitle} · ${inv.model} (${modeLabel}, ${inv.latencyMs} ms total) · Facts returned: ${t.factIds.join(', ') || 'none'}`,
      outcome: 'info',
      facts: t.facts.slice(0, 4).map(cloneFact),
      meta: {
        model: inv.model,
        mode: inv.mode,
        latencyMs: inv.latencyMs,
      },
    });
  }

  if (inv.secondCheck) {
    const sc = inv.secondCheck;
    const scModeLabel = sc.mode === 'fallback' ? 'fallback, Gemini not used' : sc.mode;
    const facts: Fact[] = [cloneFact(sc.firstValueFact)];
    if (sc.secondValueFact) facts.push(cloneFact(sc.secondValueFact));
    allTrace.push({
      id: `trace:${date}:ds:second_check:${inv.candidateId}:${allTrace.length}`,
      date,
      lane: 'data_scientist',
      kind: 'investigation',
      headline: `Second check, Python, code execution (${sc.label})`,
      detail:
        sc.status === 'unavailable'
          ? `Model ${sc.model} (${scModeLabel}) · ${sc.error ?? 'Not available'}`
          : `Model ${sc.model} (${scModeLabel}, ${sc.latencyMs} ms) · First ${sc.firstValueFact.formatted} vs Python ${sc.secondValueFact?.formatted ?? 'n/a'} (diff ${sc.diffPct ?? 0}%)`,
      outcome: sc.status === 'disagreed' ? 'let_go' : 'info',
      facts,
      meta: {
        model: sc.model,
        mode: sc.mode,
        latencyMs: sc.latencyMs,
      },
    });
  }

  allTrace.push({
    id: `trace:${date}:ds:inv:${inv.candidateId}:${allTrace.length}`,
    date,
    lane: 'data_scientist',
    kind: 'investigation',
    headline:
      inv.status === 'let_go'
        ? `Checked & let go: ${situationTitle}`
        : `Confirmed: ${situationTitle}`,
    detail: `${routineTag}Model ${inv.model} (${inv.mode}, ${inv.latencyMs} ms)${inv.usedFallbackWording ? ' · code wording fallback used' : ''} · Outcome: ${inv.outcomeKind.replace(/_/g, ' ')} — ${inv.outcomeDetail}`,
    outcome: inv.status === 'let_go' ? 'let_go' : 'raised',
    meta: {
      model: inv.model,
      mode: inv.mode,
      latencyMs: inv.latencyMs,
    },
  });
}

function shouldMateriallyReask(
  prev: WatchedState,
  primary: Candidate,
  memberCount: number,
  date: string,
): boolean {
  if (memberCount > prev.lastStoreCount) return true;
  if (primary.kind === 'stock_running_out') {
    if (primary.actual.value <= 0.01 && prev.lastActualValue > 0.01) return true;
    if (prev.lastActualValue - primary.actual.value >= 0.5) return true;
  }
  const stakeDiff =
    prev.lastStakeValue > 0
      ? Math.abs(primary.stakePerWeek.value - prev.lastStakeValue) / prev.lastStakeValue
      : 0;
  if (stakeDiff >= 0.15) return true;
  if (diffDays(prev.lastAskedOn, date) >= 5) return true;
  return false;
}

function storesMapSizeKey(sit: InternalSituation): string {
  return Array.from(sit.stores.keys()).sort().join(',');
}

function buildRaisedItemSnapshot(
  sit: InternalSituation,
  date: string,
  sim: SimulationRun,
  dismissedStockStores?: Map<string, Set<StoreId>>,
): RaisedItem {
  const storeList = Array.from(sit.stores.values()).map((st) => ({
    storeId: st.storeId,
    storeName: st.storeName,
    firstDetectedOn: st.firstDetectedOn,
    initialExpected: cloneFact(st.initialExpected),
    initialActual: cloneFact(st.initialActual),
    initialStakePerWeek: cloneFact(st.initialStakePerWeek),
    todayExpected: st.todayExpected ? cloneFact(st.todayExpected) : undefined,
    todayActual: st.todayActual ? cloneFact(st.todayActual) : undefined,
    todayStakePerWeek: st.todayStakePerWeek ? cloneFact(st.todayStakePerWeek) : undefined,
  }));

  const evidenceList = Array.from(sit.evidence.values()).map((ev) => ({
    ...ev,
    expected: cloneFact(ev.expected),
    actual: cloneFact(ev.actual),
    stakePerWeek: cloneFact(ev.stakePerWeek),
    todayExpected: ev.todayExpected ? cloneFact(ev.todayExpected) : undefined,
    todayActual: ev.todayActual ? cloneFact(ev.todayActual) : undefined,
    todayStakePerWeek: ev.todayStakePerWeek ? cloneFact(ev.todayStakePerWeek) : undefined,
  }));

  // If lfl_break is in evidence, ensure total all-store 28d YoY fact is up to date on day D
  if (evidenceList.some((e) => e.kind === 'lfl_break')) {
    const cr = sim.chainRecordsByDate[date];
    const hasTotalNote = evidenceList.some((e) => e.candidateId === `chain_total_note:${sit.id}`);
    if (!hasTotalNote) {
      const fTotal = createFact(
        `sit:total_28d_vs_ly:${date}`,
        'Total all-store 28-day sales vs last year',
        cr.allStores28dVsLastYearPct,
        'percent',
        `All open stores (including new openings Burlingame and Napa) remain ${cr.allStores28dVsLastYearPct >= 0 ? 'above' : 'below'} last year over the trailing 28 days ending ${date}, offsetting the like-for-like established-store shortfall in headline totals.`,
      );
      const fLfl = createFact(
        `sit:lfl_28d_vs_exp:${date}`,
        'Established 8 stores 28-day vs expectation',
        cr.lflTrailing28Pct,
        'points',
        `Established 8 like-for-like stores 28-day sales vs expectation as of ${date}.`,
      );
      evidenceList.push({
        candidateId: `chain_total_note:${sit.id}`,
        kind: 'lfl_break',
        title: 'Total all-store sales remain above last year because of the two new stores (Burlingame & Napa)',
        firstDetectedOn: evidenceList.find((e) => e.kind === 'lfl_break')!.firstDetectedOn,
        lastSeenOn: date,
        expected: fLfl,
        actual: fTotal,
        stakePerWeek: cloneFact(sit.todayStakePerWeek),
        todayExpected: undefined,
        todayActual: undefined,
        todayStakePerWeek: undefined,
      });
    }
  }

  const showToday = date > sit.firstDetectedOn;
  const storeNames = storeList.map((s) => s.storeName);
  const displayTitle =
    sit.detectorKind === 'stock_running_out' && storeNames.length > 0
      ? `${sit.title} — ${storeNames.join(', ')}`
      : sit.title;

  let costOfDelayFact: Fact | undefined;
  if (sit.reRaisedOn) {
    if (
      sit.detectorKind === 'stock_running_out' &&
      (sit.groupId === 'best_sellers' || sit.groupId === 'knitwear')
    ) {
      const gid: 'best_sellers' | 'knitwear' = sit.groupId;
      const storeIds = Array.from(sit.stores.keys());
      const delayStart = sit.deferredOn ?? sit.firstDetectedOn;
      const lost = storeIds.reduce(
        (sum, sid) =>
          sum + Math.round(sumLostSalesForWindow(sim, [sid], gid, delayStart, date)),
        0,
      );
      costOfDelayFact = createFact(
        `sit:${sit.id}:delay_cost:${date}`,
        'Cost of delay so far',
        lost,
        'USD',
        `Expected minus actual ${getGroupDisplayName(sit.groupId)} sales across ${storeNames.join(', ')} from ${delayStart} through ${date}.`,
      );
    } else {
      const daysElapsed = Math.max(1, diffDays(sit.firstDetectedOn, date));
      const estDelay = (sit.initialStakePerWeek.value / 7) * daysElapsed;
      costOfDelayFact = createFact(
        `sit:${sit.id}:delay_cost:${date}`,
        'Cost of delay so far',
        estDelay,
        'USD',
        `Estimated weekly exposure prorated over ${daysElapsed} days since first raised on ${sit.firstDetectedOn}.`,
      );
    }
  }

  let transferPlan = sit.investigation?.transferPlan;
  if (
    sit.detectorKind === 'stock_running_out' &&
    (sit.groupId === 'best_sellers' || sit.groupId === 'knitwear') &&
    (!transferPlan || date > sit.firstDetectedOn)
  ) {
    const disSet = dismissedStockStores?.get(sit.groupId);
    transferPlan = buildTransferPlanForGroup({
      sim,
      date,
      groupId: sit.groupId,
      dismissedStores: disSet && disSet.size > 0 ? disSet : undefined,
    }).plan;
  }

  return {
    candidateId: sit.id,
    firstDetectedOn: sit.firstDetectedOn,
    lastSeenOn: sit.lastSeenOn,
    title: displayTitle,
    summary: sit.summary,
    detectorKind: sit.detectorKind,
    groupId: sit.groupId,
    stores: storeList.length > 0 ? storeList : undefined,
    expected: cloneFact(sit.initialExpected),
    actual: cloneFact(sit.initialActual),
    stakePerWeek: cloneFact(sit.initialStakePerWeek),
    todayDate: showToday ? sit.todayDate : undefined,
    todayExpected: showToday ? cloneFact(sit.todayExpected) : undefined,
    todayActual: showToday ? cloneFact(sit.todayActual) : undefined,
    todayStakePerWeek: showToday ? cloneFact(sit.todayStakePerWeek) : undefined,
    evidence: evidenceList.length > 0 ? evidenceList : undefined,
    groundTruth: sit.groundTruth,
    instinctMeta: sit.instinctMeta ? { ...sit.instinctMeta } : undefined,
    investigation: sit.investigation,
    secondCheck: sit.investigation?.secondCheck,
    transferPlan,
    deferredOn: sit.deferredOn,
    reRaisedOn: sit.reRaisedOn,
    reRaiseReason: sit.reRaiseReason,
    costOfDelayFact,
  };
}

interface TimelineLoopSnapshot {
  dayIndex: number;
  openSituations: Map<string, InternalSituation>;
  deferredSituations: Map<string, DeferredSituationState>;
  dismissedSituations: Set<string>;
  approvedSituations: Set<string>;
  approvedStockStores: Map<string, Set<StoreId>>;
  dismissedStockStores: Map<string, Set<StoreId>>;
  handledRolloutIds: Set<string>;
  openStockByGroup: Map<'best_sellers' | 'knitwear', Map<StoreId, string>>;
  activeEpisodeSituation: Map<string, string>;
  letGoMap: Map<string, NoticedAndLetGoItem>;
  watchedMap: Map<string, WatchedState>;
  allTrace: TraceEntry[];
  watcherEvalLog: WatcherEvalRecord[];
  completedInvestigations: Map<string, InvestigationResult>;
  lastTodayCandidates: Candidate[];
  emittedFollowUpIds: Set<string>;
  lookedUpInvKeys: Set<string>;
  hadPendingTarget: boolean;
  signalsCheckedCount: number;
  askedOwnerKeys: Set<string>;
  decisions: ActionDecision[];
}

function cloneSituation(sit: InternalSituation): InternalSituation {
  const stores = new Map<StoreId, RaisedStoreSnapshot>();
  for (const [k, st] of sit.stores.entries()) {
    stores.set(k, {
      ...st,
      initialExpected: cloneFact(st.initialExpected),
      initialActual: cloneFact(st.initialActual),
      initialStakePerWeek: cloneFact(st.initialStakePerWeek),
      todayExpected: st.todayExpected ? cloneFact(st.todayExpected) : undefined,
      todayActual: st.todayActual ? cloneFact(st.todayActual) : undefined,
      todayStakePerWeek: st.todayStakePerWeek ? cloneFact(st.todayStakePerWeek) : undefined,
    });
  }
  const evidence = new Map<string, SupportingEvidence>();
  for (const [k, ev] of sit.evidence.entries()) {
    evidence.set(k, {
      ...ev,
      expected: cloneFact(ev.expected),
      actual: cloneFact(ev.actual),
      stakePerWeek: cloneFact(ev.stakePerWeek),
      todayExpected: ev.todayExpected ? cloneFact(ev.todayExpected) : undefined,
      todayActual: ev.todayActual ? cloneFact(ev.todayActual) : undefined,
      todayStakePerWeek: ev.todayStakePerWeek ? cloneFact(ev.todayStakePerWeek) : undefined,
    });
  }
  return {
    ...sit,
    initialExpected: cloneFact(sit.initialExpected),
    initialActual: cloneFact(sit.initialActual),
    initialStakePerWeek: cloneFact(sit.initialStakePerWeek),
    todayExpected: cloneFact(sit.todayExpected),
    todayActual: cloneFact(sit.todayActual),
    todayStakePerWeek: cloneFact(sit.todayStakePerWeek),
    stores,
    evidence,
    instinctMeta: sit.instinctMeta ? { ...sit.instinctMeta } : undefined,
  };
}

function cloneSnapshot(snap: TimelineLoopSnapshot): TimelineLoopSnapshot {
  const openSituations = new Map<string, InternalSituation>();
  for (const [k, v] of snap.openSituations.entries()) {
    openSituations.set(k, cloneSituation(v));
  }
  const deferredSituations = new Map<string, DeferredSituationState>();
  for (const [k, v] of snap.deferredSituations.entries()) {
    deferredSituations.set(k, { ...v });
  }
  const approvedStockStores = new Map<string, Set<StoreId>>();
  for (const [k, s] of snap.approvedStockStores.entries()) {
    approvedStockStores.set(k, new Set(s));
  }
  const dismissedStockStores = new Map<string, Set<StoreId>>();
  for (const [k, s] of snap.dismissedStockStores.entries()) {
    dismissedStockStores.set(k, new Set(s));
  }
  const openStockByGroup = new Map<'best_sellers' | 'knitwear', Map<StoreId, string>>();
  for (const [k, m] of snap.openStockByGroup.entries()) {
    openStockByGroup.set(k, new Map(m));
  }
  const letGoMap = new Map<string, NoticedAndLetGoItem>();
  for (const [k, v] of snap.letGoMap.entries()) {
    letGoMap.set(k, { ...v, expected: cloneFact(v.expected), actual: cloneFact(v.actual) });
  }
  const watchedMap = new Map<string, WatchedState>();
  for (const [k, v] of snap.watchedMap.entries()) {
    watchedMap.set(k, { ...v });
  }
  return {
    dayIndex: snap.dayIndex,
    openSituations,
    deferredSituations,
    dismissedSituations: new Set(snap.dismissedSituations),
    approvedSituations: new Set(snap.approvedSituations),
    approvedStockStores,
    dismissedStockStores,
    handledRolloutIds: new Set(snap.handledRolloutIds),
    openStockByGroup,
    activeEpisodeSituation: new Map(snap.activeEpisodeSituation),
    letGoMap,
    watchedMap,
    allTrace: snap.allTrace.slice(),
    watcherEvalLog: snap.watcherEvalLog.slice(),
    completedInvestigations: new Map(snap.completedInvestigations),
    lastTodayCandidates: snap.lastTodayCandidates.slice(),
    emittedFollowUpIds: new Set(snap.emittedFollowUpIds),
    lookedUpInvKeys: new Set(snap.lookedUpInvKeys),
    hadPendingTarget: snap.hadPendingTarget,
    signalsCheckedCount: snap.signalsCheckedCount ?? 0,
    askedOwnerKeys: new Set(snap.askedOwnerKeys ?? []),
    decisions: snap.decisions.map((d) => ({
      ...d,
      transferLines: d.transferLines ? d.transferLines.map((l) => ({ ...l })) : undefined,
    })),
  };
}

const simRunCache = new Map<string, SimulationRun>();
const timelineSnapshotCache = new Map<string, Map<number, TimelineLoopSnapshot>>();

export function clearTimelineSnapshotCache(): void {
  simRunCache.clear();
  timelineSnapshotCache.clear();
}

function hashStateKey(val: unknown): string {
  return createHash('sha256').update(JSON.stringify(val)).digest('hex').slice(0, 20);
}

function formatReadableCandidateName(candidateId: string): string {
  if (candidateId.includes('stock_running_out:best_sellers')) return 'Best-sellers transfer';
  if (candidateId.includes('stock_running_out:knitwear')) return 'Knitwear transfer';
  if (candidateId.includes('refunds_out_of_line')) return 'Walnut Creek refunds';
  if (candidateId.startsWith('rollout:')) return 'Held-out store rollout';
  return candidateId.replace(/[_:]+/g, ' ');
}

function formatNaturalStoreList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function reconcileInvestigationDisplayFacts(
  item: RaisedItem,
  controlStores: Set<string>,
): RaisedItem {
  const inv = item.investigation;
  if (!inv || item.isRollout) return item;

  let changed = false;
  const plan = item.transferPlan ?? inv.transferPlan;
  const factsById: Record<string, Fact> = inv.factsById;

  // A.4: Synchronize excluded holdout donor mentions (e.g. Santana Row -> Rockridge on Sep 25)
  const donorNames = plan ? Array.from(new Set(plan.transferLines.map((l) => l.fromStoreName))) : [];
  const donorListText = formatNaturalStoreList(donorNames);
  const receiverNames = new Set(plan ? plan.transferLines.map((l) => l.toStoreName) : []);
  const holdoutNames = new Set<string>();
  for (const cid of controlStores) {
    const nm = STORE_MAP[cid as StoreId]?.name;
    if (nm) holdoutNames.add(nm);
  }
  if (plan?.holdoutStoreName) {
    holdoutNames.add(plan.holdoutStoreName);
  }
  const excludedHoldoutDonors =
    donorNames.length > 0
      ? STORES.map((s) => s.name).filter(
          (nm) => holdoutNames.has(nm) && !donorNames.includes(nm) && !receiverNames.has(nm),
        )
      : [];

  const rewriteText = (txt: string, allowDonorRename: boolean): string => {
    let out = txt;
    if (allowDonorRename && donorListText && excludedHoldoutDonors.length > 0) {
      for (const wrongDonor of excludedHoldoutDonors) {
        const escaped = wrongDonor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reFromTo = new RegExp(`\\bfrom\\s+${escaped}(?=\\s+to\\b)`, 'g');
        const reFromEnd = new RegExp(`\\bfrom\\s+${escaped}\\b`, 'g');
        out = out.replace(reFromTo, `from ${donorListText}`);
        out = out.replace(reFromEnd, `from ${donorListText}`);
      }
    }
    return out;
  };

  const mapSegments = (segs: TextSegment[], allowDonorRename: boolean): TextSegment[] => {
    let segChanged = false;
    const mapped = segs.map((seg) => {
      if (seg.type === 'fact') {
        const updatedFact = factsById[seg.fact.id];
        if (updatedFact && (updatedFact.value !== seg.fact.value || updatedFact.formatted !== seg.fact.formatted)) {
          segChanged = true;
          return { ...seg, fact: updatedFact };
        }
        return seg;
      }
      const nextText = rewriteText(seg.text, allowDonorRename);
      if (nextText !== seg.text) {
        segChanged = true;
        return { ...seg, text: nextText };
      }
      return seg;
    });
    if (segChanged) changed = true;
    return segChanged ? mapped : segs;
  };

  const findingSegments = mapSegments(inv.findingSegments, true);
  const causeSegments = mapSegments(inv.causeSegments, true);
  const proposalSegments = mapSegments(inv.proposalSegments, true);
  const nextOutcome = rewriteText(inv.outcomeDetail, true);
  if (nextOutcome !== inv.outcomeDetail) changed = true;

  const nextCauses = inv.causes.map((c) => {
    const nextSummary = rewriteText(c.summary, false);
    if (nextSummary !== c.summary) changed = true;
    return {
      ...c,
      summary: nextSummary,
    };
  });

  const nextOptions = inv.options.map((opt) => {
    if (opt.isDoNothing) return opt;
    const nextLabel = rewriteText(opt.label, true);
    const nextDescription = rewriteText(opt.description, true);
    if (nextLabel !== opt.label || nextDescription !== opt.description) changed = true;
    return {
      ...opt,
      label: nextLabel,
      description: nextDescription,
    };
  });

  const nextTransferPlan = item.transferPlan ?? inv.transferPlan;
  if (nextTransferPlan !== inv.transferPlan) changed = true;

  if (!changed) return item;
  return {
    ...item,
    investigation: {
      ...inv,
      factsById,
      findingSegments,
      causeSegments,
      proposalSegments,
      outcomeDetail: nextOutcome,
      causes: nextCauses,
      options: nextOptions,
      transferPlan: nextTransferPlan,
    },
  };
}

/**
 * Evaluates the live timeline deterministically up to `targetDayIndex`,
 * incrementally reusing cached daily loop snapshots in server memory when inputs match,
 * and rebuilding cleanly from Day 0 whenever the cache is empty.
 */
export async function evaluateStage2UpToDay(params: {
  seed?: number;
  targetDayIndex: number;
  decisions?: ActionDecision[];
  reactions?: CardReaction[];
  controlStores?: Set<string>;
  /** If true, runs investigation synchronously even for newly raised situations on targetDayIndex */
  investigateTargetDay?: boolean;
  /** Pre-completed investigations keyed by situationId (e.g. from SSE stream) */
  providedInvestigations?: Map<string, InvestigationResult>;
  /** Installed Stage 4 tools */
  builtTools?: BuiltToolRecord[];
  /** Stage 4 reviewed refund record IDs */
  reviewedRefundIds?: string[];
  /** Stage 4 extra Developer trace entries */
  builderTraceEntries?: TraceEntry[];
  /** Stage 5 owner responses to Indigo autonomy offers */
  autonomyReactions?: AutonomyReaction[];
}): Promise<Stage2StepResponse> {
  const seed = params.seed ?? DEFAULT_SEED;
  let decisions = (params.decisions ?? []).map((d) => ({ ...d }));
  const reactions = [...(params.reactions ?? [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1,
  );
  const autonomyReactions = [...(params.autonomyReactions ?? [])].sort((a, b) =>
    a.date === b.date ? 0 : a.date < b.date ? -1 : 1,
  );
  const baseControlStores = params.controlStores ?? new Set<string>();
  const builtTools = params.builtTools ?? [];
  const reviewedRefundIds = params.reviewedRefundIds ?? [];
  const builderTraceEntries = params.builderTraceEntries ?? [];
  const providedInvMap = params.providedInvestigations ?? new Map<string, InvestigationResult>();

  const simDecisions = decisions.filter((d) => d.kind !== 'store_manager_task');
  const decisionsKey = hashStateKey({
    seed,
    decisions: simDecisions.map((d) => ({
      id: d.id,
      date: d.date,
      kind: d.kind,
      undoneOnDate: d.undoneOnDate ?? null,
      transferLines: d.transferLines ?? null,
    })),
  });
  const cachedSim = simRunCache.get(decisionsKey);
  let sim: SimulationRun;
  if (cachedSim) {
    sim = cachedSim;
  } else {
    sim = runSimulation(seed, decisions, LIVE_END_DATE);
    if (simRunCache.size > 24) simRunCache.clear();
    simRunCache.set(decisionsKey, sim);
  }

  const clampedTarget = Math.max(0, Math.min(sim.liveDates.length - 1, params.targetDayIndex));
  const targetDateForUndoCheck = sim.liveDates[clampedTarget];

  // Check if any action triggered an automatic undo before targetDate and apply deterministically
  const preFollowUp = evaluateActionsUpToDate({
    sim,
    decisions,
    date: targetDateForUndoCheck,
  });
  if (preFollowUp.undoneDecisionDates.size > 0) {
    decisions = decisions.map((d) => {
      const undoD = preFollowUp.undoneDecisionDates.get(d.id);
      return undoD && !d.undoneOnDate ? { ...d, undoneOnDate: undoD } : d;
    });
    const simUndoDecisions = decisions.filter((d) => d.kind !== 'store_manager_task');
    const undoKey = hashStateKey({
      seed,
      decisions: simUndoDecisions.map((d) => ({
        id: d.id,
        date: d.date,
        kind: d.kind,
        undoneOnDate: d.undoneOnDate ?? null,
        transferLines: d.transferLines ?? null,
      })),
    });
    let undoSim = simRunCache.get(undoKey);
    if (!undoSim) {
      undoSim = runSimulation(seed, decisions, LIVE_END_DATE);
      simRunCache.set(undoKey, undoSim);
    }
    sim = undoSim;
  }

  const contextDecisions = decisions.filter(
    (d) => d.kind !== 'store_manager_task' && !(d.isAutonomous && !d.undoneOnDate),
  );
  const contextKey = hashStateKey({
    seed,
    decisions: contextDecisions.map((d) => ({ id: d.id, date: d.date, kind: d.kind, undoneOnDate: d.undoneOnDate ?? null, isAutonomous: Boolean(d.isAutonomous) })),
    reactions: reactions.map((r) => ({ id: r.id, candidateId: r.candidateId, date: r.date, reaction: r.reaction, storeIds: r.storeIds ?? null })),
    autonomyReactions: autonomyReactions.map((ar) => ({ id: ar.id, offerId: ar.offerId, date: ar.date, reaction: ar.reaction })),
    controlStores: Array.from(baseControlStores).sort(),
    builtTools: builtTools.map((t) => ({ id: t.id, installedOn: t.installedOn, mode: t.mode })),
    reviewedRefundIds: [...reviewedRefundIds].sort(),
  });

  let cacheBucket = timelineSnapshotCache.get(contextKey);
  if (!cacheBucket) {
    if (timelineSnapshotCache.size > 16) {
      const firstKey = timelineSnapshotCache.keys().next().value;
      if (firstKey) timelineSnapshotCache.delete(firstKey);
    }
    cacheBucket = new Map<number, TimelineLoopSnapshot>();
    timelineSnapshotCache.set(contextKey, cacheBucket);
  }

  // Locate highest reusable snapshot k <= clampedTarget where every lookedUpInvKey still matches providedInvMap
  let resumeFromDay = -1;
  let openSituations = new Map<string, InternalSituation>();
  let deferredSituations = new Map<string, DeferredSituationState>();
  let dismissedSituations = new Set<string>();
  let approvedSituations = new Set<string>();
  let approvedStockStores = new Map<string, Set<StoreId>>();
  let dismissedStockStores = new Map<string, Set<StoreId>>();
  let handledRolloutIds = new Set<string>();
  let openStockByGroup = new Map<'best_sellers' | 'knitwear', Map<StoreId, string>>();
  let activeEpisodeSituation = new Map<string, string>();
  let letGoMap = new Map<string, NoticedAndLetGoItem>();
  let watchedMap = new Map<string, WatchedState>();
  let allTrace: TraceEntry[] = [];
  let watcherEvalLog: WatcherEvalRecord[] = [];
  let completedInvestigations = new Map<string, InvestigationResult>(providedInvMap);
  let lastTodayCandidates: Candidate[] = [];
  let emittedFollowUpIds = new Set<string>();
  const lookedUpInvKeys = new Set<string>();
  let signalsCheckedCount = 0;
  let askedOwnerKeys = new Set<string>();

  for (let probe = clampedTarget; probe >= 0; probe--) {
    const snap = cacheBucket.get(probe);
    if (!snap) continue;
    if (probe === clampedTarget && snap.hadPendingTarget) {
      continue;
    }
    let mismatch = false;
    for (const invKey of snap.lookedUpInvKeys) {
      const snapInv = snap.completedInvestigations.get(invKey);
      const curInv = providedInvMap.get(invKey);
      if (curInv && (!snapInv || snapInv.latencyMs !== curInv.latencyMs || snapInv.model !== curInv.model || snapInv.status !== curInv.status)) {
        mismatch = true;
        break;
      }
    }
    if (mismatch) continue;

    const cloned = cloneSnapshot(snap);
    openSituations = cloned.openSituations;
    deferredSituations = cloned.deferredSituations;
    dismissedSituations = cloned.dismissedSituations;
    approvedSituations = cloned.approvedSituations;
    approvedStockStores = cloned.approvedStockStores;
    dismissedStockStores = cloned.dismissedStockStores;
    handledRolloutIds = cloned.handledRolloutIds;
    openStockByGroup = cloned.openStockByGroup;
    activeEpisodeSituation = cloned.activeEpisodeSituation;
    letGoMap = cloned.letGoMap;
    watchedMap = cloned.watchedMap;
    allTrace = cloned.allTrace;
    watcherEvalLog = cloned.watcherEvalLog;
    completedInvestigations = new Map(cloned.completedInvestigations);
    for (const [ik, iv] of providedInvMap.entries()) {
      completedInvestigations.set(ik, iv);
    }
    lastTodayCandidates = cloned.lastTodayCandidates;
    emittedFollowUpIds = cloned.emittedFollowUpIds;
    signalsCheckedCount = cloned.signalsCheckedCount;
    askedOwnerKeys = cloned.askedOwnerKeys;
    for (const ik of cloned.lookedUpInvKeys) lookedUpInvKeys.add(ik);
    const existingDecisionIds = new Set(decisions.map((d) => d.id));
    const mergedFromSnap = cloned.decisions.filter((d) => !existingDecisionIds.has(d.id));
    if (mergedFromSnap.length > 0) {
      decisions = [...decisions, ...mergedFromSnap];
      const restoredSimDecisions = decisions.filter((d) => d.kind !== 'store_manager_task');
      const restoredKey = hashStateKey({
        seed,
        decisions: restoredSimDecisions.map((d) => ({
          id: d.id,
          date: d.date,
          kind: d.kind,
          undoneOnDate: d.undoneOnDate ?? null,
          transferLines: d.transferLines ?? null,
        })),
      });
      let restoredSim = simRunCache.get(restoredKey);
      if (!restoredSim) {
        restoredSim = runSimulation(seed, decisions, LIVE_END_DATE);
        simRunCache.set(restoredKey, restoredSim);
      }
      sim = restoredSim;
    }
    resumeFromDay = probe;
    break;
  }

  let pendingSituation: RaisedItem | undefined;

  for (let i = resumeFromDay + 1; i <= clampedTarget; i++) {
    const date = sim.liveDates[i];

    // Evaluate active actions/proofs & derive held-out control stores strictly from prior-day decisions (< date) for morning detection
    const priorDayDecisions = decisions.filter((d) => d.date < date);
    const dayFollowUp = evaluateActionsUpToDate({
      sim,
      decisions: priorDayDecisions,
      date,
      handledRolloutIds,
    });
    for (const ft of dayFollowUp.traceEntries) {
      if (ft.date === date && !emittedFollowUpIds.has(ft.id)) {
        emittedFollowUpIds.add(ft.id);
        allTrace.push(ft);
      }
    }

    const effectiveControlStores = new Set<string>([
      ...baseControlStores,
      ...dayFollowUp.activeControlStores,
    ]);

    const rawCandidates = runDetectorsForDay(sim, date).map((rc) => {
      if (
        !rc.groundTruth &&
        rc.storeId &&
        effectiveControlStores.has(rc.storeId) &&
        (rc.kind === 'stock_running_out' || rc.kind === 'drop_or_jump' || rc.kind === 'store_out_of_line')
      ) {
        return { ...rc, groundTruth: 'near_miss:control_store_fall' as const };
      }
      return rc;
    });
    const todayCandidates = rawCandidates.map((rc) =>
      applySilenceChecks(rc, sim, date, decisions, effectiveControlStores),
    );
    signalsCheckedCount += todayCandidates.length;
    if (i === clampedTarget) {
      lastTodayCandidates = todayCandidates;
    }

    const orderedCandidates = [...todayCandidates].sort((a, b) => {
      if (a.kind === 'stock_running_out' && b.kind !== 'stock_running_out') return -1;
      if (a.kind !== 'stock_running_out' && b.kind === 'stock_running_out') return 1;
      return 0;
    });

    // Separate candidates into:
    // 1. Updates / new stores / linked evidence for already-open situations
    // 2. Same-day stock_running_out grouped by product group before watcher evaluation
    // 3. Individual unlinked candidates not yet raised
    const pendingStockByGroup = new Map<'best_sellers' | 'knitwear', Candidate[]>();
    const pendingOther: Candidate[] = [];

    for (const cand of orderedCandidates) {
      // Check consequence linking into open stock situations (only for unexplained candidates)
      if (!cand.explainedBy) {
        let linkedGroupId: 'best_sellers' | 'knitwear' | null = null;
        if (
          cand.storeId &&
          ((cand.kind === 'drop_or_jump' && cand.thing.endsWith(':drop')) ||
            cand.kind === 'store_out_of_line')
        ) {
          const windowDays = cand.kind === 'drop_or_jump' ? 7 : 28;
          const windowStart = addDays(date, -(windowDays - 1));
          const gap =
            cand.kind === 'drop_or_jump'
              ? cand.expected.value - cand.actual.value
              : cand.stakePerWeek.value * 4;
          if (gap > 0) {
            let bestLost = 0;
            for (const [grpId, storesMap] of openStockByGroup.entries()) {
              if (!storesMap.has(cand.storeId)) continue;
              const lost = sumLostSalesForWindow(sim, [cand.storeId], grpId, windowStart, date);
              if (lost >= 0.5 * gap && lost > bestLost) {
                bestLost = lost;
                linkedGroupId = grpId;
              }
            }
          }
        } else if (
          cand.kind === 'lfl_break' ||
          (cand.kind === 'day_out_of_line' && cand.thing.endsWith(':dip'))
        ) {
          let windowStart = date;
          let windowEnd = date;
          if (cand.kind === 'lfl_break') {
            const weekdayIdx = getIsoWeekdayIndex(date);
            windowEnd = addDays(date, -(weekdayIdx + 1));
            windowStart = addDays(windowEnd, -6);
          }
          const gap = cand.expected.value - cand.actual.value;
          if (gap > 0) {
            const establishedIds = new Set<StoreId>(ESTABLISHED_STORES.map((s) => s.id));
            let bestLost = 0;
            for (const [grpId, storesMap] of openStockByGroup.entries()) {
              const openEstStores = Array.from(storesMap.keys()).filter((sid) =>
                establishedIds.has(sid),
              );
              if (openEstStores.length === 0) continue;
              const lost = sumLostSalesForWindow(sim, openEstStores, grpId, windowStart, windowEnd);
              if (lost >= 0.5 * gap && lost > bestLost) {
                bestLost = lost;
                linkedGroupId = grpId;
              }
            }
          }
        }

        if (linkedGroupId) {
          const sitId = `situation:stock_running_out:${linkedGroupId}`;
          const sit = openSituations.get(sitId);
          if (sit) {
            const evKey = cand.id;
            if (!sit.evidence.has(evKey)) {
              activeEpisodeSituation.set(evKey, sitId);
              sit.evidence.set(evKey, {
                candidateId: evKey,
                kind: cand.kind,
                title: cand.title,
                storeId: cand.storeId,
                firstDetectedOn: date,
                lastSeenOn: date,
                expected: cloneFact(cand.expected),
                actual: cloneFact(cand.actual),
                stakePerWeek: cloneFact(cand.stakePerWeek),
              });
              allTrace.push({
                id: `trace:${date}:link:${evKey}`,
                date,
                lane: 'manager',
                kind: 'note',
                headline: `Linked to ${sit.title}`,
                detail: `${cand.title} — linked to ${sit.title} (open stock shortage accounts for at least half of the sales gap).`,
                outcome: 'info',
              });
            } else {
              const ev = sit.evidence.get(evKey)!;
              ev.lastSeenOn = date;
              ev.todayExpected = cloneFact(cand.expected);
              ev.todayActual = cloneFact(cand.actual);
              ev.todayStakePerWeek = cloneFact(cand.stakePerWeek);
            }
            continue;
          }
        }
      }

      // If this candidate belongs to an already-open situation (same id or same stock group)
      if (
        !cand.explainedBy &&
        cand.kind === 'stock_running_out' &&
        cand.storeId &&
        (cand.groupId === 'best_sellers' || cand.groupId === 'knitwear')
      ) {
        if (
          approvedStockStores.get(cand.groupId)?.has(cand.storeId) ||
          dismissedStockStores.get(cand.groupId)?.has(cand.storeId)
        ) {
          continue;
        }
        const sitId = `situation:stock_running_out:${cand.groupId}`;
        const existingSit = openSituations.get(sitId);
        if (existingSit) {
          let groupStores = openStockByGroup.get(cand.groupId);
          if (!groupStores) {
            groupStores = new Map();
            openStockByGroup.set(cand.groupId, groupStores);
          }
          existingSit.lastSeenOn = date;
          const existingStore = existingSit.stores.get(cand.storeId);
          if (!existingStore) {
            groupStores.set(cand.storeId, cand.id);
            activeEpisodeSituation.set(cand.id, sitId);
            existingSit.stores.set(cand.storeId, {
              storeId: cand.storeId,
              storeName: STORE_MAP[cand.storeId].name,
              firstDetectedOn: date,
              initialExpected: cloneFact(cand.expected),
              initialActual: cloneFact(cand.actual),
              initialStakePerWeek: cloneFact(cand.stakePerWeek),
            });
          } else if (date > existingStore.firstDetectedOn) {
            existingStore.todayExpected = cloneFact(cand.expected);
            existingStore.todayActual = cloneFact(cand.actual);
            existingStore.todayStakePerWeek = cloneFact(cand.stakePerWeek);
          }
          continue;
        }

        // Not open yet: group by product group for watcher evaluation
        const arr = pendingStockByGroup.get(cand.groupId) ?? [];
        arr.push(cand);
        pendingStockByGroup.set(cand.groupId, arr);
        continue;
      }

      const existingSitId = activeEpisodeSituation.get(cand.id);
      const existingNonStock = existingSitId ? openSituations.get(existingSitId) : undefined;
      if (existingNonStock && !cand.explainedBy) {
        existingNonStock.lastSeenOn = date;
        existingNonStock.todayDate = date;
        existingNonStock.todayExpected = cloneFact(cand.expected);
        existingNonStock.todayActual = cloneFact(cand.actual);
        existingNonStock.todayStakePerWeek = cloneFact(cand.stakePerWeek);
        continue;
      }

      pendingOther.push(cand);
    }

    // Build WatcherSubjects for candidates that are new or materially changed (and not already let go for this episode/week)
    const subjectsToAsk: WatcherSubject[] = [];

    for (const [grpId, members] of pendingStockByGroup.entries()) {
      const key = `situation:stock_running_out:${grpId}`;
      if (dismissedSituations.has(key) || approvedSituations.has(key)) continue;
      const appSet = approvedStockStores.get(grpId);
      const disSet = dismissedStockStores.get(grpId);
      const waveMembers = members.filter(
        (m) => !m.storeId || (!appSet?.has(m.storeId) && !disSet?.has(m.storeId)),
      );
      if (waveMembers.length === 0) continue;

      const weekKey = getIsoWeekKey(date);
      const letGoKey = `${key}:letgo:${weekKey}`;
      if (letGoMap.has(letGoKey)) continue;

      const primary = waveMembers.reduce((a, b) =>
        b.stakePerWeek.value > a.stakePerWeek.value ? b : a,
      );
      const totalStake = waveMembers.reduce((s, m) => s + m.stakePerWeek.value, 0);
      const prevWatch = watchedMap.get(key);
      if (
        prevWatch &&
        !shouldMateriallyReask(prevWatch, primary, waveMembers.length, date)
      ) {
        continue;
      }

      const grpName = getGroupDisplayName(grpId);
      const storeNames = waveMembers
        .map((m) => (m.storeId ? STORE_MAP[m.storeId].name : ''))
        .filter(Boolean);

      subjectsToAsk.push({
        key,
        title: `${grpName} running short — ${storeNames.join(', ')}`,
        primaryCandidate: primary,
        memberCandidates: waveMembers,
        evidenceSummaries: [],
        stakePerWeekUsd: totalStake,
        daysVisible: prevWatch ? diffDays(prevWatch.firstSeenOn, date) + 1 : 1,
        hasCodeSilenceExplanation: false,
        codeSilenceReason: null,
        alreadyHandled: primary.silenceChecks.some(
          (sc) => sc.check === 'already_handled' && sc.triggered,
        ),
      });
    }

    for (const cand of pendingOther) {
      if (dismissedSituations.has(cand.id) || approvedSituations.has(cand.id)) continue;
      const weekKey = getIsoWeekKey(date);
      const checkSuffix = cand.explainedBy ? cand.explainedBy.check : 'instinct';
      const letGoId = `${cand.id}:letgo:${checkSuffix}:${weekKey}`;
      if (letGoMap.has(letGoId)) continue;

      // Also skip if already let go earlier this week under another check/instinct key
      const alreadyLetGoThisWeek = Array.from(letGoMap.keys()).some(
        (k) => k.startsWith(`${cand.id}:letgo:`) && k.endsWith(`:${weekKey}`),
      );
      if (alreadyLetGoThisWeek) continue;

      const prevWatch = watchedMap.get(cand.id);
      if (prevWatch && !shouldMateriallyReask(prevWatch, cand, 1, date)) {
        continue;
      }

      subjectsToAsk.push({
        key: cand.id,
        title: cand.title,
        primaryCandidate: cand,
        memberCandidates: [cand],
        evidenceSummaries: [],
        stakePerWeekUsd: cand.stakePerWeek.value,
        daysVisible: prevWatch ? diffDays(prevWatch.firstSeenOn, date) + 1 : 1,
        hasCodeSilenceExplanation: cand.explainedBy !== null,
        codeSilenceReason: cand.explainedBy?.reason ?? null,
        alreadyHandled: cand.silenceChecks.some(
          (sc) => sc.check === 'already_handled' && sc.triggered,
        ),
      });
    }

    if (subjectsToAsk.length > 0) {
      const openListForBrief = Array.from(openSituations.values()).map((s) =>
        buildRaisedItemSnapshot(s, date, sim, dismissedStockStores),
      );
      const letGoSummaries = Array.from(letGoMap.values()).map((lg) => lg.reason);

      const batch = await evaluateWatcherBatch({
        sim,
        date,
        subjects: subjectsToAsk,
        openSituations: openListForBrief,
        letGoSummaries,
        decisions,
        controlStores: effectiveControlStores,
        builtTools: builtTools.filter((t) => t.installedOn < date),
        reviewedRefundIds,
      });

      if (batch.errorNotice) {
        allTrace.push({
          id: `trace:${date}:mgr:notice:${allTrace.length}`,
          date,
          lane: 'manager',
          kind: 'note',
          headline: `Watcher fallback notice`,
          detail: batch.errorNotice,
          outcome: 'info',
          meta: { model: batch.model, mode: batch.mode },
        });
      }

      // Per-request structured decision rows in Manager trace
      const decisionRows: DecisionTraceRow[] = subjectsToAsk.map((subj) => {
        const out = batch.outcomes.get(subj.key);
        return {
          candidateId: subj.key,
          title: subj.title,
          choice: out?.choice ?? 'keep_watching',
          confidence: out?.confidence ?? 0.5,
          explainedProb: out?.explainedProb ?? 0.5,
          urgencyLevel: out?.urgencyLevel,
        };
      });
      const perCandLines = decisionRows.map(
        (r) =>
          `${r.title}: ${r.choice.replace(/_/g, ' ')} (conf ${r.confidence.toFixed(2)}, explained ${r.explainedProb.toFixed(2)})`,
      );

      const batchModeLabel = batch.mode === 'fallback' ? 'fallback, Gemini not used' : batch.mode;
      allTrace.push({
        id: `trace:${date}:mgr:batch:${allTrace.length}`,
        date,
        lane: 'manager',
        kind: 'decision',
        headline: `Decision request (${batch.questionCount} questions, ${batch.latencyMs} ms${batch.mode === 'replayed' ? ', replayed' : ''})`,
        detail: `${batch.model} (${batchModeLabel})`,
        outcome: Array.from(batch.outcomes.values()).some((o) => o.action === 'raise')
          ? 'raised'
          : 'let_go',
        decisionRows,
        meta: {
          model: batch.model,
          mode: batch.mode,
          latencyMs: batch.latencyMs,
          questionCount: batch.questionCount,
          briefingSnippet: perCandLines.join(' · '),
        },
      });

      for (const subj of subjectsToAsk) {
        const out: WatcherSubjectOutcome | undefined = batch.outcomes.get(subj.key);
        if (!out) continue;
        watcherEvalLog.push(out.evalRecord);

        const firstSeen = watchedMap.get(subj.key)?.firstSeenOn ?? date;
        watchedMap.set(subj.key, {
          firstSeenOn: firstSeen,
          lastAskedOn: date,
          lastActualValue: subj.primaryCandidate.actual.value,
          lastStakeValue: subj.primaryCandidate.stakePerWeek.value,
          lastStoreCount: subj.memberCandidates.length,
        });

        if (out.action === 'disagree_keep_watching') {
          allTrace.push({
            id: `trace:${date}:mgr:disagree:${subj.key}:${allTrace.length}`,
            date,
            lane: 'manager',
            kind: 'silence_check',
            headline: `Instinct and calendar check disagree — keeping watch`,
            detail: `${out.reason} | Briefing excerpt: ${batch.briefing.slice(0, 320)}`,
            outcome: 'info',
            meta: {
              model: batch.model,
              mode: batch.mode,
              latencyMs: batch.latencyMs,
              confidence: out.confidence,
            },
          });
          continue;
        }

        if (out.action === 'keep_watching') {
          allTrace.push({
            id: `trace:${date}:mgr:watch:${subj.key}:${allTrace.length}`,
            date,
            lane: 'manager',
            kind: 'decision',
            headline: `Keeping watch: ${subj.title}`,
            detail: out.reason,
            outcome: 'info',
            meta: {
              model: batch.model,
              mode: batch.mode,
              latencyMs: batch.latencyMs,
              confidence: out.confidence,
            },
          });
          continue;
        }

        if (out.action === 'let_go') {
          const cand = subj.primaryCandidate;
          const meta = buildLetGoMeta(
            cand,
            date,
            subj.hasCodeSilenceExplanation ? cand.explainedBy!.reason : out.reason,
          );
          const letGoId = `${cand.id}:letgo:${meta.checkKind}:${meta.weekKey}`;
          if (!letGoMap.has(letGoId)) {
            letGoMap.set(letGoId, {
              candidateId: letGoId,
              date,
              reason: meta.reason,
              groupSummaryKey: meta.groupSummaryKey,
              groupHeadline: meta.groupHeadline,
              weekKey: meta.weekKey,
              storeId: cand.storeId,
              storeName: meta.storeName,
              checkKind: meta.checkKind,
              detectorKind: cand.kind,
              expected: cloneFact(cand.expected),
              actual: cloneFact(cand.actual),
              groundTruth: cand.groundTruth,
              confidence: out.confidence,
              decisionSource: batch.mode === 'fallback' ? 'code_fallback' : 'instinct',
              model: batch.model,
              mode: batch.mode,
            });
          }
          continue;
        }

        // action === 'raise'
        watchedMap.delete(subj.key);
        const cand = subj.primaryCandidate;
        const instinctMeta: RaisedItem['instinctMeta'] = {
          confidence: out.confidence,
          latencyMs: batch.latencyMs,
          model: batch.model,
          mode: batch.mode,
          urgencyLevel: out.urgencyLevel,
          urgencyIndex: out.urgencyIndex,
          explainedProb: out.explainedProb,
          actionableProb: out.actionableProb,
        };

        let newSit: InternalSituation;
        if (
          cand.kind === 'stock_running_out' &&
          (cand.groupId === 'best_sellers' || cand.groupId === 'knitwear')
        ) {
          const grpId = cand.groupId;
          const grpName = getGroupDisplayName(grpId);
          const sitId = `situation:stock_running_out:${grpId}`;
          let groupStores = openStockByGroup.get(grpId);
          if (!groupStores) {
            groupStores = new Map();
            openStockByGroup.set(grpId, groupStores);
          }

          const storesMap = new Map<StoreId, RaisedStoreSnapshot>();
          for (const m of subj.memberCandidates) {
            if (!m.storeId) continue;
            groupStores.set(m.storeId, m.id);
            activeEpisodeSituation.set(m.id, sitId);
            storesMap.set(m.storeId, {
              storeId: m.storeId,
              storeName: STORE_MAP[m.storeId].name,
              firstDetectedOn: date,
              initialExpected: cloneFact(m.expected),
              initialActual: cloneFact(m.actual),
              initialStakePerWeek: cloneFact(m.stakePerWeek),
            });
          }
          const totalInitStake = Array.from(storesMap.values()).reduce(
            (s, st) => s + st.initialStakePerWeek.value,
            0,
          );
          const lowestStore = Array.from(storesMap.values()).reduce((minSt, st) =>
            st.initialActual.value < minSt.initialActual.value ? st : minSt,
          );
          const combinedStakeFact =
            storesMap.size > 1
              ? createFact(
                  `sit:${grpId}:${date}:init_stake`,
                  'Combined weekly sales at risk',
                  totalInitStake,
                  'USD',
                  `Sum of estimated weekly ${grpName} demand across ${storesMap.size} affected stores on ${formatShortDate(date)}.`,
                )
              : cloneFact(cand.stakePerWeek);

          newSit = {
            id: sitId,
            firstDetectedOn: date,
            lastSeenOn: date,
            title: `${grpName} running short`,
            summary: cand.summary,
            detectorKind: cand.kind,
            groupId: grpId,
            initialExpected: cloneFact(lowestStore.initialExpected),
            initialActual: cloneFact(lowestStore.initialActual),
            initialStakePerWeek: combinedStakeFact,
            todayDate: date,
            todayExpected: cloneFact(lowestStore.initialExpected),
            todayActual: cloneFact(lowestStore.initialActual),
            todayStakePerWeek: cloneFact(combinedStakeFact),
            stores: storesMap,
            evidence: new Map(),
            groundTruth: cand.groundTruth,
            instinctMeta,
          };
        } else {
          const sitId = subj.key;
          activeEpisodeSituation.set(cand.id, sitId);
          const storesMap = new Map<StoreId, RaisedStoreSnapshot>();
          if (cand.storeId) {
            storesMap.set(cand.storeId, {
              storeId: cand.storeId,
              storeName: STORE_MAP[cand.storeId].name,
              firstDetectedOn: date,
              initialExpected: cloneFact(cand.expected),
              initialActual: cloneFact(cand.actual),
              initialStakePerWeek: cloneFact(cand.stakePerWeek),
            });
          }
          newSit = {
            id: sitId,
            firstDetectedOn: date,
            lastSeenOn: date,
            title: cand.title,
            summary: cand.summary,
            detectorKind: cand.kind,
            groupId: cand.groupId,
            initialExpected: cloneFact(cand.expected),
            initialActual: cloneFact(cand.actual),
            initialStakePerWeek: cloneFact(cand.stakePerWeek),
            todayDate: date,
            todayExpected: cloneFact(cand.expected),
            todayActual: cloneFact(cand.actual),
            todayStakePerWeek: cloneFact(cand.stakePerWeek),
            stores: storesMap,
            evidence: new Map(),
            groundTruth: cand.groundTruth,
            instinctMeta,
          };
        }

        // If a near-miss was unexpectedly raised by Gemini Decision, include full briefing & answers in trace for Check 2 transparency
        if (cand.groundTruth?.startsWith('near_miss:')) {
          allTrace.push({
            id: `trace:${date}:mgr:nearmiss_raised:${newSit.id}`,
            date,
            lane: 'manager',
            kind: 'note',
            headline: `Near-miss raised by instinct: ${subj.title}`,
            detail: `Choice=${out.choice} (conf=${out.confidence.toFixed(2)}, explained=${out.explainedProb.toFixed(2)}). Briefing: ${batch.briefing}`,
            outcome: 'raised',
          });
        }

        openSituations.set(newSit.id, newSit);

        // Key completedInvestigations per episode wave so Knitwear multi-store waves investigate independently
        const invLookupKey =
          cand.kind === 'stock_running_out' && cand.groupId === 'knitwear' && storesMapSizeKey(newSit)
            ? `${newSit.id}:${storesMapSizeKey(newSit)}:${newSit.firstDetectedOn}`
            : newSit.id;
        lookedUpInvKeys.add(invLookupKey);

        const dayAutonomy = evaluateAutonomyRecord({
          date,
          decisions,
          doneForYou: dayFollowUp.doneForYou,
          autonomyReactions,
        });
        const autonomyActiveNow = dayAutonomy.level === 'autonomous_within_limits';

        const tryAutonomousExecution = (invResult: InvestigationResult): boolean => {
          if (!autonomyActiveNow) return false;
          if (newSit.detectorKind !== 'stock_running_out') return false;
          const plan = invResult.transferPlan;
          if (
            !plan ||
            plan.receiverStoreIds.length !== 1 ||
            Boolean(plan.holdoutStoreId) ||
            plan.totalUnitsFact.value <= 0 ||
            plan.totalUnitsFact.value > 500 ||
            plan.transferLines.length === 0
          ) {
            return false;
          }

          const targetNames = plan.receiverStoreIds.map((sid) => STORE_MAP[sid].name).join(', ');
          const gw = executeActionThroughGateway(
            {
              candidateId: newSit.id,
              date,
              kind: 'transfer',
              groupId: plan.groupId,
              ownerApproved: false,
              autonomous: true,
              autonomyGranted: true,
              approvedBy: 'Autonomy within limits',
              plan,
              whySummary: `${targetNames} dropped below 2.5 weeks of ${plan.groupName} stock left; executed without asking within your 500-unit rule.`,
              expectedWorthUsd: plan.weeklyRecoveryFact.value,
            },
            sim,
          );
          if (!gw.ok || !gw.decision) {
            return false;
          }

          if (!decisions.some((d) => d.id === gw.decision!.id)) {
            decisions = [...decisions, gw.decision];
            sim = runSimulation(seed, decisions, LIVE_END_DATE);
            const refreshedKey = hashStateKey({
              seed,
              decisions: decisions
                .filter((d) => d.kind !== 'store_manager_task')
                .map((d) => ({
                  id: d.id,
                  date: d.date,
                  kind: d.kind,
                  undoneOnDate: d.undoneOnDate ?? null,
                  transferLines: d.transferLines ?? null,
                })),
            });
            simRunCache.set(refreshedKey, sim);
          }

          // Mark store(s) handled & close open situation cleanly
          const grpId = plan.groupId;
          let appSet = approvedStockStores.get(grpId);
          if (!appSet) {
            appSet = new Set();
            approvedStockStores.set(grpId, appSet);
          }
          for (const sid of plan.receiverStoreIds) appSet.add(sid);
          openSituations.delete(newSit.id);
          openStockByGroup.delete(grpId);
          watchedMap.delete(newSit.id);

          allTrace.push({
            id: `trace:${date}:mgr:auto:${gw.decision.id}`,
            date,
            lane: 'manager',
            kind: 'gateway',
            headline: `Done within your rules: ${gw.decision.title} (${gw.decision.totalUnits} units)`,
            detail: `${gw.decision.whySummary ?? ''} Checked every safety limit through the gateway with no approval step.`,
            outcome: 'raised',
            facts: [plan.totalUnitsFact, plan.weeklyRecoveryFact],
          });
          return true;
        };

        const isKnitwearWave = cand.kind === 'stock_running_out' && cand.groupId === 'knitwear';
        const existingInv = isKnitwearWave
          ? completedInvestigations.get(invLookupKey)
          : completedInvestigations.get(invLookupKey) ?? completedInvestigations.get(newSit.id);
        if (existingInv) {
          newSit.investigation = existingInv;
          addInvestigationTraceEntries(allTrace, date, subj.title, existingInv);
          if (existingInv.status === 'let_go') {
            openSituations.delete(newSit.id);
            const meta = buildLetGoMeta(cand, date, existingInv.outcomeDetail);
            const letGoId = `${cand.id}:letgo:checker:${meta.weekKey}`;
            letGoMap.set(letGoId, {
              candidateId: letGoId,
              date,
              reason: existingInv.outcomeDetail,
              groupSummaryKey: meta.groupSummaryKey,
              groupHeadline: meta.groupHeadline,
              weekKey: meta.weekKey,
              storeId: cand.storeId,
              storeName: meta.storeName,
              checkKind: 'checker',
              detectorKind: cand.kind,
              expected: cloneFact(cand.expected),
              actual: cloneFact(cand.actual),
              groundTruth: cand.groundTruth,
              confidence: out.confidence,
              decisionSource: 'checker',
              model: existingInv.model,
              mode: existingInv.mode,
            });
          } else {
            tryAutonomousExecution(existingInv);
          }
        } else if (
          i < clampedTarget ||
          params.investigateTargetDay ||
          (autonomyActiveNow &&
            newSit.detectorKind === 'stock_running_out' &&
            newSit.stores.size <= 1)
        ) {
          const snap = buildRaisedItemSnapshot(newSit, date, sim, dismissedStockStores);
          const groupDisSet =
            newSit.detectorKind === 'stock_running_out' &&
            (newSit.groupId === 'best_sellers' || newSit.groupId === 'knitwear')
              ? dismissedStockStores.get(newSit.groupId)
              : undefined;
          const inv = await runSituationInvestigation({
            situation: snap,
            sim,
            date,
            controlStores: effectiveControlStores,
            dismissedStores: groupDisSet && groupDisSet.size > 0 ? groupDisSet : undefined,
          });
          completedInvestigations.set(invLookupKey, inv);
          completedInvestigations.set(newSit.id, inv);
          newSit.investigation = inv;
          addInvestigationTraceEntries(allTrace, date, snap.title, inv);
          if (inv.status === 'let_go') {
            openSituations.delete(newSit.id);
            const meta = buildLetGoMeta(cand, date, inv.outcomeDetail);
            const letGoId = `${cand.id}:letgo:checker:${meta.weekKey}`;
            letGoMap.set(letGoId, {
              candidateId: letGoId,
              date,
              reason: inv.outcomeDetail,
              groupSummaryKey: meta.groupSummaryKey,
              groupHeadline: meta.groupHeadline,
              weekKey: meta.weekKey,
              storeId: cand.storeId,
              storeName: meta.storeName,
              checkKind: 'checker',
              detectorKind: cand.kind,
              expected: cloneFact(cand.expected),
              actual: cloneFact(cand.actual),
              groundTruth: cand.groundTruth,
              confidence: out.confidence,
              decisionSource: 'checker',
              model: inv.model,
              mode: inv.mode,
            });
          } else {
            tryAutonomousExecution(inv);
          }
        } else {
          pendingSituation = buildRaisedItemSnapshot(newSit, date, sim, dismissedStockStores);
        }
      }

      // Apply any Gemini Decision pair-merges (> 0.7 probability)
      for (const m of batch.merges) {
        if (!m.merged) continue;
        const sitA = openSituations.get(m.situationAId);
        const sitB = openSituations.get(m.situationBId);
        if (!sitA || !sitB) continue;
        const primary =
          sitA.initialStakePerWeek.value >= sitB.initialStakePerWeek.value ? sitA : sitB;
        const secondary = primary === sitA ? sitB : sitA;
        primary.evidence.set(secondary.id, {
          candidateId: secondary.id,
          kind: secondary.detectorKind,
          title: `${secondary.title} (merged by instinct, p=${m.probability.toFixed(2)})`,
          firstDetectedOn: secondary.firstDetectedOn,
          lastSeenOn: secondary.lastSeenOn,
          expected: cloneFact(secondary.initialExpected),
          actual: cloneFact(secondary.initialActual),
          stakePerWeek: cloneFact(secondary.initialStakePerWeek),
        });
        openSituations.delete(secondary.id);
        activeEpisodeSituation.set(secondary.id, primary.id);
        allTrace.push({
          id: `trace:${date}:mgr:merge:${primary.id}:${secondary.id}`,
          date,
          lane: 'manager',
          kind: 'note',
          headline: `Merged into ${primary.title}`,
          detail: `Gemini Decision scored ${m.probability.toFixed(2)} (>0.70) that "${secondary.title}" shares the same underlying problem.`,
          outcome: 'info',
        });
      }
    }

    // Update live "today" facts on every open situation strictly from data <= date
    for (const sit of openSituations.values()) {
      if (
        sit.detectorKind === 'stock_running_out' &&
        (sit.groupId === 'best_sellers' || sit.groupId === 'knitwear')
      ) {
        const grpId = sit.groupId;
        const grpName = getGroupDisplayName(grpId);
        const dayRecs = sim.storeRecordsByDate[date];
        const storeSnaps = Array.from(sit.stores.values());

        for (const st of storeSnaps) {
          if (date > st.firstDetectedOn) {
            const grpState = dayRecs[st.storeId].groups[grpId];
            if (grpState.weeksOfCover !== null) {
              st.todayExpected = createFact(
                `today:sro:${st.storeId}:${grpId}:${date}:exp`,
                'Safety cover threshold',
                2.5,
                'weeks',
                'Minimum 2.5 weeks of cover target.',
              );
              st.todayActual = createFact(
                `today:sro:${st.storeId}:${grpId}:${date}:act`,
                `${st.storeName} ${grpName} cover on ${formatShortDate(date)}`,
                grpState.weeksOfCover,
                'weeks',
                `Ending stock on ${date} (${Math.round(grpState.endingStock)} units) divided by average weekly units sold over the last 28 in-stock days.`,
              );
              st.todayStakePerWeek = createFact(
                `today:sro:${st.storeId}:${grpId}:${date}:stake`,
                'Weekly sales at risk',
                grpState.potentialSales * 7,
                'USD',
                `Estimated weekly ${grpName} demand at ${st.storeName} as of ${date}.`,
              );
            }
          }
        }

        if (date > sit.firstDetectedOn && storeSnaps.length > 0) {
          let minCover = Infinity;
          let minCoverStore = storeSnaps[0];
          let totalTodayStake = 0;
          for (const st of storeSnaps) {
            const grpState = dayRecs[st.storeId].groups[grpId];
            const cov = grpState.weeksOfCover ?? 0;
            if (cov < minCover) {
              minCover = cov;
              minCoverStore = st;
            }
            totalTodayStake += grpState.potentialSales * 7;
          }
          sit.todayDate = date;
          sit.todayExpected = createFact(
            `today:sit:${grpId}:${date}:exp`,
            'Safety cover threshold',
            2.5,
            'weeks',
            'Minimum 2.5 weeks of cover target.',
          );
          sit.todayActual = createFact(
            `today:sit:${grpId}:${date}:act`,
            `Lowest store cover (${minCoverStore.storeName})`,
            minCover,
            'weeks',
            `Lowest ${grpName} cover across affected stores on ${date} (${minCoverStore.storeName}: ${minCover.toFixed(1)} weeks).`,
          );
          sit.todayStakePerWeek = createFact(
            `today:sit:${grpId}:${date}:stake`,
            'Combined weekly sales at risk',
            totalTodayStake,
            'USD',
            `Sum of weekly ${grpName} demand across the ${storeSnaps.length} affected ${storeSnaps.length === 1 ? 'store' : 'stores'} on ${date}.`,
          );
        }
      }
      // Check if any deferred ("Not now") situation has worsened on `date`
      const deferredState = deferredSituations.get(sit.id);
      if (deferredState && date > deferredState.deferredOn) {
        let worsenedReason: string | null = null;
        if (sit.evidence.size > deferredState.evidenceCountAtDefer) {
          worsenedReason = 'New supporting evidence linked';
        } else if (
          sit.detectorKind === 'stock_running_out' &&
          (sit.groupId === 'best_sellers' || sit.groupId === 'knitwear')
        ) {
          const storeIds = Array.from(sit.stores.keys());
          const dayRecs = sim.storeRecordsByDate[date];
          const lostToday = storeIds.reduce((s, sid) => {
            const g = dayRecs[sid].groups[sit.groupId as 'best_sellers' | 'knitwear'];
            return s + Math.max(0, g.potentialSales - g.actualSales);
          }, 0);
          if (lostToday > 0.01) {
            deferredState.consecutiveLostDaysAfterDefer += 1;
          } else {
            deferredState.consecutiveLostDaysAfterDefer = 0;
          }
          if (deferredState.consecutiveLostDaysAfterDefer >= 3) {
            worsenedReason = 'Sales actually lost for 3 days running';
          }
        }

        if (worsenedReason) {
          deferredSituations.delete(sit.id);
          sit.reRaisedOn = date;
          sit.reRaiseReason = worsenedReason;
          allTrace.push({
            id: `trace:${date}:mgr:reraise:${sit.id}`,
            date,
            lane: 'manager',
            kind: 'note',
            headline: `Re-raised (worsened): ${sit.title}`,
            detail: `${worsenedReason} since deferred on ${formatShortDate(deferredState.deferredOn)}.`,
            outcome: 'raised',
          });
        }
      }
    }

    // Count each visible card/rollout once before applying today's owner reactions
    for (const sit of openSituations.values()) {
      if (
        !deferredSituations.has(sit.id) &&
        !approvedSituations.has(sit.id) &&
        !dismissedSituations.has(sit.id)
      ) {
        askedOwnerKeys.add(`ep:${sit.id}:${sit.firstDetectedOn}`);
      }
    }
    for (const rc of dayFollowUp.rolloutCards) {
      if (
        !deferredSituations.has(rc.candidateId) &&
        !approvedSituations.has(rc.candidateId) &&
        !dismissedSituations.has(rc.candidateId)
      ) {
        askedOwnerKeys.add(`ep:${rc.candidateId}`);
      }
    }

    // Apply owner reactions from `date` AFTER morning detectors/watcher run so morning detection & eval log are preserved
    for (const r of reactions) {
      if (r.date !== date) continue;
      if (r.candidateId.startsWith('rollout:') && (r.reaction === 'approve' || r.reaction === 'dismiss')) {
        handledRolloutIds.add(r.candidateId);
      }
      const readableName =
        openSituations.get(r.candidateId)?.title ?? formatReadableCandidateName(r.candidateId);
      if (r.reaction === 'approve') {
        if (r.candidateId.startsWith('situation:stock_running_out:')) {
          const grpId = r.candidateId.split(':')[2] as 'best_sellers' | 'knitwear';
          const openSit = openSituations.get(r.candidateId);
          let appSet = approvedStockStores.get(grpId);
          if (!appSet) {
            appSet = new Set();
            approvedStockStores.set(grpId, appSet);
          }
          if (openSit) {
            for (const sid of openSit.stores.keys()) appSet.add(sid);
          }
          for (const d of decisions) {
            if (d.candidateId === r.candidateId && d.date <= date) {
              for (const l of d.transferLines ?? []) appSet.add(l.toStoreId);
            }
          }
          openStockByGroup.delete(grpId);
          watchedMap.delete(r.candidateId);
        } else {
          approvedSituations.add(r.candidateId);
        }
        deferredSituations.delete(r.candidateId);
        openSituations.delete(r.candidateId);
        allTrace.push({
          id: `trace:${date}:mgr:react:${r.id}`,
          date,
          lane: 'manager',
          kind: 'note',
          headline: `Owner approved: ${readableName}`,
          detail: r.detail ?? `Approved by owner on ${formatShortDate(date)}.`,
          outcome: 'raised',
        });
      } else if (r.reaction === 'dismiss') {
        if (r.candidateId.startsWith('situation:stock_running_out:')) {
          const grpId = r.candidateId.split(':')[2] as 'best_sellers' | 'knitwear';
          const openSit = openSituations.get(r.candidateId);
          let disSet = dismissedStockStores.get(grpId);
          if (!disSet) {
            disSet = new Set();
            dismissedStockStores.set(grpId, disSet);
          }
          if (openSit) {
            for (const sid of openSit.stores.keys()) disSet.add(sid);
          }
          openStockByGroup.delete(grpId);
          watchedMap.delete(r.candidateId);
        } else {
          dismissedSituations.add(r.candidateId);
        }
        deferredSituations.delete(r.candidateId);
        openSituations.delete(r.candidateId);
        allTrace.push({
          id: `trace:${date}:mgr:react:${r.id}`,
          date,
          lane: 'manager',
          kind: 'note',
          headline: `Owner dismissed (${(r.reason ?? 'other').replace(/_/g, ' ')})`,
          detail: `${readableName} dismissed by owner on ${formatShortDate(date)}.`,
          outcome: 'let_go',
        });
      } else if (r.reaction === 'not_now') {
        const sit = openSituations.get(r.candidateId);
        deferredSituations.set(r.candidateId, {
          deferredOn: date,
          evidenceCountAtDefer: sit ? sit.evidence.size : 0,
          consecutiveLostDaysAfterDefer: 0,
        });
        if (sit) sit.deferredOn = date;
        allTrace.push({
          id: `trace:${date}:mgr:react:${r.id}`,
          date,
          lane: 'manager',
          kind: 'note',
          headline: `Owner deferred (Not now): ${readableName}`,
          detail: `Card hidden on ${formatShortDate(date)}; continuing to check daily and will re-raise if it worsens.`,
          outcome: 'info',
        });
      }
    }

    const isPendingOnThisDay = Boolean(pendingSituation && i === clampedTarget);
    cacheBucket.set(
      i,
      cloneSnapshot({
        dayIndex: i,
        openSituations,
        deferredSituations,
        dismissedSituations,
        approvedSituations,
        approvedStockStores,
        dismissedStockStores,
        handledRolloutIds,
        openStockByGroup,
        activeEpisodeSituation,
        letGoMap,
        watchedMap,
        allTrace,
        watcherEvalLog,
        completedInvestigations,
        lastTodayCandidates,
        emittedFollowUpIds,
        lookedUpInvKeys,
        hadPendingTarget: isPendingOnThisDay,
        signalsCheckedCount,
        askedOwnerKeys,
        decisions,
      }),
    );
  }

  const targetDate = sim.liveDates[clampedTarget];
  const finalFollowUp = evaluateActionsUpToDate({
    sim,
    decisions,
    date: targetDate,
    handledRolloutIds,
  });

  // Include Gateway trace entries and builder trace entries on or before targetDate
  const gatewayLogs = getGatewayAttemptLog().filter((g) => g.date <= targetDate);
  const existingTraceIds = new Set(allTrace.map((t) => t.id));
  for (const g of gatewayLogs) {
    if (!existingTraceIds.has(g.id)) {
      allTrace.push(g);
      existingTraceIds.add(g.id);
    }
  }
  for (const bt of builderTraceEntries) {
    if (bt.date <= targetDate && !existingTraceIds.has(bt.id)) {
      allTrace.push(bt);
      existingTraceIds.add(bt.id);
    }
  }

  const visibleOpenSituations = Array.from(openSituations.values()).filter(
    (sit) => !deferredSituations.has(sit.id) && !approvedSituations.has(sit.id) && !dismissedSituations.has(sit.id),
  );

  const visibleRolloutCards = finalFollowUp.rolloutCards.filter(
    (rc) => !deferredSituations.has(rc.candidateId) && !dismissedSituations.has(rc.candidateId) && !approvedSituations.has(rc.candidateId),
  );

  const raisedSnapshot: RaisedItem[] = [
    ...visibleOpenSituations.map((sit) =>
      buildRaisedItemSnapshot(sit, targetDate, sim, dismissedStockStores),
    ),
    ...visibleRolloutCards,
  ].sort((a, b) => {
    const stakeB = (b.todayStakePerWeek ?? b.stakePerWeek).value;
    const stakeA = (a.todayStakePerWeek ?? a.stakePerWeek).value;
    return stakeB - stakeA;
  });

  const chartPoints = sim.liveDates.slice(0, clampedTarget + 1).map((d) => {
    const cr = sim.chainRecordsByDate[d];
    const bandLow = cr.establishedTrailing7Expected * 0.92;
    const bandHigh = cr.establishedTrailing7Expected * 1.08;
    const outOfBand =
      cr.establishedTrailing7Actual < bandLow || cr.establishedTrailing7Actual > bandHigh;
    return {
      date: d,
      actual7d: cr.establishedTrailing7Actual,
      expected7d: cr.establishedTrailing7Expected,
      bandLow,
      bandHigh,
      outOfBand,
      calendarLabels: getCalendarLabelsForDate(d),
    };
  });

  const chainRec = sim.chainRecordsByDate[targetDate];
  const headlineFacts = {
    total28dSales: createFact(
      `chain:28d_sales:${targetDate}`,
      'Last 28 days total sales (all stores)',
      chainRec.allStoresTrailing28Sales,
      'USD',
      `Sum of actual daily sales across all open stores from ${addDays(targetDate, -27)} to ${targetDate}.`,
    ),
    lastYear28dSales: createFact(
      `chain:ly_28d_sales:${targetDate}`,
      'Last year 28-day baseline',
      chainRec.lastYearAllStoresTrailing28Sales,
      'USD',
      'Sum of matching prior-year day sales over the same 28-day calendar window.',
    ),
    total28dChangePct: createFact(
      `chain:28d_change_pct:${targetDate}`,
      'Total 28-day change vs last year',
      chainRec.allStores28dVsLastYearPct,
      'percent',
      '(All-store 28-day sales ÷ prior-year 28-day sales) − 1.',
    ),
    lfl28dVsExpectedPct: createFact(
      `chain:lfl_28d_pct:${targetDate}`,
      'Like-for-like 28-day vs expectation',
      chainRec.lflTrailing28Pct,
      'points',
      'Established 8 stores 28-day actual sales compared against expected sales (prior year × growth).',
    ),
  };

  const noticedList = Array.from(letGoMap.values())
    .map((it) => ({
      ...it,
      expected: cloneFact(it.expected),
      actual: cloneFact(it.actual),
    }))
    .reverse();

  const refundWindowStart = addDays(targetDate, -34);
  const refundRows = sim.walnutCreekRefunds.filter(
    (r) => r.date >= refundWindowStart && r.date <= targetDate,
  );
  const refundSwitchEnabled = decisions.some(
    (d) => d.kind === 'refund_switch' && !d.undoneOnDate && d.date <= targetDate,
  );
  const visibleBuiltTools = builtTools.filter((t) => t.installedOn <= targetDate);
  let toolUnreviewedFact: Fact | undefined;
  if (visibleBuiltTools.length > 0) {
    const stats = computeExpectedFlaggedStats(refundRows, new Set(reviewedRefundIds));
    toolUnreviewedFact = createFact(
      `tool:unreviewed:${targetDate}`,
      'Walnut Creek unreviewed flagged refunds (35d)',
      stats.unreviewedFlaggedCount,
      'count',
      `${stats.unreviewedFlaggedCount} unreviewed flagged late-evening Till 2 operator 14 cash refunds out of ${stats.count} flagged ($${stats.total.toFixed(2)}) over the last 35 days through ${targetDate}.`,
    );
  }

  const autonomyRecord = evaluateAutonomyRecord({
    date: targetDate,
    decisions,
    doneForYou: finalFollowUp.doneForYou,
    autonomyReactions,
  });

  for (const r of reactions) {
    if (r.date <= targetDate) {
      const hasEpisode = Array.from(askedOwnerKeys).some((k) =>
        k.startsWith(`ep:${r.candidateId}`),
      );
      if (!hasEpisode) {
        askedOwnerKeys.add(`ep:${r.candidateId}`);
      }
    }
  }
  for (const ar of autonomyReactions) {
    if (ar.date <= targetDate) {
      askedOwnerKeys.add(`ep:autonomy:${ar.offerId}`);
    }
  }
  for (const r of raisedSnapshot) {
    const epKey = r.isRollout
      ? `ep:${r.candidateId}`
      : `ep:${r.candidateId}:${r.firstDetectedOn}`;
    askedOwnerKeys.add(epKey);
  }
  if (autonomyRecord.offerCard) {
    askedOwnerKeys.add(`ep:autonomy:${autonomyRecord.offerCard.id}`);
  }

  const dismissedStockObj: Record<string, string[]> = {};
  for (const [k, s] of dismissedStockStores.entries()) {
    dismissedStockObj[k] = Array.from(s);
  }
  const openSitStoresObj: Record<string, StoreId[]> = {};
  for (const [k, sit] of openSituations.entries()) {
    openSitStoresObj[k] = Array.from(sit.stores.keys());
  }

  const enrichedRaisedSnapshot = raisedSnapshot.map((item) => {
    const withMetrics: RaisedItem = {
      ...item,
      visualMetrics: computeCardVisualMetrics({
        sim,
        date: targetDate,
        item,
        decisions,
        doneForYou: finalFollowUp.doneForYou,
      }),
    };
    return reconcileInvestigationDisplayFacts(withMetrics, finalFollowUp.activeControlStores);
  });

  const moneyAccount = buildMoneyAccountData({
    seed,
    sim,
    date: targetDate,
    raised: enrichedRaisedSnapshot,
    decisions,
    reactions,
    autonomyReactions,
    doneForYou: finalFollowUp.doneForYou,
    noticedAndLetGo: noticedList,
    builtTools: visibleBuiltTools,
    watcherEvalLog,
    dismissedStockStores: dismissedStockObj,
    openSituationStoresByCandidate: openSitStoresObj,
    signalsCheckedCount,
    askedOwnerCount: askedOwnerKeys.size,
  });

  const storeBoard = buildStoreBoard({
    sim,
    date: targetDate,
    raised: enrichedRaisedSnapshot,
    decisions,
    doneForYou: finalFollowUp.doneForYou,
    activeControlStores: finalFollowUp.activeControlStores,
    moneyAccount,
  });

  const doneForYouProofBars = attachDoneForYouProofBars({
    sim,
    doneForYou: finalFollowUp.doneForYou,
    decisions,
  });

  const isFinalDay = clampedTarget === sim.liveDates.length - 1;
  const geminiUsage = getGeminiUsageSummary();
  const endStatement = isFinalDay
    ? buildEndStatement({
        seed,
        date: targetDate,
        sim,
        decisions,
        doneForYou: finalFollowUp.doneForYou,
        watcherEvalLog,
        allTrace,
        builtTools: visibleBuiltTools,
        liveUsage: {
          totalCalls: geminiUsage.totalCalls,
          uncachedDecisionCalls: geminiUsage.uncachedDecisionCalls,
          uncachedOtherCalls: geminiUsage.uncachedOtherCalls,
          fallbackCalls: geminiUsage.fallbackCalls,
          estimatedCostUsd: geminiUsage.estimatedCostUsd,
        },
      })
    : undefined;

  return {
    dayState: {
      date: targetDate,
      dayIndex: clampedTarget,
      totalDays: sim.liveDates.length,
      chartPoints,
      headlineFacts,
      raised: enrichedRaisedSnapshot,
      inProgress: finalFollowUp.inProgress,
      doneForYou: finalFollowUp.doneForYou,
      noticedAndLetGo: noticedList,
      groupedLetGo: buildGroupedLetGo(noticedList),
      trace: allTrace.slice().reverse(),
      todayCandidates: lastTodayCandidates,
      watcherEvalLog,
      pendingInvestigationId: pendingSituation?.candidateId,
      reactions: reactions.filter((r) => r.date <= targetDate),
      builtTools: visibleBuiltTools,
      refundSwitchEnabled,
      reviewedRefundIds,
      refundRows,
      toolUnreviewedFact,
      autonomyRecord,
      lostAutonomyReason: autonomyRecord.lostAutonomyReason,
      endStatement,
      geminiMode: getGeminiPlaybackMode(),
      geminiCapBanner: getGeminiCapBanner() ?? undefined,
      moneyAccount,
      storeBoard,
      doneForYouProofBars,
    },
    sim,
    pendingSituation,
    decisions,
    dismissedStockStores,
  };
}
