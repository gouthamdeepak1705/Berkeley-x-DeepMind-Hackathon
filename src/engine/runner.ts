import {
  ActionDecision,
  Candidate,
  DayState,
  DiagnosticReport,
  DiagnosticTargetResult,
  Fact,
  GroupedLetGoItem,
  NoticedAndLetGoItem,
  ProductGroupId,
  RaisedItem,
  RaisedStoreSnapshot,
  StoreId,
  SupportingEvidence,
  TraceEntry,
} from '../types/domain';
import { buildMoneyAccountData, buildStoreBoard } from '../money/account';
import {
  addDays,
  diffDays,
  formatShortDate,
  getCalendarLabelsForDate,
  getIsoWeekKey,
  getIsoWeekdayIndex,
  LIVE_END_DATE,
  LIVE_START_DATE,
} from './calendar';
import { createFact } from './facts';
import { DEFAULT_SEED } from './prng';
import { runSimulation, SimulationRun } from './simulation';
import { ESTABLISHED_STORES, STORE_MAP } from './stores';
import { runDetectorsForDay } from '../detectors/detectors';
import { applySilenceChecks } from '../detectors/silenceChecks';

export interface LiveTimeline {
  sim: SimulationRun;
  dayStates: DayState[];
}

interface InternalSituation {
  id: string;
  firstDetectedOn: string;
  lastSeenOn: string;
  title: string;
  summary: string;
  detectorKind: Candidate['kind'];
  groupId?: ProductGroupId;
  // Frozen initial facts from firstDetectedOn
  initialExpected: Fact;
  initialActual: Fact;
  initialStakePerWeek: Fact;
  // Latest facts updated up to current day D
  todayDate: string;
  todayExpected: Fact;
  todayActual: Fact;
  todayStakePerWeek: Fact;
  // Per-store snapshots (for stock situations)
  stores: Map<StoreId, RaisedStoreSnapshot>;
  // Linked supporting evidence keyed by base candidate key (kind:thing)
  evidence: Map<string, SupportingEvidence>;
  groundTruth?: Candidate['groundTruth'];
}

function cloneFact(f: Fact): Fact {
  return { ...f };
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

function getGroupDisplayName(groupId: ProductGroupId): string {
  if (groupId === 'best_sellers') return 'Best-sellers';
  if (groupId === 'knitwear') return 'Knitwear';
  return 'Everything else';
}

function buildLetGoMetadata(
  cand: Candidate,
  date: string,
): {
  weekKey: string;
  groupSummaryKey: string;
  groupHeadline: string;
  storeName?: string;
} {
  const weekKey = getIsoWeekKey(date);
  const storeName = cand.storeId ? STORE_MAP[cand.storeId].name : undefined;
  const check = cand.explainedBy!.check;

  if (check === 'calendar' && cand.kind === 'drop_or_jump') {
    const dir = cand.thing.endsWith(':drop') ? 'drop' : 'jump';
    const isLullEnded = cand.explainedBy!.reason.toLowerCase().includes('ended after');
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
      storeName,
    };
  }

  if (check === 'stock_returned') {
    return {
      weekKey,
      groupSummaryKey: `stock_returned:${cand.kind}:${weekKey}`,
      groupHeadline: 'Stock returned after delivery: sales rebounded',
      storeName,
    };
  }

  if (check === 'already_handled') {
    const reason = cand.explainedBy!.reason;
    const isControl = reason.toLowerCase().includes('control store');
    return {
      weekKey,
      groupSummaryKey: isControl
        ? `already_handled:control:${cand.storeId ?? 'store'}:${weekKey}`
        : `already_handled:decision:${weekKey}:${reason}`,
      groupHeadline: reason,
      storeName,
    };
  }

  return {
    weekKey,
    groupSummaryKey: `${check}:${cand.id}:${weekKey}`,
    groupHeadline: cand.explainedBy!.reason,
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

    out.push({
      id: key,
      date: mostRecentDate,
      weekKey: groupItems[0].weekKey,
      checkKind: groupItems[0].checkKind,
      headline,
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

export function buildLiveTimeline(
  seed: number = DEFAULT_SEED,
  decisions: ActionDecision[] = [],
  controlStores: Set<string> = new Set(),
): LiveTimeline {
  const sim = runSimulation(seed, decisions, LIVE_END_DATE);
  const dayStates: DayState[] = [];

  const openSituations = new Map<string, InternalSituation>();
  // Tracks which situation an open candidate (keyed by kind:thing) is attached to (directly or as linked evidence)
  const activeEpisodeSituation = new Map<string, string>();
  // Tracks open stock candidates by group -> stores currently open for that group
  const openStockByGroup = new Map<'best_sellers' | 'knitwear', Map<StoreId, string>>();

  const letGoMap = new Map<string, NoticedAndLetGoItem>();
  const allTrace: TraceEntry[] = [];
  const loggedTraceEpisodes = new Set<string>();

  for (let i = 0; i < sim.liveDates.length; i++) {
    const date = sim.liveDates[i];
    const rawCandidates = runDetectorsForDay(sim, date);
    const todayCandidates = rawCandidates.map((rc) =>
      applySilenceChecks(rc, sim, date, decisions, controlStores),
    );

    // Process stock_running_out first so open stock situations exist before evaluating consequences on the same day
    const orderedCandidates = [...todayCandidates].sort((a, b) => {
      if (a.kind === 'stock_running_out' && b.kind !== 'stock_running_out') return -1;
      if (a.kind !== 'stock_running_out' && b.kind === 'stock_running_out') return 1;
      return 0;
    });

    for (const cand of orderedCandidates) {
      if (cand.explainedBy) {
        const meta = buildLetGoMetadata(cand, date);
        const letGoId = `${cand.id}:letgo:${cand.explainedBy.check}:${meta.weekKey}`;
        if (!loggedTraceEpisodes.has(letGoId)) {
          loggedTraceEpisodes.add(letGoId);

          allTrace.push({
            id: `trace:${date}:det:${letGoId}`,
            date,
            lane: 'manager',
            kind: 'detector',
            headline: cand.title,
            detail: cand.summary,
            outcome: 'let_go',
            facts: [cloneFact(cand.expected), cloneFact(cand.actual), cloneFact(cand.stakePerWeek)],
          });

          const checkSummary = cand.silenceChecks
            .map((sc) => `${sc.check.replace('_', ' ')}: ${sc.triggered ? 'yes' : 'no'}`)
            .join(' · ');

          allTrace.push({
            id: `trace:${date}:sc:${letGoId}`,
            date,
            lane: 'manager',
            kind: 'silence_check',
            headline: `Let go (${cand.explainedBy.check.replace('_', ' ')})`,
            detail: `${cand.explainedBy.reason} (${checkSummary})`,
            outcome: 'let_go',
          });

          letGoMap.set(letGoId, {
            candidateId: letGoId,
            date,
            reason: cand.explainedBy.reason,
            groupSummaryKey: meta.groupSummaryKey,
            groupHeadline: meta.groupHeadline,
            weekKey: meta.weekKey,
            storeId: cand.storeId,
            storeName: meta.storeName,
            checkKind: cand.explainedBy.check,
            detectorKind: cand.kind,
            expected: cloneFact(cand.expected),
            actual: cloneFact(cand.actual),
            groundTruth: cand.groundTruth,
          });
        }
        continue;
      }

      // Unexplained candidate: check if it should link to an open stock situation (general rule, no store names/dates)
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
          const isNewEvidence = !sit.evidence.has(evKey);
          if (isNewEvidence) {
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
              id: `trace:${date}:det:${evKey}`,
              date,
              lane: 'manager',
              kind: 'detector',
              headline: cand.title,
              detail: cand.summary,
              outcome: 'info',
              facts: [cloneFact(cand.expected), cloneFact(cand.actual), cloneFact(cand.stakePerWeek)],
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

      // If this candidate is stock_running_out, merge into its product group's open situation
      if (cand.kind === 'stock_running_out' && cand.storeId && (cand.groupId === 'best_sellers' || cand.groupId === 'knitwear')) {
        const grpId = cand.groupId;
        const grpName = getGroupDisplayName(grpId);
        const sitId = `situation:stock_running_out:${grpId}`;
        let groupStores = openStockByGroup.get(grpId);
        if (!groupStores) {
          groupStores = new Map();
          openStockByGroup.set(grpId, groupStores);
        }

        const isNewStoreHit = !groupStores.has(cand.storeId);
        if (isNewStoreHit) {
          groupStores.set(cand.storeId, cand.id);
          activeEpisodeSituation.set(cand.id, sitId);

          allTrace.push({
            id: `trace:${date}:det:${cand.id}`,
            date,
            lane: 'manager',
            kind: 'detector',
            headline: cand.title,
            detail: cand.summary,
            outcome: 'raised',
            facts: [cloneFact(cand.expected), cloneFact(cand.actual), cloneFact(cand.stakePerWeek)],
          });

          const checkSummary = cand.silenceChecks
            .map((sc) => `${sc.check.replace('_', ' ')}: ${sc.triggered ? 'yes' : 'no'}`)
            .join(' · ');

          allTrace.push({
            id: `trace:${date}:sc:${cand.id}`,
            date,
            lane: 'manager',
            kind: 'silence_check',
            headline: 'Not explained by silence checks — raised',
            detail: `All checks clear (${checkSummary}). ${
              openSituations.has(sitId)
                ? `Added to open situation: ${grpName} running short.`
                : 'Placed in Needs you.'
            }`,
            outcome: 'raised',
          });
        }

        let sit = openSituations.get(sitId);
        if (!sit) {
          const storesMap = new Map<StoreId, RaisedStoreSnapshot>();
          storesMap.set(cand.storeId, {
            storeId: cand.storeId,
            storeName: STORE_MAP[cand.storeId].name,
            firstDetectedOn: date,
            initialExpected: cloneFact(cand.expected),
            initialActual: cloneFact(cand.actual),
            initialStakePerWeek: cloneFact(cand.stakePerWeek),
          });
          sit = {
            id: sitId,
            firstDetectedOn: date,
            lastSeenOn: date,
            title: `${grpName} running short`,
            summary: cand.summary,
            detectorKind: cand.kind,
            groupId: grpId,
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
          };
          openSituations.set(sitId, sit);
        } else {
          sit.lastSeenOn = date;
          const existingStore = sit.stores.get(cand.storeId);
          if (!existingStore) {
            sit.stores.set(cand.storeId, {
              storeId: cand.storeId,
              storeName: STORE_MAP[cand.storeId].name,
              firstDetectedOn: date,
              initialExpected: cloneFact(cand.expected),
              initialActual: cloneFact(cand.actual),
              initialStakePerWeek: cloneFact(cand.stakePerWeek),
            });
            // If this store joined on the same day the situation was first raised, include its stake in initialStakePerWeek
            if (date === sit.firstDetectedOn) {
              const totalInitStake = Array.from(sit.stores.values()).reduce(
                (s, st) => s + st.initialStakePerWeek.value,
                0,
              );
              const lowestInitActual = Array.from(sit.stores.values()).reduce(
                (minSt, st) =>
                  st.initialActual.value < minSt.initialActual.value ? st : minSt,
              );
              sit.initialActual = cloneFact(lowestInitActual.initialActual);
              sit.initialStakePerWeek = createFact(
                `sit:${grpId}:${date}:init_stake`,
                'Combined weekly sales at risk',
                totalInitStake,
                'USD',
                `Sum of estimated weekly ${grpName} demand across affected stores on ${formatShortDate(date)}.`,
              );
            }
          } else if (date > existingStore.firstDetectedOn) {
            existingStore.todayExpected = cloneFact(cand.expected);
            existingStore.todayActual = cloneFact(cand.actual);
            existingStore.todayStakePerWeek = cloneFact(cand.stakePerWeek);
          }
        }
        continue;
      }

      // Non-stock unexplained candidate (e.g. refunds_out_of_line, or unlinked drop/break)
      const sitId = activeEpisodeSituation.get(cand.id) ?? cand.id;
      const existing = openSituations.get(sitId);
      if (!existing) {
        activeEpisodeSituation.set(cand.id, sitId);
        allTrace.push({
          id: `trace:${date}:det:${cand.id}`,
          date,
          lane: 'manager',
          kind: 'detector',
          headline: cand.title,
          detail: cand.summary,
          outcome: 'raised',
          facts: [cloneFact(cand.expected), cloneFact(cand.actual), cloneFact(cand.stakePerWeek)],
        });

        const checkSummary = cand.silenceChecks
          .map((sc) => `${sc.check.replace('_', ' ')}: ${sc.triggered ? 'yes' : 'no'}`)
          .join(' · ');

        allTrace.push({
          id: `trace:${date}:sc:${cand.id}`,
          date,
          lane: 'manager',
          kind: 'silence_check',
          headline: 'Not explained by silence checks — raised',
          detail: `All checks clear (${checkSummary}). Placed in Needs you.`,
          outcome: 'raised',
        });

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

        openSituations.set(sitId, {
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
        });
      } else {
        existing.lastSeenOn = date;
        existing.todayDate = date;
        existing.todayExpected = cloneFact(cand.expected);
        existing.todayActual = cloneFact(cand.actual);
        existing.todayStakePerWeek = cloneFact(cand.stakePerWeek);
      }
    }

    // Recompute day-D live "today" summary facts for every open situation strictly from data <= D
    for (const sit of openSituations.values()) {
      if (sit.detectorKind === 'stock_running_out' && (sit.groupId === 'best_sellers' || sit.groupId === 'knitwear')) {
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

    // Build deep-cloned immutable snapshot of open situations for day D
    const raisedSnapshot: RaisedItem[] = Array.from(openSituations.values()).map((sit) => {
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
      };
    });

    // Build chart points up to `date`
    const chartPoints = sim.liveDates.slice(0, i + 1).map((d) => {
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

    const chainRec = sim.chainRecordsByDate[date];
    const headlineFacts = {
      total28dSales: createFact(
        `chain:28d_sales:${date}`,
        'Last 28 days total sales (all stores)',
        chainRec.allStoresTrailing28Sales,
        'USD',
        `Sum of actual daily sales across all open stores from ${addDays(date, -27)} to ${date}.`,
      ),
      lastYear28dSales: createFact(
        `chain:ly_28d_sales:${date}`,
        'Last year 28-day baseline',
        chainRec.lastYearAllStoresTrailing28Sales,
        'USD',
        'Sum of matching prior-year day sales over the same 28-day calendar window.',
      ),
      total28dChangePct: createFact(
        `chain:28d_change_pct:${date}`,
        'Total 28-day change vs last year',
        chainRec.allStores28dVsLastYearPct,
        'percent',
        '(All-store 28-day sales ÷ prior-year 28-day sales) − 1.',
      ),
      lfl28dVsExpectedPct: createFact(
        `chain:lfl_28d_pct:${date}`,
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

    const dayGroupedLetGo = buildGroupedLetGo(noticedList);
    const dayMoneyAccount =
      i === 0
        ? buildMoneyAccountData({
            seed,
            sim,
            date,
            raised: raisedSnapshot,
            decisions,
            reactions: [],
            autonomyReactions: [],
            doneForYou: [],
            noticedAndLetGo: noticedList,
            builtTools: [],
            watcherEvalLog: [],
            signalsCheckedCount: todayCandidates.length,
            askedOwnerCount: raisedSnapshot.length,
          })
        : undefined;
    const dayStoreBoard =
      i === 0 && dayMoneyAccount
        ? buildStoreBoard({
            sim,
            date,
            raised: raisedSnapshot,
            decisions,
            doneForYou: [],
            activeControlStores: controlStores,
            moneyAccount: dayMoneyAccount,
          })
        : undefined;

    dayStates.push({
      date,
      dayIndex: i,
      totalDays: sim.liveDates.length,
      chartPoints,
      headlineFacts,
      raised: raisedSnapshot,
      noticedAndLetGo: noticedList,
      groupedLetGo: dayGroupedLetGo,
      trace: allTrace.slice().reverse(),
      todayCandidates,
      moneyAccount: dayMoneyAccount,
      storeBoard: dayStoreBoard,
    });
  }

  return { sim, dayStates };
}

function isWithinFiveDays(actual: string | null, start: string, end: string): boolean {
  if (!actual) return false;
  if (actual >= start && actual <= end) return true;
  if (actual < start) return diffDays(actual, start) <= 5;
  return diffDays(end, actual) <= 5;
}

export function runFullDiagnostics(seed: number = DEFAULT_SEED): DiagnosticReport {
  const { sim, dayStates } = buildLiveTimeline(seed);

  const findFirstDate = (predicate: (ds: DayState) => boolean): string | null => {
    const found = dayStates.find(predicate);
    return found ? found.date : null;
  };

  // Helper: find first date a candidate matching predicate appears
  const findCandidateDate = (pred: (c: Candidate) => boolean): string | null =>
    findFirstDate((ds) => ds.todayCandidates.some(pred));

  const summerLullDate = findCandidateDate(
    (c) =>
      c.kind === 'drop_or_jump' &&
      c.explainedBy?.check === 'calendar' &&
      c.detectedOn >= '2026-08-01' &&
      c.detectedOn <= '2026-08-15',
  );

  const laborDayDipDate = findCandidateDate(
    (c) =>
      c.kind === 'day_out_of_line' &&
      c.thing === 'chain:dip' &&
      c.explainedBy?.check === 'calendar' &&
      c.detectedOn >= '2026-08-25' &&
      c.detectedOn <= '2026-09-05',
  );

  const laborDayJumpDate = findCandidateDate(
    (c) =>
      c.kind === 'day_out_of_line' &&
      c.thing === 'chain:jump' &&
      c.explainedBy?.check === 'calendar' &&
      c.detectedOn >= '2026-09-01' &&
      c.detectedOn <= '2026-09-12',
  );

  const bestSellersCoverLowDate = findCandidateDate(
    (c) =>
      c.kind === 'stock_running_out' &&
      (c.thing === 'union_square:best_sellers' ||
        c.thing === 'palo_alto:best_sellers' ||
        c.thing === 'santana_row:best_sellers'),
  );

  const lullEndJumpDate = findCandidateDate(
    (c) =>
      c.kind === 'drop_or_jump' &&
      c.thing === 'chain:jump' &&
      c.explainedBy?.check === 'calendar' &&
      c.detectedOn >= '2026-09-08' &&
      c.detectedOn <= '2026-09-20',
  );

  const napaFadeDate = findCandidateDate(
    (c) =>
      c.kind === 'drop_or_jump' &&
      c.storeId === 'napa' &&
      c.explainedBy?.check === 'opening_ramp',
  );

  const bigThreeStockoutDate = findFirstDate((ds) => {
    const recs = sim.storeRecordsByDate[ds.date];
    return (
      recs.union_square.groups.best_sellers.endingStock <= 0.01 &&
      recs.palo_alto.groups.best_sellers.endingStock <= 0.01 &&
      recs.santana_row.groups.best_sellers.endingStock <= 0.01
    );
  });

  const wcKnitwearDate = findCandidateDate(
    (c) => c.kind === 'stock_running_out' && c.thing === 'walnut_creek:knitwear',
  );

  const wcRefundsDate = findCandidateDate(
    (c) => c.kind === 'refunds_out_of_line' && c.storeId === 'walnut_creek',
  );

  const lflBreakDate = findCandidateDate((c) => c.kind === 'lfl_break');

  const pasadenaKnitwearDate = findCandidateDate(
    (c) => c.kind === 'stock_running_out' && c.thing === 'pasadena:knitwear',
  );

  const napaKnitwearDate = findCandidateDate(
    (c) => c.kind === 'stock_running_out' && c.thing === 'napa:knitwear',
  );

  const targets: DiagnosticTargetResult[] = [
    {
      key: 'summer_lull',
      label: 'Summer lull candidate, let go by calendar check',
      targetWindow: '3 to 8 August',
      targetStart: '2026-08-03',
      targetEnd: '2026-08-08',
      actualDate: summerLullDate,
      withinFiveDays: isWithinFiveDays(summerLullDate, '2026-08-03', '2026-08-08'),
      detail: 'Detector 1 (drop vs prior 4 weeks) silenced by Calendar check.',
    },
    {
      key: 'labor_day_moved',
      label: 'Labor Day moved: dip let go, then jump let go',
      targetWindow: '29 August to 8 September',
      targetStart: '2026-08-29',
      targetEnd: '2026-09-08',
      actualDate:
        laborDayDipDate && laborDayJumpDate
          ? `${laborDayDipDate} (dip), ${laborDayJumpDate} (jump)`
          : laborDayDipDate ?? laborDayJumpDate,
      withinFiveDays:
        isWithinFiveDays(laborDayDipDate, '2026-08-29', '2026-09-03') &&
        isWithinFiveDays(laborDayJumpDate, '2026-09-04', '2026-09-08'),
      detail: `Dip on ${laborDayDipDate ?? 'none'}, Jump on ${laborDayJumpDate ?? 'none'}, both silenced by Calendar check.`,
    },
    {
      key: 'bs_cover_low',
      label: 'First "stock running out" for Best-sellers at Union Square, Palo Alto, Santana Row',
      targetWindow: '4 to 8 September',
      targetStart: '2026-09-04',
      targetEnd: '2026-09-08',
      actualDate: bestSellersCoverLowDate,
      withinFiveDays: isWithinFiveDays(bestSellersCoverLowDate, '2026-09-04', '2026-09-08'),
      detail: 'Best-sellers cover drops below 2.5 weeks with donor stores >12 weeks.',
    },
    {
      key: 'lull_ending',
      label: 'Lull-ending jump, let go',
      targetWindow: '9 to 15 September',
      targetStart: '2026-09-09',
      targetEnd: '2026-09-15',
      actualDate: lullEndJumpDate,
      withinFiveDays: isWithinFiveDays(lullEndJumpDate, '2026-09-09', '2026-09-15'),
      detail: 'Post-lull rebound (>20% jump vs lull baseline) silenced by Calendar check.',
    },
    {
      key: 'napa_fade',
      label: 'Napa fading, let go by opening-ramp check',
      targetWindow: '15 September to 5 October',
      targetStart: '2026-09-15',
      targetEnd: '2026-10-05',
      actualDate: napaFadeDate,
      withinFiveDays: isWithinFiveDays(napaFadeDate, '2026-09-15', '2026-10-05'),
      detail: 'Napa weekly sales drop vs opening peak, silenced by Opening ramp check.',
    },
    {
      key: 'big_three_stockout',
      label: 'The three big stores run out of Best-sellers',
      targetWindow: '20 to 25 September',
      targetStart: '2026-09-20',
      targetEnd: '2026-09-25',
      actualDate: bigThreeStockoutDate,
      withinFiveDays: isWithinFiveDays(bigThreeStockoutDate, '2026-09-20', '2026-09-25'),
      detail: 'Union Square, Palo Alto, and Santana Row reach 0 Best-sellers stock.',
    },
    {
      key: 'wc_knitwear',
      label: 'Knitwear running out at Walnut Creek',
      targetWindow: '24 September',
      targetStart: '2026-09-24',
      targetEnd: '2026-09-24',
      actualDate: wcKnitwearDate,
      withinFiveDays: isWithinFiveDays(wcKnitwearDate, '2026-09-24', '2026-09-24'),
      detail: 'Walnut Creek Knitwear cover falls below 2.5 weeks.',
    },
    {
      key: 'wc_refunds',
      label: 'Refunds out of line at Walnut Creek',
      targetWindow: '2 October',
      targetStart: '2026-10-02',
      targetEnd: '2026-10-02',
      actualDate: wcRefundsDate,
      withinFiveDays: isWithinFiveDays(wcRefundsDate, '2026-10-02', '2026-10-02'),
      detail: '28-day refund rate crosses 2.5× median of other stores.',
    },
    {
      key: 'lfl_break',
      label: 'Like-for-like break, while total sales vs last year are still positive',
      targetWindow: '5 October',
      targetStart: '2026-10-05',
      targetEnd: '2026-10-05',
      actualDate: lflBreakDate,
      withinFiveDays: (() => {
        if (!isWithinFiveDays(lflBreakDate, '2026-10-05', '2026-10-05')) return false;
        const ds = dayStates.find((d) => d.date === lflBreakDate);
        return ds ? ds.headlineFacts.total28dChangePct.value > 0 : false;
      })(),
      detail: (() => {
        const ds = dayStates.find((d) => d.date === lflBreakDate);
        const totalPct = ds ? ds.headlineFacts.total28dChangePct.formatted : 'n/a';
        return `2 full weeks >8 pts below expectation; total 28d vs last year is ${totalPct}.`;
      })(),
    },
    {
      key: 'pasadena_knitwear',
      label: 'Knitwear running out at Pasadena',
      targetWindow: '14 October',
      targetStart: '2026-10-14',
      targetEnd: '2026-10-14',
      actualDate: pasadenaKnitwearDate,
      withinFiveDays: isWithinFiveDays(pasadenaKnitwearDate, '2026-10-14', '2026-10-14'),
      detail: 'Pasadena Knitwear cover falls below 2.5 weeks.',
    },
    {
      key: 'napa_knitwear',
      label: 'Knitwear running out at Napa',
      targetWindow: '2 November',
      targetStart: '2026-11-02',
      targetEnd: '2026-11-02',
      actualDate: napaKnitwearDate,
      withinFiveDays: isWithinFiveDays(napaKnitwearDate, '2026-11-02', '2026-11-02'),
      detail: 'Napa Knitwear cover falls below 2.5 weeks.',
    },
  ];

  // Mid-October check (15 October 2026):
  // Like-for-like sales 10 to 20 points below expectation while total sales vs last year stay > 0
  const midOctDate = '2026-10-15';
  const midOctState = dayStates.find((d) => d.date === midOctDate) ?? dayStates[dayStates.length - 1];
  const lflPts = -midOctState.headlineFacts.lfl28dVsExpectedPct.value;
  const totalVsLy = midOctState.headlineFacts.total28dChangePct.value;
  const midOctPassed = lflPts >= 10 && lflPts <= 20 && totalVsLy > 0;

  return {
    seed,
    targets,
    midOctoberCheck: {
      date: midOctDate,
      lflPointsBelowExpectation: Math.round(lflPts * 10) / 10,
      total28dVsLastYearPct: Math.round(totalVsLy * 10) / 10,
      passed: midOctPassed,
    },
    allPassed: targets.every((t) => t.withinFiveDays) && midOctPassed,
  };
}
