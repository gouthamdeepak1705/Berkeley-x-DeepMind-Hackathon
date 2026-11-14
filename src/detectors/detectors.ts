import {
  Candidate,
  DailyStoreRecord,
  GroundTruthTag,
  StoreId,
} from '../types/domain';
import {
  addDays,
  diffDays,
  getIsoWeekdayIndex,
} from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP, STORES } from '../engine/stores';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function inferGroundTruth(
  kind: Candidate['kind'],
  thing: string,
  date: string,
): GroundTruthTag | undefined {
  if (kind === 'drop_or_jump') {
    if (thing === 'chain:drop' && date >= '2026-08-01' && date <= '2026-08-20') {
      return 'near_miss:summer_lull_start';
    }
    if (thing === 'chain:jump' && date >= '2026-09-08' && date <= '2026-09-25') {
      return 'near_miss:summer_lull_end';
    }
    if (thing === 'napa:drop' && date >= '2026-09-10' && date <= '2026-10-15') {
      return 'near_miss:napa_ramp_fade';
    }
  }
  if (kind === 'day_out_of_line') {
    if (date >= '2026-08-28' && date <= '2026-09-02') {
      return 'near_miss:labor_day_dip';
    }
    if (date >= '2026-09-04' && date <= '2026-09-09') {
      return 'near_miss:labor_day_jump';
    }
  }
  if (kind === 'stock_running_out') {
    if (
      thing === 'union_square:best_sellers' ||
      thing === 'palo_alto:best_sellers' ||
      thing === 'santana_row:best_sellers'
    ) {
      return 'real:best_sellers_shortage';
    }
    if (thing === 'walnut_creek:knitwear') return 'real:walnut_creek_knitwear';
    if (thing === 'pasadena:knitwear') return 'real:pasadena_knitwear';
    if (thing === 'napa:knitwear') return 'real:napa_knitwear';
  }
  if (kind === 'lfl_break' || kind === 'store_out_of_line') {
    if (
      thing === 'established_chain' ||
      thing === 'union_square' ||
      thing === 'palo_alto' ||
      thing === 'santana_row'
    ) {
      return 'real:best_sellers_shortage';
    }
  }
  if (kind === 'refunds_out_of_line' && thing === 'walnut_creek') {
    return 'real:walnut_creek_refunds';
  }
  return undefined;
}

/**
 * Run all 6 cheap/wide detectors for a single simulated day `date`.
 * Returns raw Candidate objects (silenceChecks populated separately).
 */
export function runDetectorsForDay(
  sim: SimulationRun,
  date: string,
): Omit<Candidate, 'silenceChecks' | 'explainedBy'>[] {
  const candidates: Omit<Candidate, 'silenceChecks' | 'explainedBy'>[] = [];
  const dateIdx = sim.dates.indexOf(date);
  if (dateIdx < 35) return candidates;

  // 1. Drop or jump against recent weeks (chain + individual stores)
  // Last 7 days vs average week over previous 4 weeks (days -34..-7)
  {
    let chainLast7 = 0;
    let chainPrev28 = 0;
    for (let k = dateIdx - 6; k <= dateIdx; k++) {
      chainLast7 += sim.chainRecordsByDate[sim.dates[k]].establishedActualSales;
    }
    for (let k = dateIdx - 34; k <= dateIdx - 7; k++) {
      chainPrev28 += sim.chainRecordsByDate[sim.dates[k]].establishedActualSales;
    }
    const chainAvgWeek = chainPrev28 / 4;
    if (chainAvgWeek > 0) {
      const ratio = chainLast7 / chainAvgWeek - 1;
      if (Math.abs(ratio) > 0.20) {
        const dir = ratio < 0 ? 'drop' : 'jump';
        const thing = `chain:${dir}`;
        const diffDollars = chainLast7 - chainAvgWeek;
        candidates.push({
          id: `drop_or_jump:${thing}`,
          kind: 'drop_or_jump',
          thing,
          period: 'ongoing',
          detectedOn: date,
          title:
            dir === 'drop'
              ? 'Established-store weekly sales dropped more than 20%'
              : 'Established-store weekly sales jumped more than 20%',
          summary: `Last 7 days (${Math.round(chainLast7).toLocaleString('en-US')}) vs prior 4-week average (${Math.round(chainAvgWeek).toLocaleString('en-US')}).`,
          expected: createFact(
            `det:doj:${thing}:${date}:exp`,
            'Prior 4-week average week',
            chainAvgWeek,
            'USD',
            `Average weekly established-store sales over the 28 days before the last 7 days (${sim.dates[dateIdx - 34]} to ${sim.dates[dateIdx - 7]}).`,
          ),
          actual: createFact(
            `det:doj:${thing}:${date}:act`,
            'Last 7 days sales',
            chainLast7,
            'USD',
            `Sum of established-store actual sales from ${sim.dates[dateIdx - 6]} to ${date}.`,
          ),
          stakePerWeek: createFact(
            `det:doj:${thing}:${date}:stake`,
            'Weekly gap vs prior 4 weeks',
            Math.abs(diffDollars),
            'USD',
            'Absolute difference between the last 7 days and the prior 4-week weekly average.',
          ),
          groundTruth: inferGroundTruth('drop_or_jump', thing, date),
        });
      }
    }

    // Individual stores (only stores open >= 28 days)
    for (const store of STORES) {
      if (diffDays(store.openedDate, date) < 28) continue;
      let sLast7 = 0;
      let sPrev28 = 0;
      for (let k = dateIdx - 6; k <= dateIdx; k++) {
        sLast7 += sim.storeRecordsByDate[sim.dates[k]][store.id].actualSales;
      }
      for (let k = dateIdx - 34; k <= dateIdx - 7; k++) {
        sPrev28 += sim.storeRecordsByDate[sim.dates[k]][store.id].actualSales;
      }
      const sAvgWeek = sPrev28 / 4;
      if (sAvgWeek > 0) {
        const ratio = sLast7 / sAvgWeek - 1;
        if (Math.abs(ratio) > 0.20) {
          const dir = ratio < 0 ? 'drop' : 'jump';
          const thing = `${store.id}:${dir}`;
          candidates.push({
            id: `drop_or_jump:${thing}`,
            kind: 'drop_or_jump',
            thing,
            storeId: store.id,
            period: 'ongoing',
            detectedOn: date,
            title: `${store.name} weekly sales ${dir === 'drop' ? 'dropped' : 'jumped'} more than 20%`,
            summary: `${store.name} last 7 days moved ${(ratio * 100).toFixed(1)}% vs its prior 4-week average.`,
            expected: createFact(
              `det:doj:${thing}:${date}:exp`,
              `${store.name} prior 4-week avg`,
              sAvgWeek,
              'USD',
              `Average weekly sales at ${store.name} over ${sim.dates[dateIdx - 34]} to ${sim.dates[dateIdx - 7]}.`,
            ),
            actual: createFact(
              `det:doj:${thing}:${date}:act`,
              `${store.name} last 7 days`,
              sLast7,
              'USD',
              `Sum of ${store.name} actual sales from ${sim.dates[dateIdx - 6]} to ${date}.`,
            ),
            stakePerWeek: createFact(
              `det:doj:${thing}:${date}:stake`,
              'Weekly shift',
              Math.abs(sLast7 - sAvgWeek),
              'USD',
              `Absolute weekly variance at ${store.name} compared with its prior 4-week average.`,
            ),
            groundTruth: inferGroundTruth('drop_or_jump', thing, date),
          });
        }
      }
    }
  }

  // 2. Day out of line: chain sales on a day > 20% away from same weekday 364 days earlier (no calendar adjustment)
  {
    const lyDate = addDays(date, -364);
    const todayRec = sim.chainRecordsByDate[date];
    const lyRec = sim.chainRecordsByDate[lyDate];
    if (todayRec && lyRec && lyRec.establishedActualSales > 0) {
      const ratio = todayRec.establishedActualSales / lyRec.establishedActualSales - 1;
      if (Math.abs(ratio) > 0.20) {
        const dir = ratio < 0 ? 'dip' : 'jump';
        const thing = `chain:${dir}`;
        candidates.push({
          id: `day_out_of_line:${thing}`,
          kind: 'day_out_of_line',
          thing,
          period: 'ongoing',
          detectedOn: date,
          title:
            dir === 'dip'
              ? 'Single-day sales fell >20% vs same weekday last year'
              : 'Single-day sales jumped >20% vs same weekday last year',
          summary: `Established-store sales on ${date} were ${(ratio * 100).toFixed(1)}% vs ${lyDate} (364 days earlier, unadjusted).`,
          expected: createFact(
            `det:dool:${date}:exp`,
            `Sales on ${lyDate}`,
            lyRec.establishedActualSales,
            'USD',
            `Established-store sales 364 days earlier (${lyDate}) with no calendar adjustment.`,
          ),
          actual: createFact(
            `det:dool:${date}:act`,
            `Sales on ${date}`,
            todayRec.establishedActualSales,
            'USD',
            `Established-store actual sales on ${date}.`,
          ),
          stakePerWeek: createFact(
            `det:dool:${date}:stake`,
            'Day variance',
            Math.abs(todayRec.establishedActualSales - lyRec.establishedActualSales),
            'USD',
            'Absolute difference between today and the same weekday 364 days earlier.',
          ),
          groundTruth: inferGroundTruth('day_out_of_line', thing, date),
        });
      }
    }
  }

  // 3. Like-for-like break: established-store weekly sales vs expectation, > 8 points below, for 2 full weeks running
  {
    const weekdayIdx = getIsoWeekdayIndex(date);
    // Most recent full Mon-Sun week strictly completed before today:
    // If today is Mon (0), last completed Sun was yesterday (idx - 1).
    const daysBackToLastCompletedSunday = weekdayIdx + 1;
    const w2EndIdx = dateIdx - daysBackToLastCompletedSunday;
    const w2StartIdx = w2EndIdx - 6;
    const w1EndIdx = w2StartIdx - 1;
    const w1StartIdx = w1EndIdx - 6;

    if (w1StartIdx >= 0) {
      const sumWeek = (startI: number, endI: number) => {
        let act = 0;
        let exp = 0;
        for (let k = startI; k <= endI; k++) {
          const rec = sim.chainRecordsByDate[sim.dates[k]];
          act += rec.establishedActualSales;
          exp += rec.establishedExpectedSales;
        }
        return { act, exp, pctDiff: exp > 0 ? (act / exp - 1) * 100 : 0 };
      };

      const w1 = sumWeek(w1StartIdx, w1EndIdx);
      const w2 = sumWeek(w2StartIdx, w2EndIdx);

      if (w1.pctDiff < -8 && w2.pctDiff < -8) {
        candidates.push({
          id: `lfl_break:established_chain`,
          kind: 'lfl_break',
          thing: 'established_chain',
          period: 'ongoing',
          detectedOn: date,
          title: 'Like-for-like sales more than 8 points below expectation for 2 full weeks',
          summary: `Week 1 (${sim.dates[w1StartIdx]}..${sim.dates[w1EndIdx]}): ${w1.pctDiff.toFixed(1)}%; Week 2 (${sim.dates[w2StartIdx]}..${sim.dates[w2EndIdx]}): ${w2.pctDiff.toFixed(1)}%.`,
          expected: createFact(
            `det:lfl:${date}:exp`,
            'Expected weekly LFL sales',
            w2.exp,
            'USD',
            `Expected sales for ${sim.dates[w2StartIdx]} to ${sim.dates[w2EndIdx]} using prior-year matching days × (1 + 26-week median growth).`,
          ),
          actual: createFact(
            `det:lfl:${date}:act`,
            'Actual weekly LFL sales',
            w2.act,
            'USD',
            `Actual established-store sales for ${sim.dates[w2StartIdx]} to ${sim.dates[w2EndIdx]}.`,
          ),
          stakePerWeek: createFact(
            `det:lfl:${date}:stake`,
            'Weekly LFL shortfall',
            Math.max(0, w2.exp - w2.act),
            'USD',
            'Expected minus actual established-store sales in the latest completed week.',
          ),
          groundTruth: inferGroundTruth('lfl_break', 'established_chain', date),
        });
      }
    }
  }

  // 4. Store out of line: store's last 4 weeks against its own expectation > 15 points below median of established stores
  {
    const estPerfs: { storeId: StoreId; perf: number; act28: number; exp28: number }[] = [];
    for (const store of ESTABLISHED_STORES) {
      let act28 = 0;
      let exp28 = 0;
      for (let k = dateIdx - 27; k <= dateIdx; k++) {
        const r = sim.storeRecordsByDate[sim.dates[k]][store.id];
        act28 += r.actualSales;
        exp28 += r.expectedSales ?? 0;
      }
      if (exp28 > 0) {
        estPerfs.push({ storeId: store.id, perf: (act28 / exp28 - 1) * 100, act28, exp28 });
      }
    }
    const medianEstPerf = median(estPerfs.map((p) => p.perf));

    for (const store of STORES) {
      if (diffDays(store.openedDate, date) < 28) continue;
      let act28 = 0;
      let exp28 = 0;
      for (let k = dateIdx - 27; k <= dateIdx; k++) {
        const r = sim.storeRecordsByDate[sim.dates[k]][store.id];
        act28 += r.actualSales;
        exp28 += r.expectedSales ?? 0;
      }
      if (exp28 <= 0) continue;
      const perf = (act28 / exp28 - 1) * 100;
      if (perf - medianEstPerf < -15) {
        const weeklyShortfall = Math.max(0, (exp28 * (1 + medianEstPerf / 100) - act28) / 4);
        candidates.push({
          id: `store_out_of_line:${store.id}`,
          kind: 'store_out_of_line',
          thing: store.id,
          storeId: store.id,
          period: 'ongoing',
          detectedOn: date,
          title: `${store.name} is more than 15 points behind chain median`,
          summary: `${store.name} 28-day performance vs expectation (${perf.toFixed(1)}%) vs established median (${medianEstPerf.toFixed(1)}%).`,
          expected: createFact(
            `det:sool:${store.id}:${date}:exp`,
            'Established median vs expectation',
            medianEstPerf,
            'percent',
            'Median 28-day sales variance against expectation across the 8 established stores.',
          ),
          actual: createFact(
            `det:sool:${store.id}:${date}:act`,
            `${store.name} vs expectation`,
            perf,
            'percent',
            `${store.name} 28-day actual sales (${Math.round(act28).toLocaleString('en-US')}) divided by expected (${Math.round(exp28).toLocaleString('en-US')}) minus 1.`,
          ),
          stakePerWeek: createFact(
            `det:sool:${store.id}:${date}:stake`,
            'Weekly shortfall vs median',
            weeklyShortfall,
            'USD',
            `28-day shortfall at ${store.name} relative to the established-store median pace, divided by 4 weeks.`,
          ),
          groundTruth: inferGroundTruth('store_out_of_line', store.id, date),
        });
      }
    }
  }

  // 5. Stock running out: store & group under 2.5 weeks of cover, no delivery due within 14 days, while another store holds > 12 weeks
  {
    const todayRecs: Record<StoreId, DailyStoreRecord> = sim.storeRecordsByDate[date];
    for (const grpId of ['best_sellers', 'knitwear'] as const) {
      const avgPrice = grpId === 'best_sellers' ? 120 : 90;
      const grpName = grpId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';

      // Does another store hold > 12 weeks?
      const donorStores = STORES.filter((s) => {
        const rec = todayRecs[s.id];
        if (!rec.isOpen) return false;
        const cov = rec.groups[grpId].weeksOfCover;
        return cov !== null && cov > 12;
      });
      if (donorStores.length === 0) continue;

      for (const store of STORES) {
        if (sim.isDeliveryDueWithinDays(store.id, grpId, date, 14)) continue;
        const rec = todayRecs[store.id];
        if (!rec.isOpen) continue;
        const grpState = rec.groups[grpId];
        if (grpState.weeksOfCover === null) continue;
        if (grpState.weeksOfCover < 2.5) {
          const weeklyValueAtStake = grpState.potentialSales * 7;
          const thing = `${store.id}:${grpId}`;
          candidates.push({
            id: `stock_running_out:${thing}`,
            kind: 'stock_running_out',
            thing,
            storeId: store.id,
            groupId: grpId,
            period: 'ongoing',
            detectedOn: date,
            title: `${store.name} ${grpName} under 2.5 weeks of cover`,
            summary: `${store.name} holds ${grpState.weeksOfCover.toFixed(1)} weeks of ${grpName} cover; ${donorStores.length} stores hold over 12 weeks.`,
            expected: createFact(
              `det:sro:${thing}:${date}:exp`,
              'Safety cover threshold',
              2.5,
              'weeks',
              'Minimum 2.5 weeks of cover required when no replenishment delivery is scheduled within 14 days.',
            ),
            actual: createFact(
              `det:sro:${thing}:${date}:act`,
              `${store.name} ${grpName} cover`,
              grpState.weeksOfCover,
              'weeks',
              `Ending stock (${Math.round(grpState.endingStock)} units) divided by average weekly units sold over the last 28 in-stock days (avg unit price $${avgPrice}).`,
            ),
            stakePerWeek: createFact(
              `det:sro:${thing}:${date}:stake`,
              'Weekly sales at risk',
              weeklyValueAtStake,
              'USD',
              `Estimated weekly ${grpName} demand at ${store.name} if stock runs to zero.`,
            ),
            groundTruth: inferGroundTruth('stock_running_out', thing, date),
          });
        }
      }
    }
  }

  // 6. Refunds out of line: 28-day refund rate > 2.5x median of other stores
  {
    const storeRates: { storeId: StoreId; rate: number; refundSum: number; salesSum: number }[] = [];
    for (const store of STORES) {
      if (diffDays(store.openedDate, date) < 14) continue;
      let salesSum = 0;
      let refundSum = 0;
      for (let k = dateIdx - 27; k <= dateIdx; k++) {
        const r = sim.storeRecordsByDate[sim.dates[k]][store.id];
        if (!r.isOpen) continue;
        salesSum += r.actualSales;
        refundSum += r.refundAmount;
      }
      if (salesSum > 0) {
        storeRates.push({
          storeId: store.id,
          rate: refundSum / salesSum,
          refundSum,
          salesSum,
        });
      }
    }

    for (const entry of storeRates) {
      const others = storeRates.filter((e) => e.storeId !== entry.storeId).map((e) => e.rate);
      const otherMedian = median(others);
      if (otherMedian > 0 && entry.rate > 2.5 * otherMedian) {
        const store = STORE_MAP[entry.storeId];
        const excessWeekly = ((entry.rate - otherMedian) * entry.salesSum) / 4;
        candidates.push({
          id: `refunds_out_of_line:${entry.storeId}`,
          kind: 'refunds_out_of_line',
          thing: entry.storeId,
          storeId: entry.storeId,
          period: 'ongoing',
          detectedOn: date,
          title: `${store.name} refund rate is over 2.5× chain median`,
          summary: `${store.name} 28-day refund rate is ${(entry.rate * 100).toFixed(1)}% vs ${(otherMedian * 100).toFixed(1)}% median across other stores.`,
          expected: createFact(
            `det:ref:${entry.storeId}:${date}:exp`,
            'Other stores median refund rate',
            otherMedian * 100,
            'percent',
            'Median 28-day refund rate (refunds ÷ sales) across all other open stores.',
          ),
          actual: createFact(
            `det:ref:${entry.storeId}:${date}:act`,
            `${store.name} 28-day refund rate`,
            entry.rate * 100,
            'percent',
            `28-day refunds ($${Math.round(entry.refundSum).toLocaleString('en-US')}) divided by 28-day sales ($${Math.round(entry.salesSum).toLocaleString('en-US')}) at ${store.name}.`,
          ),
          stakePerWeek: createFact(
            `det:ref:${entry.storeId}:${date}:stake`,
            'Excess weekly refunds',
            excessWeekly,
            'USD',
            `Weekly refund dollars above the ${(otherMedian * 100).toFixed(1)}% store median over the last 28 days.`,
          ),
          groundTruth: inferGroundTruth('refunds_out_of_line', entry.storeId, date),
        });
      }
    }
  }

  return candidates;
}
