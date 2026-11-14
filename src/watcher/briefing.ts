import { addDays, formatShortDate, getCalendarSpansOverlappingRange } from '../engine/calendar';
import { SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP } from '../engine/stores';
import { ActionDecision, Candidate, ProductGroupId, RaisedItem, StoreId } from '../types/domain';

export interface WatcherSubject {
  key: string; // situationId or candidateId
  title: string;
  primaryCandidate: Candidate;
  memberCandidates: Candidate[];
  evidenceSummaries: string[];
  stakePerWeekUsd: number;
  daysVisible: number;
  hasCodeSilenceExplanation: boolean;
  codeSilenceReason: string | null;
  alreadyHandled: boolean;
}

function getGroupLabel(groupId?: ProductGroupId): string {
  if (groupId === 'best_sellers') return 'Best-sellers';
  if (groupId === 'knitwear') return 'Knitwear';
  return 'Everything else';
}

function computeNoiseComparisonText(cand: Candidate, sim: SimulationRun, date: string): string {
  if (cand.kind === 'stock_running_out') {
    const gap = Math.max(0, cand.expected.value - cand.actual.value);
    if (cand.actual.value <= 0.01) {
      return 'Cover has reached zero weeks (complete stockout against the 2.5-week safety floor).';
    }
    if (gap > 1.0) {
      return 'Stock cover is more than 1.0 week below the 2.5-week safety floor, far beyond normal weekly reorder fluctuation.';
    }
    return 'Stock cover just crossed below the 2.5-week safety floor.';
  }

  if (cand.kind === 'refunds_out_of_line') {
    const ratio = cand.expected.value > 0 ? cand.actual.value / cand.expected.value : 0;
    if (ratio >= 2.5) {
      return `The refund rate gap is ${ratio.toFixed(1)} times the normal store median (${cand.actual.formatted} vs ${cand.expected.formatted}), well above normal week-to-week store variation.`;
    }
    return `The refund rate (${cand.actual.formatted}) is slightly elevated compared with the other-store median (${cand.expected.formatted}).`;
  }

  if (cand.kind === 'lfl_break') {
    const diffPts = Math.abs(cand.actual.value - cand.expected.value);
    const ratio = diffPts / 4; // ~4 pts normal LFL week-to-week noise
    return `The like-for-like shortfall is roughly ${Math.max(1, Math.round(ratio))} times the normal week-to-week chain fluctuation (${cand.actual.formatted} vs ${cand.expected.formatted} expected).`;
  }

  // Sales drop/jump/day_out_of_line/store_out_of_line
  const exp = Math.max(1, cand.expected.value);
  const pctGap = Math.abs((cand.actual.value - exp) / exp) * 100;
  // Normal 7d noise is ~3%, 1d noise is ~6%, 28d noise is ~2%
  const normalNoisePct =
    cand.kind === 'day_out_of_line' ? 6 : cand.kind === 'store_out_of_line' ? 3 : 4;
  const multiple = pctGap / normalNoisePct;
  const recs = sim.storeRecordsByDate[date];
  const openCount = Object.values(recs).filter((r) => r.isOpen).length;
  return `Across ${openCount} open stores, the gap (${pctGap.toFixed(1)}%) is about ${Math.max(1, Math.round(multiple))} times normal ${cand.kind === 'day_out_of_line' ? 'daily' : 'weekly'} noise.`;
}

function buildDonorContext(sim: SimulationRun, date: string, groupId?: ProductGroupId): string {
  if (groupId !== 'best_sellers' && groupId !== 'knitwear') return '';
  const recs = sim.storeRecordsByDate[date];
  const eligible: string[] = [];
  for (const st of ESTABLISHED_STORES) {
    const gs = recs[st.id].groups[groupId];
    if (gs.weeksOfCover !== null && gs.weeksOfCover >= 12) {
      eligible.push(`${st.name} (${gs.weeksOfCover.toFixed(1)} wks)`);
    }
  }
  const nextDel = sim.scheduledDeliveries
    .filter((d) => d.groupId === groupId && d.date > date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const delNote = nextDel
    ? `Next scheduled supplier delivery is ${formatShortDate(nextDel.date)}.`
    : 'No supplier delivery is scheduled in the live window.';
  if (eligible.length > 0) {
    return `Idle donor stock sits in ${eligible.join(', ')} (above the 8-week donor floor). ${delNote}`;
  }
  return `No store holds 12+ weeks of donor surplus. ${delNote}`;
}

export function buildWatcherBriefing(params: {
  sim: SimulationRun;
  date: string;
  subjects: WatcherSubject[];
  openSituations: RaisedItem[];
  letGoSummaries: string[];
  decisions: ActionDecision[];
  controlStores: Set<string>;
}): string {
  const { sim, date, subjects, openSituations, letGoSummaries, decisions, controlStores } = params;

  const weekStart = addDays(date, -6);
  const overlappingSpans = getCalendarSpansOverlappingRange(weekStart, date);
  const pyShiftStart = addDays(weekStart, -364);
  const pyShiftEnd = addDays(date, -364);
  const priorYearSpans = getCalendarSpansOverlappingRange(pyShiftStart, pyShiftEnd);

  const lines: string[] = [];
  lines.push(
    `Date: ${formatShortDate(date)} (${date}). Business: Linden & Rye, a California womenswear chain with 8 established stores (open >18 months, forming the like-for-like benchmark) and 2 new stores (Burlingame opened June 2026; Napa opened 22 August 2026, included only in all-store totals).`,
  );
  lines.push(
    `Operating rules: Donor stores keep at least 8 weeks of cover plus cover to their next delivery + 1 week; transfers above 500 units require owner approval; every metric is computed by code.`,
  );

  // Calendar touching this week
  if (overlappingSpans.length === 0 && priorYearSpans.length === 0) {
    lines.push('Trading calendar this week: Normal trading week with no active seasonal regime or holiday event.');
  } else {
    const currentText = overlappingSpans
      .map((s) => `${s.label} (${formatShortDate(s.startDate)} to ${formatShortDate(s.endDate)})`)
      .join('; ');
    const pyText = priorYearSpans
      .map((s) => `${s.label} last year (${formatShortDate(s.startDate)} to ${formatShortDate(s.endDate)})`)
      .join('; ');
    lines.push(
      `Trading calendar touching this week: ${currentText || 'none this year'}. Matching prior-year dates: ${pyText || 'none'}.`,
    );
  }

  // Open / in-progress / control / closed context
  const openText =
    openSituations.length > 0
      ? openSituations
          .map((s) => `${s.title} (open since ${formatShortDate(s.firstDetectedOn)}, stake ${s.stakePerWeek.formatted}/wk)`)
          .join('; ')
      : 'none';
  const decisionText =
    decisions.length > 0
      ? decisions.map((d) => `${d.kind} for ${d.candidateId} on ${d.date}`).join('; ')
      : 'none';
  const controlText = controlStores.size > 0 ? Array.from(controlStores).join(', ') : 'none';
  const recentLetGoText = letGoSummaries.length > 0 ? letGoSummaries.slice(-4).join('; ') : 'none';

  lines.push(
    `Current state: Open situations = ${openText}. Actions already under way = ${decisionText}. Control holdout stores = ${controlText}. Recently let go = ${recentLetGoText}.`,
  );
  lines.push('');
  lines.push('Situations to evaluate today:');

  subjects.forEach((subj, idx) => {
    const cand = subj.primaryCandidate;
    const storeNames = subj.memberCandidates
      .map((m) => (m.storeId ? STORE_MAP[m.storeId as StoreId].name : undefined))
      .filter((n): n is string => Boolean(n));
    const storeDesc = storeNames.length > 0 ? storeNames.join(', ') : 'Established chain';
    const noiseText = computeNoiseComparisonText(cand, sim, date);
    const donorText = buildDonorContext(sim, date, cand.groupId);
    const checkWords = cand.silenceChecks
      .map((sc) => `${sc.check.replace('_', ' ')}: ${sc.triggered ? `EXPLAINED (${sc.reason})` : `clear (${sc.reason})`}`)
      .join(' | ');
    const evidenceText =
      subj.evidenceSummaries.length > 0
        ? ` Supporting linked evidence already explained by this shortage: ${subj.evidenceSummaries.join('; ')}.`
        : '';

    const groupDesc = cand.groupId ? ` (${getGroupLabel(cand.groupId)})` : '';
    lines.push(
      `[${idx + 1}] ${subj.title} [${subj.key}] — Scope: ${storeDesc}${groupDesc}. Expected ${cand.expected.formatted} (${cand.expected.note}); actual ${cand.actual.formatted}. ${noiseText} Estimated weekly money at stake: $${Math.round(subj.stakePerWeekUsd).toLocaleString('en-US')}/wk. Visible for ${subj.daysVisible} day(s). ${donorText ? `${donorText} ` : ''}Code silence checks: ${checkWords}.${evidenceText}`,
    );
  });

  return lines.join('\n');
}
