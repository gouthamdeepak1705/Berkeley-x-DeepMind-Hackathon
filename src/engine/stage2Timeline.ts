import { runSituationInvestigation } from '../checker/checker';
import { runDetectorsForDay } from '../detectors/detectors';
import { applySilenceChecks } from '../detectors/silenceChecks';
import { evaluateWatcherBatch, WatcherSubjectOutcome } from '../watcher/watcher';
import { WatcherSubject } from '../watcher/briefing';
import {
  ActionDecision,
  Candidate,
  DayState,
  Fact,
  GroupedLetGoItem,
  InvestigationResult,
  NoticedAndLetGoItem,
  ProductGroupId,
  RaisedItem,
  RaisedStoreSnapshot,
  StoreId,
  SupportingEvidence,
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
import { ESTABLISHED_STORES, STORE_MAP } from './stores';

export interface Stage2StepResponse {
  dayState: DayState;
  sim: SimulationRun;
  pendingSituation?: RaisedItem;
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
    const mostRecentDate = groupItems.reduce(
      (maxD, it) => (it.date > maxD ? it.date : maxD),
      groupItems[0].date,
    );

    let headline = groupItems[0].reason;
    if (storeItems.length > 1) {
      const checkKind = groupItems[0].checkKind;
      if (checkKind === 'calendar' && key.includes(':drop:')) {
        headline = `Summer lull: sales fell at ${storeItems.length} stores, as they did last year`;
      } else if (checkKind === 'calendar' && key.includes(':lull_ended:')) {
        headline = `Summer lull ended: sales jumped at ${storeItems.length} stores returning to baseline`;
      } else if (checkKind === 'calendar') {
        headline = `Trading calendar: sales shifted at ${storeItems.length} stores`;
      } else if (checkKind === 'stock_returned') {
        const match = groupItems[0].reason.match(/delivery of ([A-Za-z]+ \d+)/);
        const delDate = match ? match[1].trim() : '';
        headline = `Stock returned${delDate ? ` after ${delDate} delivery` : ''}: sales jumped at ${storeItems.length} stores`;
      } else {
        headline = `${groupItems[0].groupHeadline} (${storeItems.length} stores)`;
      }
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
  for (const t of inv.toolTrace) {
    allTrace.push({
      id: `trace:${date}:ds:tool:${inv.candidateId}:r${t.round}:${t.toolName}:${allTrace.length}`,
      date,
      lane: 'data_scientist',
      kind: 'tool_call',
      headline: `${t.toolName} (${t.argsSummary})`,
      detail: `${situationTitle} · ${inv.model} (${modeLabel}, ${inv.latencyMs} ms total) · Facts returned: ${t.factIds.join(', ') || 'none'}`,
      outcome: 'info',
      facts: t.facts.slice(0, 4).map(cloneFact),
      meta: {
        model: inv.model,
        mode: inv.mode,
        latencyMs: inv.latencyMs,
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
    detail: `Model ${inv.model} (${inv.mode}, ${inv.latencyMs} ms)${inv.usedFallbackWording ? ' · code wording fallback used' : ''} · Outcome: ${inv.outcomeKind.replace(/_/g, ' ')} — ${inv.outcomeDetail}`,
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

function buildRaisedItemSnapshot(
  sit: InternalSituation,
  date: string,
  sim: SimulationRun,
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
  };
}

/**
 * Evaluates the live timeline deterministically up to `targetDayIndex`,
 * running Gemini Decision on days with new or materially changed candidates,
 * and running/replaying investigations for raised situations.
 */
export async function evaluateStage2UpToDay(params: {
  seed?: number;
  targetDayIndex: number;
  decisions?: ActionDecision[];
  controlStores?: Set<string>;
  /** If true, runs investigation synchronously even for newly raised situations on targetDayIndex */
  investigateTargetDay?: boolean;
  /** Pre-completed investigations keyed by situationId (e.g. from SSE stream) */
  providedInvestigations?: Map<string, InvestigationResult>;
}): Promise<Stage2StepResponse> {
  const seed = params.seed ?? DEFAULT_SEED;
  const decisions = params.decisions ?? [];
  const controlStores = params.controlStores ?? new Set<string>();
  const sim = runSimulation(seed, decisions, LIVE_END_DATE);
  const clampedTarget = Math.max(0, Math.min(sim.liveDates.length - 1, params.targetDayIndex));

  const openSituations = new Map<string, InternalSituation>();
  const openStockByGroup = new Map<'best_sellers' | 'knitwear', Map<StoreId, string>>();
  const activeEpisodeSituation = new Map<string, string>();
  const letGoMap = new Map<string, NoticedAndLetGoItem>();
  const watchedMap = new Map<string, WatchedState>();
  const allTrace: TraceEntry[] = [];
  const watcherEvalLog: WatcherEvalRecord[] = [];
  const completedInvestigations = new Map<string, InvestigationResult>(
    params.providedInvestigations ?? [],
  );

  let pendingSituation: RaisedItem | undefined;
  let lastTodayCandidates: Candidate[] = [];

  for (let i = 0; i <= clampedTarget; i++) {
    const date = sim.liveDates[i];
    const rawCandidates = runDetectorsForDay(sim, date);
    const todayCandidates = rawCandidates.map((rc) =>
      applySilenceChecks(rc, sim, date, decisions, controlStores),
    );
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
      const weekKey = getIsoWeekKey(date);
      const letGoKey = `${key}:letgo:${weekKey}`;
      if (letGoMap.has(letGoKey)) continue;

      const primary = members.reduce((a, b) =>
        b.stakePerWeek.value > a.stakePerWeek.value ? b : a,
      );
      const totalStake = members.reduce((s, m) => s + m.stakePerWeek.value, 0);
      const prevWatch = watchedMap.get(key);
      if (
        prevWatch &&
        !shouldMateriallyReask(prevWatch, primary, members.length, date)
      ) {
        continue;
      }

      const grpName = getGroupDisplayName(grpId);
      const storeNames = members
        .map((m) => (m.storeId ? STORE_MAP[m.storeId].name : ''))
        .filter(Boolean);

      subjectsToAsk.push({
        key,
        title: `${grpName} running short — ${storeNames.join(', ')}`,
        primaryCandidate: primary,
        memberCandidates: members,
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
        buildRaisedItemSnapshot(s, date, sim),
      );
      const letGoSummaries = Array.from(letGoMap.values()).map((lg) => lg.reason);

      const batch = await evaluateWatcherBatch({
        sim,
        date,
        subjects: subjectsToAsk,
        openSituations: openListForBrief,
        letGoSummaries,
        decisions,
        controlStores,
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

      // Per-request summary in Manager trace
      const perCandLines = subjectsToAsk.map((subj) => {
        const out = batch.outcomes.get(subj.key);
        if (!out) return `${subj.title}: no answer`;
        return `${subj.title} -> ${out.choice} (conf ${out.confidence.toFixed(2)}, explained ${out.explainedProb.toFixed(2)}, urgency: ${out.urgencyLevel})`;
      });

      const batchModeLabel = batch.mode === 'fallback' ? 'fallback, Gemini not used' : batch.mode;
      allTrace.push({
        id: `trace:${date}:mgr:batch:${allTrace.length}`,
        date,
        lane: 'manager',
        kind: 'decision',
        headline: `Decision request (${batch.questionCount} questions, ${batch.latencyMs} ms)`,
        detail: `${batch.model} (${batchModeLabel}) · ${perCandLines.join(' | ')}`,
        outcome: Array.from(batch.outcomes.values()).some((o) => o.action === 'raise')
          ? 'raised'
          : 'let_go',
        meta: {
          model: batch.model,
          mode: batch.mode,
          latencyMs: batch.latencyMs,
          questionCount: batch.questionCount,
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

        // Check if an investigation already exists or needs to run
        const existingInv = completedInvestigations.get(newSit.id);
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
          }
        } else if (i < clampedTarget || params.investigateTargetDay) {
          const snap = buildRaisedItemSnapshot(newSit, date, sim);
          const inv = await runSituationInvestigation({
            situation: snap,
            sim,
            date,
          });
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
          }
        } else {
          // On targetDayIndex and not yet investigated: return pendingSituation so client streams live!
          pendingSituation = buildRaisedItemSnapshot(newSit, date, sim);
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
    }
  }

  const targetDate = sim.liveDates[clampedTarget];
  const raisedSnapshot: RaisedItem[] = Array.from(openSituations.values())
    .map((sit) => buildRaisedItemSnapshot(sit, targetDate, sim))
    .sort((a, b) => {
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

  return {
    dayState: {
      date: targetDate,
      dayIndex: clampedTarget,
      totalDays: sim.liveDates.length,
      chartPoints,
      headlineFacts,
      raised: raisedSnapshot,
      noticedAndLetGo: noticedList,
      groupedLetGo: buildGroupedLetGo(noticedList),
      trace: allTrace.slice().reverse(),
      todayCandidates: lastTodayCandidates,
      watcherEvalLog,
      pendingInvestigationId: pendingSituation?.candidateId,
    },
    sim,
    pendingSituation,
  };
}
