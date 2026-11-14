import {
  ActionDecision,
  Candidate,
  SilenceCheckResult,
} from '../types/domain';
import {
  addDays,
  diffDays,
  formatShortDate,
  getCalendarLabelsForDate,
  getCalendarSpansOverlappingRange,
  getEventFactor,
  getEventSpanForDate,
  getIsoWeekdayIndex,
  getSeasonFactor,
} from '../engine/calendar';
import { SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP } from '../engine/stores';

/**
 * Evaluate all 5 silence checks for a candidate on `date`.
 * Each check returns triggered (yes/no) and a one-line plain-words reason.
 */
export function evaluateSilenceChecks(
  candidate: Omit<Candidate, 'silenceChecks' | 'explainedBy'>,
  sim: SimulationRun,
  date: string,
  decisions: ActionDecision[],
  controlStores: Set<string>,
): SilenceCheckResult[] {
  const results: SilenceCheckResult[] = [];

  // 1. Calendar check (reads exclusively from TRADING_CALENDAR via calendar helpers)
  {
    let triggered = false;
    let reason = 'No trading-calendar season or moved event accounts for this variance.';

    if (candidate.kind === 'day_out_of_line') {
      const lyDate = addDays(date, -364);
      const todayEvent = getEventSpanForDate(date);
      const lyEvent = getEventSpanForDate(lyDate);
      if (todayEvent && !lyEvent) {
        triggered = true;
        reason = `${todayEvent.label} fell on ${formatShortDate(date)}, a week later than in ${todayEvent.year - 1}.`;
      } else if (!todayEvent && lyEvent) {
        triggered = true;
        reason = `${lyEvent.label} fell 364 days earlier (${formatShortDate(lyDate)}), creating an unadjusted year-on-year dip.`;
      } else {
        const labels = getCalendarLabelsForDate(date);
        if (labels.length > 0) {
          triggered = true;
          reason = `Day sits inside ${labels.join(' and ')} on the trading calendar.`;
        }
      }
    } else if (candidate.kind === 'drop_or_jump') {
      const last7Start = addDays(date, -6);
      const prev28Start = addDays(date, -34);
      const prev28End = addDays(date, -7);

      const recentSpans = getCalendarSpansOverlappingRange(last7Start, date);
      const baselineSpans = getCalendarSpansOverlappingRange(prev28Start, prev28End);
      const recentSeason = recentSpans.find((s) => s.kind === 'season') ?? recentSpans[0];
      const baselineSeason = baselineSpans.find((s) => s.kind === 'season') ?? baselineSpans[0];

      let recentCalSum = 0;
      for (let k = 0; k < 7; k++) {
        const d = addDays(last7Start, k);
        recentCalSum += getSeasonFactor(d) * getEventFactor(d);
      }
      let prevCalSum = 0;
      for (let k = 0; k < 28; k++) {
        const d = addDays(prev28Start, k);
        prevCalSum += getSeasonFactor(d) * getEventFactor(d);
      }
      const recentCalAvg = recentCalSum / 7;
      const prevCalAvg = prevCalSum / 28;
      const calShift = prevCalAvg > 0 ? recentCalAvg / prevCalAvg - 1 : 0;

      if (candidate.thing.endsWith(':drop') && calShift <= -0.10) {
        triggered = true;
        const label = recentSeason?.label ?? 'Seasonal dip';
        reason = `${label}: sales fell as they did last year.`;
      } else if (candidate.thing.endsWith(':jump') && calShift >= 0.12) {
        triggered = true;
        if (baselineSeason && baselineSeason.factor < 1.0) {
          reason = `${baselineSeason.label} ended after ${formatShortDate(baselineSeason.endDate)}, returning to normal baseline.`;
        } else {
          reason = `${recentSeason?.label ?? 'Trading calendar shift'} accounts for the weekly jump.`;
        }
      }
    }

    results.push({ check: 'calendar', triggered, reason });
  }

  // 2. Opening ramp check
  {
    let triggered = false;
    let reason = 'Not an opening-ramp fade at a newly opened store.';

    if (candidate.storeId && candidate.kind === 'drop_or_jump' && candidate.thing.endsWith(':drop')) {
      const store = STORE_MAP[candidate.storeId];
      if (!store.isEstablished) {
        const ageDays = diffDays(store.openedDate, date);
        if (ageDays >= 0 && ageDays <= 60) {
          triggered = true;
          reason = `${store.name} is ${ageDays} days old (inside first 60 days) and follows Burlingame's opening fade from 2.2× to 1.0× base.`;
        }
      }
    }

    results.push({ check: 'opening_ramp', triggered, reason });
  }

  // 3. Partial period check
  {
    let triggered = false;
    let reason = 'Comparison uses complete rolling or finished-week windows.';

    if (candidate.kind === 'lfl_break') {
      const weekdayIdx = getIsoWeekdayIndex(date);
      if (weekdayIdx === 6 && sim.dates.indexOf(date) < 14) {
        triggered = true;
        reason = 'Comparison includes an unfinished week.';
      }
    }

    results.push({ check: 'partial_period', triggered, reason });
  }

  // 4. Already handled check
  {
    let triggered = false;
    let reason = 'No open action or control holdout covers this item.';

    if (candidate.storeId && controlStores.has(candidate.storeId)) {
      triggered = true;
      reason = `${STORE_MAP[candidate.storeId].name} is deliberately held out as a control store.`;
    } else {
      const matchingDecision = decisions.find(
        (d) =>
          d.candidateId === candidate.id ||
          (d.storeId &&
            d.storeId === candidate.storeId &&
            (!d.groupId || d.groupId === candidate.groupId)),
      );
      if (matchingDecision) {
        triggered = true;
        reason = `Already handled by action ${matchingDecision.id} on ${matchingDecision.date}.`;
      }
    }

    results.push({ check: 'already_handled', triggered, reason });
  }

  // 5. Stock returned check: jump within 14 days after stock of a group returned from zero
  {
    let triggered = false;
    let reason = 'No recent delivery returning a zero-stock group accounts for a rebound.';

    const isJump =
      (candidate.kind === 'drop_or_jump' && candidate.thing.endsWith(':jump')) ||
      (candidate.kind === 'day_out_of_line' && candidate.thing.endsWith(':jump'));

    if (isJump) {
      if (candidate.storeId) {
        const recovery = sim.getRecentZeroRecoveryDelivery(candidate.storeId, date, 14);
        if (recovery) {
          const grpName = recovery.groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
          triggered = true;
          reason = `${STORE_MAP[candidate.storeId].name}: stock returned after the delivery of ${formatShortDate(recovery.date)} (${grpName}).`;
        }
      } else {
        const recoveries = ESTABLISHED_STORES.map((s) =>
          sim.getRecentZeroRecoveryDelivery(s.id, date, 14),
        ).filter((r): r is NonNullable<typeof r> => r !== null);
        if (recoveries.length > 0) {
          triggered = true;
          reason = `Chain rebound: stock returned after the delivery of ${formatShortDate(recoveries[0].date)}.`;
        }
      }
    }

    results.push({ check: 'stock_returned', triggered, reason });
  }

  return results;
}

export function applySilenceChecks(
  rawCandidate: Omit<Candidate, 'silenceChecks' | 'explainedBy'>,
  sim: SimulationRun,
  date: string,
  decisions: ActionDecision[],
  controlStores: Set<string>,
): Candidate {
  const silenceChecks = evaluateSilenceChecks(
    rawCandidate,
    sim,
    date,
    decisions,
    controlStores,
  );
  const explainedBy = silenceChecks.find((c) => c.triggered) ?? null;

  return {
    ...rawCandidate,
    silenceChecks,
    explainedBy,
  };
}
