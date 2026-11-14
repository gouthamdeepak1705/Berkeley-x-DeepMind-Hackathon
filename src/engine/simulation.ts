import {
  ActionDecision,
  DailyChainRecord,
  DailyStoreRecord,
  DayOneBrief,
  DeliveredStockEvent,
  GroupDailyState,
  ProductGroupId,
  RefundRecord,
  ScheduledDelivery,
  StoreId,
} from '../types/domain';
import {
  addDays,
  diffDays,
  enumerateDates,
  getCalendarLabelsForDate,
  getEventFactor,
  getIsoWeekdayIndex,
  getMatchingPriorYearDate,
  getSeasonFactor,
  HISTORY_START_DATE,
  LIVE_END_DATE,
  LIVE_START_DATE,
  WEEKDAY_FACTORS,
} from './calendar';
import { createFact } from './facts';
import { DEFAULT_SEED, seededRange, seededUnit } from './prng';
import { ESTABLISHED_STORES, PRODUCT_GROUPS, STORE_MAP, STORES } from './stores';

export interface SimulationRun {
  seed: number;
  dates: string[];
  liveDates: string[];
  storeRecordsByDate: Record<string, Record<StoreId, DailyStoreRecord>>;
  chainRecordsByDate: Record<string, DailyChainRecord>;
  walnutCreekRefunds: RefundRecord[];
  median26WeekGrowthByDate: Record<string, number>;
  scheduledDeliveries: ScheduledDelivery[];
  deliveredEvents: DeliveredStockEvent[];
  isDeliveryDueWithinDays: (
    storeId: StoreId,
    groupId: 'best_sellers' | 'knitwear',
    date: string,
    days: number,
  ) => boolean;
  getRecentZeroRecoveryDelivery: (
    storeId: StoreId,
    date: string,
    withinDays: number,
  ) => DeliveredStockEvent | null;
  dayOneBrief: DayOneBrief;
}

/**
 * Opening ramp curve observed on new stores: starts at 2.2x base on opening day,
 * falling linearly to 1.0x over 30 days.
 */
export function getOpeningRampFactor(openedDate: string, currentDate: string): number {
  const age = diffDays(openedDate, currentDate);
  if (age < 0) return 0;
  if (age >= 30) return 1.0;
  return 2.2 - 1.2 * (age / 30);
}

/**
 * Calibrated starting stock multipliers (in weeks of base 1.0x weekly demand)
 * so every target event lands squarely on schedule.
 */
const BEST_SELLERS_SEP1_COVER_MULTIPLIER: Partial<Record<StoreId, number>> = {
  union_square: 2.74, // <2.5 wks ~Sep 7, stockout ~Sep 21
  palo_alto: 2.74,
  santana_row: 2.74,
  sacramento: 26.0, // 26 weeks
  santa_barbara: 26.0,
  rockridge: 26.0,
  walnut_creek: 12.0, // 12 weeks (never runs out before Nov 9 resumption)
  pasadena: 12.0,
  burlingame: 12.0,
  napa: 12.0,
};

// Knitwear starting stock on 2026-08-01 (or 2026-08-22 for Napa) in weeks of normal 1.0x demand
const KNITWEAR_LIVE_START_WEEKS_OF_BASE: Partial<Record<StoreId, number>> = {
  walnut_creek: 8.75, // crosses < 2.5 weeks cover around Sep 24
  pasadena: 11.75, // crosses < 2.5 weeks cover around Oct 14
  napa: 14.4, // from Aug 22 (with 30-day ramp), crosses < 2.5 weeks cover around Nov 2
};

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function runSimulation(
  seed: number = DEFAULT_SEED,
  decisions: ActionDecision[] = [],
  upToDate: string = LIVE_END_DATE,
): SimulationRun {
  const effectiveEnd = upToDate > LIVE_END_DATE ? LIVE_END_DATE : upToDate;
  const dates = enumerateDates(HISTORY_START_DATE, effectiveEnd);
  const liveDates = dates.filter((d) => d >= LIVE_START_DATE);

  const storeRecordsByDate: Record<string, Record<StoreId, DailyStoreRecord>> = {};
  const chainRecordsByDate: Record<string, DailyChainRecord> = {};
  const median26WeekGrowthByDate: Record<string, number> = {};
  const allWalnutCreekRefunds: RefundRecord[] = [];

  // Stock trackers (in units) for stock-limited groups per store
  const stockByStore: Record<StoreId, Record<'best_sellers' | 'knitwear', number>> = {} as Record<
    StoreId,
    Record<'best_sellers' | 'knitwear', number>
  >;

  // Track daily units sold and whether store had stock for 28-day cover calculation
  const unitsSoldHistory: Record<
    StoreId,
    Record<'best_sellers' | 'knitwear', { units: number; hadStock: boolean }[]>
  > = {} as Record<StoreId, Record<'best_sellers' | 'knitwear', { units: number; hadStock: boolean }[]>>;

  for (const store of STORES) {
    // Normal weekly unit demand at 1.0x base & 1.06 growth
    const bsNormalWeeklyUnits = (store.baseDailySales * 7 * 0.35 * 1.06) / 120;
    const kwNormalWeeklyUnits = (store.baseDailySales * 7 * 0.15 * 1.06) / 90;

    stockByStore[store.id] = {
      best_sellers: bsNormalWeeklyUnits * 8,
      knitwear: kwNormalWeeklyUnits * 60,
    };
    unitsSoldHistory[store.id] = {
      best_sellers: [],
      knitwear: [],
    };
  }

  const scheduledDeliveries: ScheduledDelivery[] = [];
  const deliveredEvents: DeliveredStockEvent[] = [];

  for (let idx = 0; idx < dates.length; idx++) {
    const d = dates[idx];
    const weekdayIdx = getIsoWeekdayIndex(d);
    if (d < LIVE_START_DATE && weekdayIdx === 0 && idx >= 7) {
      scheduledDeliveries.push({
        date: d,
        storeId: 'all',
        groupId: 'knitwear',
        kind: 'regular',
      });
    }
    if (d < '2026-09-01' && weekdayIdx === 0 && idx >= 7) {
      scheduledDeliveries.push({
        date: d,
        storeId: 'all',
        groupId: 'best_sellers',
        kind: 'regular',
      });
    }
  }
  scheduledDeliveries.push({
    date: '2026-11-09',
    storeId: 'all',
    groupId: 'best_sellers',
    kind: 'resumption',
  });

  // Track established chain daily sales by date for 26-week growth & matching prior year
  const estSalesByDate: Record<string, number> = {};
  const allSalesByDate: Record<string, number> = {};

  for (let idx = 0; idx < dates.length; idx++) {
    const date = dates[idx];
    const year = Number(date.slice(0, 4));
    const weekdayIdx = getIsoWeekdayIndex(date);
    const weekdayFactor = WEEKDAY_FACTORS[weekdayIdx];
    const seasonFactor = getSeasonFactor(date);
    const eventFactor = getEventFactor(date);
    const yearlyGrowth = year >= 2026 ? 1.06 : 1.0;

    // On 2026-08-01, initialize Knitwear stock for live window (no deliveries during live window)
    if (date === LIVE_START_DATE) {
      for (const store of STORES) {
        const kwNormalWeeklyUnits = (store.baseDailySales * 7 * 0.15 * 1.06) / 90;
        const targetWeeks = KNITWEAR_LIVE_START_WEEKS_OF_BASE[store.id] ?? 60;
        stockByStore[store.id].knitwear = kwNormalWeeklyUnits * targetWeeks;
      }
    }

    // On Napa opening day (2026-08-22), set Napa's Knitwear live stock
    if (date === '2026-08-22') {
      const napa = STORE_MAP.napa;
      const kwNormalWeeklyUnits = (napa.baseDailySales * 7 * 0.15 * 1.06) / 90;
      stockByStore.napa.knitwear =
        kwNormalWeeklyUnits * (KNITWEAR_LIVE_START_WEEKS_OF_BASE.napa ?? 13.7);
      const bsNormalWeeklyUnits = (napa.baseDailySales * 7 * 0.35 * 1.06) / 120;
      stockByStore.napa.best_sellers = bsNormalWeeklyUnits * 6.5;
    }

    // Apply scheduled deliveries for `date`
    for (const del of scheduledDeliveries) {
      if (del.date !== date) continue;
      for (const store of STORES) {
        if (del.storeId !== 'all' && del.storeId !== store.id) continue;
        if (date < store.openedDate) continue;

        const stockBefore = stockByStore[store.id][del.groupId];
        let unitsAdded = 0;
        if (del.kind === 'regular') {
          const recent7 = unitsSoldHistory[store.id][del.groupId].slice(-7);
          unitsAdded = recent7.reduce((s, r) => s + r.units, 0);
        } else {
          const bsNormalWeeklyUnits = (store.baseDailySales * 7 * 0.35 * 1.06) / 120;
          unitsAdded = bsNormalWeeklyUnits * 4;
        }
        const stockAfter = stockBefore + unitsAdded;
        stockByStore[store.id][del.groupId] = stockAfter;
        if (unitsAdded > 0) {
          deliveredEvents.push({
            date,
            storeId: store.id,
            groupId: del.groupId,
            unitsAdded,
            stockBefore,
            stockAfter,
            returnedFromZero: stockBefore <= 0.001 && stockAfter > 0.001,
          });
        }
      }
    }

    if (date === '2026-09-01') {
      for (const store of STORES) {
        const bsNormalWeeklyUnits = (store.baseDailySales * 7 * 0.35 * 1.06) / 120;
        const mult = BEST_SELLERS_SEP1_COVER_MULTIPLIER[store.id] ?? 12.0;
        stockByStore[store.id].best_sellers = bsNormalWeeklyUnits * mult;
      }
    }

    // Apply gateway-approved transfer decisions (deduct from donor on approval, arrive at receiver +2 days, or undo)
    for (const decision of decisions) {
      if (decision.kind !== 'transfer' || !decision.transferLines || decision.transferLines.length === 0) {
        continue;
      }
      const gid = decision.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
      const arrivalDate = decision.arrivalDate ?? addDays(decision.date, 2);

      if (decision.date === date) {
        for (const line of decision.transferLines) {
          stockByStore[line.fromStoreId][gid] = Math.max(
            0,
            stockByStore[line.fromStoreId][gid] - line.units,
          );
        }
      }

      if (arrivalDate === date && (!decision.undoneOnDate || arrivalDate <= decision.undoneOnDate)) {
        for (const line of decision.transferLines) {
          const stockBefore = stockByStore[line.toStoreId][gid];
          const stockAfter = stockBefore + line.units;
          stockByStore[line.toStoreId][gid] = stockAfter;
          if (line.units > 0) {
            deliveredEvents.push({
              date,
              storeId: line.toStoreId,
              groupId: gid,
              unitsAdded: line.units,
              stockBefore,
              stockAfter,
              returnedFromZero: stockBefore <= 0.001 && stockAfter > 0.001,
            });
          }
        }
      }

      if (decision.undoneOnDate === date) {
        for (const line of decision.transferLines) {
          const available = stockByStore[line.toStoreId][gid];
          const reversed = Math.min(available, line.units);
          stockByStore[line.toStoreId][gid] = Math.max(0, available - reversed);
          stockByStore[line.fromStoreId][gid] += reversed;
        }
      }
    }

    // Compute 26-week median YoY growth for established stores (used in expected sales for 2026)
    let growth26w = 0.06;
    if (date >= '2026-01-01') {
      // Find last completed Sunday before date
      const daysSinceSunday = weekdayIdx + 1;
      const lastSundayIdx = idx - daysSinceSunday;
      const weeklyChanges: number[] = [];
      for (let w = 0; w < 26; w++) {
        const weekEndIdx = lastSundayIdx - w * 7;
        const weekStartIdx = weekEndIdx - 6;
        if (weekStartIdx < 0) break;
        let thisWeekSum = 0;
        let lastYearWeekSum = 0;
        let valid = true;
        for (let k = weekStartIdx; k <= weekEndIdx; k++) {
          const d = dates[k];
          const match = getMatchingPriorYearDate(d).matchedDate;
          const ly = estSalesByDate[match];
          if (ly === undefined || ly <= 0) {
            valid = false;
            break;
          }
          thisWeekSum += estSalesByDate[d] ?? 0;
          lastYearWeekSum += ly;
        }
        if (valid && lastYearWeekSum > 0) {
          weeklyChanges.push(thisWeekSum / lastYearWeekSum - 1);
        }
      }
      if (weeklyChanges.length >= 4) {
        growth26w = computeMedian(weeklyChanges);
      }
    }
    median26WeekGrowthByDate[date] = growth26w;

    const dayStoreRecords: Record<StoreId, DailyStoreRecord> = {} as Record<StoreId, DailyStoreRecord>;
    let estActualTotal = 0;
    let estExpectedTotal = 0;
    let allActualTotal = 0;

    for (const store of STORES) {
      const isOpen = date >= store.openedDate;
      if (!isOpen) {
        const emptyGroups: Record<ProductGroupId, GroupDailyState> = {
          best_sellers: {
            groupId: 'best_sellers',
            potentialSales: 0,
            unitsDemanded: 0,
            unitsSold: 0,
            actualSales: 0,
            startingStock: 0,
            endingStock: 0,
            hadStock: false,
            weeksOfCover: null,
          },
          knitwear: {
            groupId: 'knitwear',
            potentialSales: 0,
            unitsDemanded: 0,
            unitsSold: 0,
            actualSales: 0,
            startingStock: 0,
            endingStock: 0,
            hadStock: false,
            weeksOfCover: null,
          },
          everything_else: {
            groupId: 'everything_else',
            potentialSales: 0,
            unitsDemanded: 0,
            unitsSold: 0,
            actualSales: 0,
            startingStock: 0,
            endingStock: 0,
            hadStock: false,
            weeksOfCover: null,
          },
        };
        dayStoreRecords[store.id] = {
          date,
          storeId: store.id,
          isOpen: false,
          potentialSales: 0,
          actualSales: 0,
          expectedSales: null,
          refundAmount: 0,
          cashRefundAmount: 0,
          refundRate: 0,
          groups: emptyGroups,
        };
        continue;
      }

      const rampFactor = store.hasOpeningRamp ? getOpeningRampFactor(store.openedDate, date) : 1.0;
      const noise = seededRange(seed, `sales:${date}:${store.id}`, 0.94, 1.06);
      const potentialSales =
        store.baseDailySales *
        weekdayFactor *
        seasonFactor *
        eventFactor *
        yearlyGrowth *
        rampFactor *
        noise;

      // Expected sales
      let expectedSales: number | null = null;
      if (store.isEstablished && year >= 2026) {
        const matched = getMatchingPriorYearDate(date).matchedDate;
        const lyRecord = storeRecordsByDate[matched]?.[store.id];
        if (lyRecord) {
          expectedSales = lyRecord.actualSales * (1 + growth26w);
        }
      } else if (!store.isEstablished && year >= 2026) {
        expectedSales =
          store.baseDailySales *
          weekdayFactor *
          seasonFactor *
          eventFactor *
          (1 + growth26w) *
          rampFactor;
      }

      // Compute group sales & stock depletion
      const groups: Record<ProductGroupId, GroupDailyState> = {} as Record<
        ProductGroupId,
        GroupDailyState
      >;
      let actualStoreSales = 0;

      for (const grp of PRODUCT_GROUPS) {
        const grpPotential = potentialSales * grp.share;
        if (!grp.stockLimited || grp.avgPrice === null) {
          actualStoreSales += grpPotential;
          groups[grp.id] = {
            groupId: grp.id,
            potentialSales: grpPotential,
            unitsDemanded: 0,
            unitsSold: 0,
            actualSales: grpPotential,
            startingStock: 0,
            endingStock: 0,
            hadStock: true,
            weeksOfCover: null,
          };
          continue;
        }

        const gid = grp.id as 'best_sellers' | 'knitwear';
        const startingStock = stockByStore[store.id][gid];
        const hadStock = startingStock > 0.001;
        const unitsDemanded = grpPotential / grp.avgPrice;
        const unitsSold = Math.min(unitsDemanded, startingStock);
        const endingStock = Math.max(0, startingStock - unitsSold);
        stockByStore[store.id][gid] = endingStock;

        const grpActualSales = unitsSold * grp.avgPrice;
        actualStoreSales += grpActualSales;

        unitsSoldHistory[store.id][gid].push({
          units: unitsSold,
          hadStock,
        });

        // Weeks of cover = stock / average weekly units sold over the last 28 days on which the store had stock
        const recentWithStock = unitsSoldHistory[store.id][gid]
          .filter((h) => h.hadStock)
          .slice(-28);
        let weeksOfCover: number | null = null;
        if (recentWithStock.length > 0) {
          const avgDaily =
            recentWithStock.reduce((s, h) => s + h.units, 0) / recentWithStock.length;
          const avgWeekly = avgDaily * 7;
          weeksOfCover = avgWeekly > 0 ? endingStock / avgWeekly : 0;
        }

        groups[gid] = {
          groupId: gid,
          potentialSales: grpPotential,
          unitsDemanded,
          unitsSold,
          actualSales: grpActualSales,
          startingStock,
          endingStock,
          hadStock,
          weeksOfCover,
        };
      }

      // Refunds: ~4% of sales, ~15% cash. Walnut Creek from 2026-09-15 adds ~10% extra cash refunds after 8pm (operator 14, till 2, no linked order).
      const baseRate = seededRange(seed, `ref_rate:${date}:${store.id}`, 0.036, 0.044);
      const baseCashShare = seededRange(seed, `ref_cash:${date}:${store.id}`, 0.13, 0.17);
      const baseRefund = actualStoreSales * baseRate;
      const baseCashRefund = baseRefund * baseCashShare;

      let extraCashRefund = 0;
      if (store.id === 'walnut_creek' && date >= '2026-09-15') {
        const extraRate = seededRange(seed, `wc_extra_ref:${date}`, 0.095, 0.108);
        extraCashRefund = actualStoreSales * extraRate;
      }

      const refundAmount = baseRefund + extraCashRefund;
      const cashRefundAmount = baseCashRefund + extraCashRefund;
      const refundRate = actualStoreSales > 0 ? refundAmount / actualStoreSales : 0;

      // Record individual Walnut Creek refund items in the live window (or last 35 days of live window)
      if (store.id === 'walnut_creek' && date >= '2026-08-01') {
        // Generate 2-3 normal refunds
        const normalCount = 2 + Math.floor(seededUnit(seed, `wc_norm_cnt:${date}`) * 2);
        const perNormal = baseRefund / normalCount;
        for (let r = 0; r < normalCount; r++) {
          const hour = 11 + Math.floor(seededUnit(seed, `wc_norm_hr:${date}:${r}`) * 8);
          const min = Math.floor(seededUnit(seed, `wc_norm_min:${date}:${r}`) * 60);
          const isCash = r === 0 && seededUnit(seed, `wc_norm_cash:${date}`) < 0.45;
          allWalnutCreekRefunds.push({
            id: `ref:${date}:norm:${r}`,
            storeId: 'walnut_creek',
            date,
            time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
            till: 1 + (r % 2),
            operatorNumber: 4 + (r % 5),
            amount: Math.round(perNormal * 100) / 100,
            method: isCash ? 'cash' : 'card',
            linkedOrder: true,
          });
        }

        // Extra unlinked cash refunds after 8 pm on Till 2, operator 14
        if (date >= '2026-09-15' && extraCashRefund > 0) {
          const extraCount = 2 + Math.floor(seededUnit(seed, `wc_ext_cnt:${date}`) * 2);
          const perExtra = extraCashRefund / extraCount;
          for (let r = 0; r < extraCount; r++) {
            const hour = 20 + Math.floor(seededUnit(seed, `wc_ext_hr:${date}:${r}`) * 2); // 20:xx or 21:xx
            const min = 5 + Math.floor(seededUnit(seed, `wc_ext_min:${date}:${r}`) * 50);
            allWalnutCreekRefunds.push({
              id: `ref:${date}:op14:${r}`,
              storeId: 'walnut_creek',
              date,
              time: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
              till: 2,
              operatorNumber: 14,
              amount: Math.round(perExtra * 100) / 100,
              method: 'cash',
              linkedOrder: false,
            });
          }
        }
      }

      dayStoreRecords[store.id] = {
        date,
        storeId: store.id,
        isOpen: true,
        potentialSales,
        actualSales: actualStoreSales,
        expectedSales,
        refundAmount,
        cashRefundAmount,
        refundRate,
        groups,
      };

      if (store.isEstablished) {
        estActualTotal += actualStoreSales;
        if (expectedSales !== null) estExpectedTotal += expectedSales;
      }
      allActualTotal += actualStoreSales;
    }

    storeRecordsByDate[date] = dayStoreRecords;
    estSalesByDate[date] = estActualTotal;
    allSalesByDate[date] = allActualTotal;

    // Chain-level rolling summaries
    let estTrailing7Actual = 0;
    let estTrailing7Expected = 0;
    for (let k = Math.max(0, idx - 6); k <= idx; k++) {
      const d = dates[k];
      estTrailing7Actual += estSalesByDate[d] ?? 0;
      const recs = storeRecordsByDate[d];
      for (const est of ESTABLISHED_STORES) {
        estTrailing7Expected += recs[est.id].expectedSales ?? 0;
      }
    }

    let allTrailing28 = 0;
    let lyAllTrailing28 = 0;
    let estTrailing28Actual = 0;
    let estTrailing28Expected = 0;
    for (let k = Math.max(0, idx - 27); k <= idx; k++) {
      const d = dates[k];
      allTrailing28 += allSalesByDate[d] ?? 0;
      const matched = getMatchingPriorYearDate(d).matchedDate;
      lyAllTrailing28 += allSalesByDate[matched] ?? 0;
      const recs = storeRecordsByDate[d];
      for (const est of ESTABLISHED_STORES) {
        estTrailing28Actual += recs[est.id].actualSales;
        estTrailing28Expected += recs[est.id].expectedSales ?? 0;
      }
    }

    chainRecordsByDate[date] = {
      date,
      establishedActualSales: estActualTotal,
      establishedExpectedSales: estExpectedTotal,
      establishedTrailing7Actual: estTrailing7Actual,
      establishedTrailing7Expected: estTrailing7Expected,
      allStoresActualSales: allActualTotal,
      allStoresTrailing28Sales: allTrailing28,
      lastYearAllStoresTrailing28Sales: lyAllTrailing28,
      allStores28dVsLastYearPct:
        lyAllTrailing28 > 0 ? ((allTrailing28 / lyAllTrailing28) - 1) * 100 : 0,
      lflTrailing28Pct:
        estTrailing28Expected > 0
          ? ((estTrailing28Actual / estTrailing28Expected) - 1) * 100
          : 0,
      calendarLabels: getCalendarLabelsForDate(date),
    };
  }

  // Keep only latest 35 days of Walnut Creek refund records relative to effectiveEnd
  const cutoffDate = addDays(effectiveEnd, -34);
  const walnutCreekRefunds = allWalnutCreekRefunds.filter((r) => r.date >= cutoffDate);

  // Build Day One brief from computed history facts (up to 2026-07-31)
  const dayOneBrief = buildDayOneBrief(storeRecordsByDate);

  const isDeliveryDueWithinDays = (
    storeId: StoreId,
    groupId: 'best_sellers' | 'knitwear',
    date: string,
    days: number,
  ): boolean => {
    return scheduledDeliveries.some((del) => {
      if (del.groupId !== groupId) return false;
      if (del.storeId !== 'all' && del.storeId !== storeId) return false;
      const gap = diffDays(date, del.date);
      return gap > 0 && gap <= days;
    });
  };

  const getRecentZeroRecoveryDelivery = (
    storeId: StoreId,
    date: string,
    withinDays: number,
  ): DeliveredStockEvent | null => {
    let latest: DeliveredStockEvent | null = null;
    for (const ev of deliveredEvents) {
      if (ev.storeId !== storeId || !ev.returnedFromZero) continue;
      const age = diffDays(ev.date, date);
      if (age >= 0 && age <= withinDays) {
        if (!latest || ev.date > latest.date) {
          latest = ev;
        }
      }
    }
    return latest;
  };

  return {
    seed,
    dates,
    liveDates,
    storeRecordsByDate,
    chainRecordsByDate,
    walnutCreekRefunds,
    median26WeekGrowthByDate,
    scheduledDeliveries,
    deliveredEvents,
    isDeliveryDueWithinDays,
    getRecentZeroRecoveryDelivery,
    dayOneBrief,
  };
}

function buildDayOneBrief(
  storeRecordsByDate: Record<string, Record<StoreId, DailyStoreRecord>>,
): DayOneBrief {
  // Compute Saturday share vs average day and group shares over 2025 full year
  const history2025Dates = enumerateDates('2025-01-01', '2025-12-31');
  let total2025 = 0;
  let satTotal = 0;
  let satCount = 0;
  let decTotal = 0;
  let decCount = 0;
  let lullTotal = 0;
  let lullCount = 0;
  let bestSellersTotal = 0;
  let knitwearTotal = 0;

  for (const d of history2025Dates) {
    const recs = storeRecordsByDate[d];
    if (!recs) continue;
    let daySum = 0;
    for (const store of ESTABLISHED_STORES) {
      const r = recs[store.id];
      daySum += r.actualSales;
      bestSellersTotal += r.groups.best_sellers.actualSales;
      knitwearTotal += r.groups.knitwear.actualSales;
    }
    total2025 += daySum;
    if (getIsoWeekdayIndex(d) === 5) {
      satTotal += daySum;
      satCount++;
    }
    if (d.startsWith('2025-12-')) {
      decTotal += daySum;
      decCount++;
    }
    if (d >= '2025-08-01' && d <= '2025-09-07') {
      lullTotal += daySum;
      lullCount++;
    }
  }

  const avgDaily2025 = total2025 / history2025Dates.length;
  const satAvg = satTotal / Math.max(1, satCount);
  const satLiftPct = ((satAvg / avgDaily2025) - 1) * 100;
  const decAvg = decTotal / Math.max(1, decCount);
  const decLiftPct = ((decAvg / avgDaily2025) - 1) * 100;
  const lullAvg = lullTotal / Math.max(1, lullCount);
  const lullDropPct = ((lullAvg / avgDaily2025) - 1) * 100;

  return {
    businessName: 'Linden & Rye',
    summaryFacts: {
      storeCount: createFact(
        'dayone:store_count',
        'Active and opening stores',
        STORES.length,
        'count',
        '8 established stores open more than 18 months plus 2 new stores (Burlingame opened June 2026, Napa opening 22 August 2026).',
      ),
      establishedCount: createFact(
        'dayone:established_count',
        'Established like-for-like stores',
        ESTABLISHED_STORES.length,
        'count',
        'Union Square, Palo Alto, Santana Row, Walnut Creek, Pasadena, Sacramento, Santa Barbara, and Rockridge.',
      ),
      newStoreCount: createFact(
        'dayone:new_store_count',
        'New stores',
        STORES.length - ESTABLISHED_STORES.length,
        'count',
        'Burlingame (opened 1 June 2026) and Napa (opening 22 August 2026).',
      ),
      strongestWeekdayShare: createFact(
        'dayone:sat_lift',
        'Saturday lift vs average day',
        satLiftPct,
        'percent',
        `Computed from 2025 established-store daily sales: Saturday average ($${Math.round(satAvg).toLocaleString('en-US')}) divided by full-year daily average ($${Math.round(avgDaily2025).toLocaleString('en-US')}) minus 1.`,
      ),
      decemberIndex: createFact(
        'dayone:dec_lift',
        'December daily lift vs year average',
        decLiftPct,
        'percent',
        `Computed from 2025 established-store daily sales: December average ($${Math.round(decAvg).toLocaleString('en-US')}) vs 2025 daily average ($${Math.round(avgDaily2025).toLocaleString('en-US')}).`,
      ),
      lullIndex: createFact(
        'dayone:lull_drop',
        'August–early September lull vs year average',
        lullDropPct,
        'percent',
        `Computed from 2025 established-store sales during 1 Aug – 7 Sep ($${Math.round(lullAvg).toLocaleString('en-US')}/day) vs 2025 daily average.`,
      ),
      bestSellersShare: createFact(
        'dayone:best_sellers_share',
        'Best-sellers share of sales',
        (bestSellersTotal / total2025) * 100,
        'share_percent',
        '2025 Best-sellers sales divided by total 2025 established-store sales (stock-limited, average price $120).',
      ),
      knitwearShare: createFact(
        'dayone:knitwear_share',
        'Knitwear share of sales',
        (knitwearTotal / total2025) * 100,
        'share_percent',
        '2025 Knitwear sales divided by total 2025 established-store sales (stock-limited, average price $90).',
      ),
    },
    confirmedRules: [
      {
        id: 'rule_lfl',
        title: 'Like-for-like stores',
        detail: 'The eight stores open more than 18 months form the like-for-like benchmark.',
      },
      {
        id: 'rule_calendar',
        title: 'Trading calendar',
        detail: 'Includes the summer lull (1 Aug – 7 Sep), Labor Day weekend (1 Sep 2025 / 7 Sep 2026), and Thanksgiving week.',
      },
      {
        id: 'rule_donor_cover',
        title: 'Donor stock floor',
        detail:
          'A donor store must keep at least 8 weeks of cover, and never less than it needs to reach its own next delivery plus one week.',
      },
      {
        id: 'rule_transfer_limit',
        title: 'Transfer approval limit',
        detail: 'Transfers above 500 units always require your approval.',
      },
      {
        id: 'rule_autonomy_start',
        title: 'Starting autonomy',
        detail: 'You approve every action at the start; routine authority is earned only after proven results.',
      },
    ],
  };
}
