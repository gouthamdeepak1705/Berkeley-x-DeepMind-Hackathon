import {
  addDays,
  formatShortDate,
  getCalendarSpansOverlappingRange,
  getMatchingPriorYearDate,
} from '../engine/calendar';
import { createFact } from '../engine/facts';
import { runSimulation, SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP, STORES } from '../engine/stores';
import { InteractionToolDecl } from '../gemini/client';
import { Fact, ProductGroupId, RaisedItem, RefundRecord, StoreId } from '../types/domain';
import { buildTransferPlanForGroup } from './transferPlan';

const refundWindowCache = new Map<string, RefundRecord[]>();

function getRefundsUpToDate(sim: SimulationRun, safeDate: string): RefundRecord[] {
  const lastSimDate = sim.dates[sim.dates.length - 1];
  if (safeDate >= lastSimDate || sim.walnutCreekRefunds.some((r) => r.date <= safeDate)) {
    const windowStart = addDays(safeDate, -34);
    const hasWindowCoverage = sim.walnutCreekRefunds.some((r) => r.date >= windowStart && r.date <= safeDate);
    if (hasWindowCoverage && sim.walnutCreekRefunds[0]?.date <= windowStart) {
      return sim.walnutCreekRefunds;
    }
  }
  const cacheKey = `${sim.seed}:${safeDate}`;
  let cached = refundWindowCache.get(cacheKey);
  if (!cached) {
    cached = runSimulation(sim.seed, [], safeDate).walnutCreekRefunds;
    refundWindowCache.set(cacheKey, cached);
  }
  return cached;
}

export interface CheckerToolResult {
  toolName: string;
  argsSummary: string;
  facts: Fact[];
  payload: Record<string, unknown>;
}

export const CHECKER_TOOL_DECLARATIONS: InteractionToolDecl[] = [
  {
    type: 'function',
    name: 'recompute_figure',
    description:
      'Recompute a named metric from raw daily rows up to the current simulated date and return its fact id and computation note.',
    parameters: {
      type: 'object',
      properties: {
        figure_name: {
          type: 'string',
          enum: [
            'chain_28d_sales',
            'chain_lfl_28d',
            'store_28d_sales',
            'store_7d_sales',
            'store_refund_rate',
            'group_cover',
          ],
          description: 'Named figure to recompute from daily records.',
        },
        store_id: {
          type: 'string',
          description: 'Store id when recomputing a store-level metric (e.g. union_square, walnut_creek).',
        },
        group_id: {
          type: 'string',
          enum: ['best_sellers', 'knitwear'],
          description: 'Product group id when recomputing group_cover.',
        },
      },
      required: ['figure_name'],
    },
  },
  {
    type: 'function',
    name: 'compare_with_last_year',
    description:
      'Compare a store, product group, or the established chain with the exact matching weekdays last year over a trailing window ending today.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['chain', 'store', 'group'],
          description: 'Whether to compare the established chain, one store, or one product group across established stores.',
        },
        store_id: {
          type: 'string',
          description: 'Store id when scope is store.',
        },
        group_id: {
          type: 'string',
          enum: ['best_sellers', 'knitwear', 'everything_else'],
          description: 'Group id when scope is group.',
        },
        window_days: {
          type: 'integer',
          description: 'Trailing window length in days, e.g. 7 or 28.',
        },
      },
      required: ['scope', 'window_days'],
    },
  },
  {
    type: 'function',
    name: 'compare_store_with_established',
    description:
      'Compare one store against the median of the other established stores for sales vs expectation or refund rate (including cash share and late-evening operator breakdown for refunds).',
    parameters: {
      type: 'object',
      properties: {
        store_id: {
          type: 'string',
          description: 'Store id to compare.',
        },
        metric: {
          type: 'string',
          enum: ['sales_vs_expected', 'refund_rate'],
          description: 'Metric to benchmark against the other established stores.',
        },
        window_days: {
          type: 'integer',
          description: 'Trailing window in days, e.g. 28.',
        },
      },
      required: ['store_id', 'metric', 'window_days'],
    },
  },
  {
    type: 'function',
    name: 'test_calendar_for_period',
    description:
      'Test the trading calendar for any seasonal swing or moved holiday event overlapping the current window or its matching prior-year window.',
    parameters: {
      type: 'object',
      properties: {
        window_days: {
          type: 'integer',
          description: 'Trailing days to check on the calendar (e.g. 7 or 28).',
        },
      },
      required: ['window_days'],
    },
  },
  {
    type: 'function',
    name: 'test_store_mix',
    description:
      'Measure how much of the chain-wide all-store sales change vs last year comes from the two new stores (Burlingame and Napa) versus the eight established stores.',
    parameters: {
      type: 'object',
      properties: {
        window_days: {
          type: 'integer',
          description: 'Trailing window in days, typically 28.',
        },
      },
      required: ['window_days'],
    },
  },
  {
    type: 'function',
    name: 'test_data_fault',
    description:
      'Scan daily store records up to today for missing trading days, duplicated date rows, or an open store recording zero sales on a trading day.',
    parameters: {
      type: 'object',
      properties: {
        window_days: {
          type: 'integer',
          description: 'Trailing window in days to inspect, e.g. 28.',
        },
      },
      required: ['window_days'],
    },
  },
  {
    type: 'function',
    name: 'get_stock_cover_by_store_and_group',
    description:
      'Inspect ending units, weeks of cover, donor-surplus eligibility (above the 8-week plus next-delivery+1-week floor), and next scheduled delivery date for every open store.',
    parameters: {
      type: 'object',
      properties: {
        group_id: {
          type: 'string',
          enum: ['best_sellers', 'knitwear'],
          description: 'Product group to inspect across all stores.',
        },
      },
      required: ['group_id'],
    },
  },
  {
    type: 'function',
    name: 'get_lost_sales',
    description:
      'Compute cumulative lost sales so far (potential minus actual) up to today and current weekly lost sales rate if nothing is done for a product group (and optional store).',
    parameters: {
      type: 'object',
      properties: {
        group_id: {
          type: 'string',
          enum: ['best_sellers', 'knitwear'],
          description: 'Product group to calculate lost sales for.',
        },
        store_id: {
          type: 'string',
          description: 'Optional store id; omit to aggregate across all stores short of that group.',
        },
      },
      required: ['group_id'],
    },
  },
  {
    type: 'function',
    name: 'compute_transfer_plan',
    description:
      'Build a safe inter-store stock transfer plan covering stores below 2.5 weeks (or projected below 2.5 weeks within 7 days), holding out the smallest store when 3+ stores need stock, and respecting donor 8-week and next-delivery+1-week limits.',
    parameters: {
      type: 'object',
      properties: {
        group_id: {
          type: 'string',
          enum: ['best_sellers', 'knitwear'],
          description: 'Product group for transfer planning.',
        },
      },
      required: ['group_id'],
    },
  },
  {
    type: 'function',
    name: 'get_refund_breakdown',
    description:
      'Inspect a store’s last 35 days of refund records up to today, breaking down refunds by payment method (cash vs card), till number, operator number, hour of day (after 8 pm vs earlier), and whether an order is linked, compared against the other established stores.',
    parameters: {
      type: 'object',
      properties: {
        store_id: {
          type: 'string',
          description: 'Store id to inspect (e.g. walnut_creek).',
        },
        window_days: {
          type: 'integer',
          description: 'Trailing window in days for rate comparison (default 28, logs up to 35).',
        },
      },
      required: ['store_id'],
    },
  },
];

function isValidStoreId(id: unknown): id is StoreId {
  return typeof id === 'string' && id in STORE_MAP;
}

function getValidGroupId(id: unknown): 'best_sellers' | 'knitwear' {
  return id === 'knitwear' ? 'knitwear' : 'best_sellers';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function executeCheckerTool(
  toolName: string,
  args: Record<string, unknown>,
  sim: SimulationRun,
  date: string,
  situation?: RaisedItem,
): CheckerToolResult {
  const dateIdx = sim.dates.indexOf(date);
  const safeDateIdx = dateIdx >= 0 ? dateIdx : sim.dates.length - 1;
  const safeDate = sim.dates[safeDateIdx];

  if (toolName === 'recompute_figure') {
    const figureName = String(args.figure_name ?? 'chain_lfl_28d');
    const storeId: StoreId = isValidStoreId(args.store_id)
      ? args.store_id
      : situation?.stores?.[0]?.storeId ?? 'union_square';
    const groupId = getValidGroupId(args.group_id ?? situation?.groupId);

    if (figureName === 'chain_28d_sales') {
      const startIdx = Math.max(0, safeDateIdx - 27);
      let actual = 0;
      let ly = 0;
      for (let k = startIdx; k <= safeDateIdx; k++) {
        const d = sim.dates[k];
        const recs = sim.storeRecordsByDate[d];
        for (const st of STORES) {
          if (recs[st.id].isOpen) actual += recs[st.id].actualSales;
        }
        const py = getMatchingPriorYearDate(d).matchedDate;
        const pyRecs = sim.storeRecordsByDate[py];
        if (pyRecs) {
          for (const st of STORES) {
            if (pyRecs[st.id].isOpen) ly += pyRecs[st.id].actualSales;
          }
        }
      }
      const pct = ly > 0 ? ((actual / ly) - 1) * 100 : 0;
      const fAct = createFact(
        `tool:recomp:chain_28d:${safeDate}`,
        'All-store 28-day sales (recomputed)',
        actual,
        'USD',
        `Sum of daily actual sales across all open stores from ${sim.dates[startIdx]} to ${safeDate}.`,
      );
      const fPct = createFact(
        `tool:recomp:chain_28d_pct:${safeDate}`,
        'All-store 28-day change vs last year',
        pct,
        'percent',
        `All-store 28-day actual ($${Math.round(actual).toLocaleString('en-US')}) vs prior-year matching days ($${Math.round(ly).toLocaleString('en-US')}).`,
      );
      return {
        toolName,
        argsSummary: `figure_name=${figureName}`,
        facts: [fAct, fPct],
        payload: { facts: [fAct, fPct] },
      };
    }

    if (figureName === 'chain_lfl_28d') {
      const cr = sim.chainRecordsByDate[safeDate];
      const fLfl = createFact(
        `tool:recomp:lfl_28d:${safeDate}`,
        'Established-store 28-day vs expectation',
        cr.lflTrailing28Pct,
        'points',
        `Trailing 28-day sales across the 8 established stores compared with prior-year matching days × 26-week growth up to ${safeDate}.`,
      );
      return {
        toolName,
        argsSummary: `figure_name=${figureName}`,
        facts: [fLfl],
        payload: { facts: [fLfl] },
      };
    }

    if (figureName === 'store_28d_sales' || figureName === 'store_7d_sales') {
      const win = figureName === 'store_7d_sales' ? 7 : 28;
      const startIdx = Math.max(0, safeDateIdx - (win - 1));
      let act = 0;
      let exp = 0;
      for (let k = startIdx; k <= safeDateIdx; k++) {
        const rec = sim.storeRecordsByDate[sim.dates[k]][storeId];
        act += rec.actualSales;
        exp += rec.expectedSales ?? rec.actualSales;
      }
      const fAct = createFact(
        `tool:recomp:${storeId}_${win}d_act:${safeDate}`,
        `${STORE_MAP[storeId].name} ${win}-day actual sales`,
        act,
        'USD',
        `Sum of ${STORE_MAP[storeId].name} daily actual sales from ${sim.dates[startIdx]} to ${safeDate}.`,
      );
      const fExp = createFact(
        `tool:recomp:${storeId}_${win}d_exp:${safeDate}`,
        `${STORE_MAP[storeId].name} ${win}-day expected sales`,
        exp,
        'USD',
        `Sum of expected sales for ${STORE_MAP[storeId].name} from ${sim.dates[startIdx]} to ${safeDate}.`,
      );
      return {
        toolName,
        argsSummary: `figure_name=${figureName}, store_id=${storeId}`,
        facts: [fAct, fExp],
        payload: { facts: [fAct, fExp] },
      };
    }

    if (figureName === 'store_refund_rate') {
      const startIdx = Math.max(0, safeDateIdx - 27);
      let sales = 0;
      let refunds = 0;
      let cashRefunds = 0;
      for (let k = startIdx; k <= safeDateIdx; k++) {
        const rec = sim.storeRecordsByDate[sim.dates[k]][storeId];
        sales += rec.actualSales;
        refunds += rec.refundAmount;
        cashRefunds += rec.cashRefundAmount;
      }
      const ratePct = sales > 0 ? (refunds / sales) * 100 : 0;
      const cashSharePct = refunds > 0 ? (cashRefunds / refunds) * 100 : 0;
      const fRate = createFact(
        `tool:recomp:${storeId}_refund_rate:${safeDate}`,
        `${STORE_MAP[storeId].name} 28-day refund rate`,
        ratePct,
        'percent',
        `28-day total refunds ($${Math.round(refunds).toLocaleString('en-US')}) divided by sales ($${Math.round(sales).toLocaleString('en-US')}) up to ${safeDate}.`,
      );
      const fCash = createFact(
        `tool:recomp:${storeId}_cash_share:${safeDate}`,
        `${STORE_MAP[storeId].name} cash share of refunds`,
        cashSharePct,
        'share_percent',
        `Cash refunds ($${Math.round(cashRefunds).toLocaleString('en-US')}) as a share of total refunds over 28 days up to ${safeDate}.`,
      );
      return {
        toolName,
        argsSummary: `figure_name=${figureName}, store_id=${storeId}`,
        facts: [fRate, fCash],
        payload: { facts: [fRate, fCash] },
      };
    }

    // group_cover
    const grp = sim.storeRecordsByDate[safeDate][storeId].groups[groupId];
    const cover = grp.weeksOfCover ?? 0;
    const fCov = createFact(
      `tool:recomp:${storeId}_${groupId}_cover:${safeDate}`,
      `${STORE_MAP[storeId].name} ${groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} cover`,
      cover,
      'weeks',
      `Ending stock (${Math.round(grp.endingStock)} units) on ${safeDate} divided by average weekly units demanded.`,
    );
    return {
      toolName,
      argsSummary: `figure_name=${figureName}, store_id=${storeId}, group_id=${groupId}`,
      facts: [fCov],
      payload: { facts: [fCov] },
    };
  }

  if (toolName === 'compare_with_last_year') {
    const scope = String(args.scope ?? 'chain');
    const win = Math.max(1, Math.min(56, Number(args.window_days ?? 28)));
    const startIdx = Math.max(0, safeDateIdx - (win - 1));
    const storeId: StoreId = isValidStoreId(args.store_id)
      ? args.store_id
      : situation?.stores?.[0]?.storeId ?? 'union_square';
    const groupId: ProductGroupId =
      args.group_id === 'knitwear' || args.group_id === 'everything_else'
        ? args.group_id
        : 'best_sellers';

    let cur = 0;
    let py = 0;
    const storeList =
      scope === 'store' ? [STORE_MAP[storeId]] : ESTABLISHED_STORES;

    for (let k = startIdx; k <= safeDateIdx; k++) {
      const d = sim.dates[k];
      const pyDate = getMatchingPriorYearDate(d).matchedDate;
      const curRecs = sim.storeRecordsByDate[d];
      const pyRecs = sim.storeRecordsByDate[pyDate];
      for (const st of storeList) {
        if (scope === 'group') {
          cur += curRecs[st.id].groups[groupId].actualSales;
          if (pyRecs) py += pyRecs[st.id].groups[groupId].actualSales;
        } else {
          cur += curRecs[st.id].actualSales;
          if (pyRecs) py += pyRecs[st.id].actualSales;
        }
      }
    }

    const yoyPct = py > 0 ? ((cur / py) - 1) * 100 : 0;
    const scopeName =
      scope === 'store'
        ? STORE_MAP[storeId].name
        : scope === 'group'
          ? `${groupId} (established)`
          : 'Established chain';

    const fCur = createFact(
      `tool:yoy:${scope}:${win}d_cur:${safeDate}`,
      `${scopeName} ${win}-day sales`,
      cur,
      'USD',
      `Sales from ${sim.dates[startIdx]} to ${safeDate}.`,
    );
    const fPy = createFact(
      `tool:yoy:${scope}:${win}d_ly:${safeDate}`,
      `${scopeName} matching prior-year ${win}-day sales`,
      py,
      'USD',
      `Matching weekday prior-year sales ending ${getMatchingPriorYearDate(safeDate)}.`,
    );
    const fPct = createFact(
      `tool:yoy:${scope}:${win}d_pct:${safeDate}`,
      `${scopeName} ${win}-day YoY change`,
      yoyPct,
      'percent',
      `Percentage change between current ${win}-day sales and matching prior-year weekdays.`,
    );
    return {
      toolName,
      argsSummary: `scope=${scope}, window_days=${win}`,
      facts: [fCur, fPy, fPct],
      payload: { facts: [fCur, fPy, fPct] },
    };
  }

  if (toolName === 'compare_store_with_established') {
    const storeId: StoreId = isValidStoreId(args.store_id)
      ? args.store_id
      : situation?.stores?.[0]?.storeId ?? 'walnut_creek';
    const metric = String(args.metric ?? 'refund_rate');
    const win = Math.max(7, Math.min(56, Number(args.window_days ?? 28)));
    const startIdx = Math.max(0, safeDateIdx - (win - 1));

    if (metric === 'refund_rate') {
      const windowStart = sim.dates[startIdx];
      const otherRates: number[] = [];
      let targetRate = 0;
      let targetSales = 0;
      let targetRefunds = 0;

      for (const st of ESTABLISHED_STORES) {
        let s = 0;
        let r = 0;
        for (let k = startIdx; k <= safeDateIdx; k++) {
          const rec = sim.storeRecordsByDate[sim.dates[k]][st.id];
          s += rec.actualSales;
          r += rec.refundAmount;
        }
        const rate = s > 0 ? (r / s) * 100 : 0;
        if (st.id === storeId) {
          targetRate = rate;
          targetSales = s;
          targetRefunds = r;
        } else {
          otherRates.push(rate);
        }
      }
      const medRate = median(otherRates);

      // Detailed refund pattern breakdown strictly <= safeDate (35-day log ending safeDate)
      const refundsAtDate = getRefundsUpToDate(sim, safeDate);
      const storeRefunds = refundsAtDate.filter(
        (r) => r.storeId === storeId && r.date >= windowStart && r.date <= safeDate,
      );
      const after8CashUnlinked = storeRefunds.filter(
        (r) => r.method === 'cash' && !r.linkedOrder && r.time >= '20:00',
      );
      const after8Sum = after8CashUnlinked.reduce((acc, r) => acc + r.amount, 0);
      const after8SharePct = targetRefunds > 0 ? (after8Sum / targetRefunds) * 100 : 0;
      const op14Till2Count = after8CashUnlinked.filter(
        (r) => r.till === 2 && r.operatorNumber === 14,
      ).length;

      const fTarget = createFact(
        `tool:est:${storeId}:refund_rate:${safeDate}`,
        `${STORE_MAP[storeId].name} ${win}-day refund rate`,
        targetRate,
        'percent',
        `Refunds ($${Math.round(targetRefunds).toLocaleString('en-US')}) divided by sales ($${Math.round(targetSales).toLocaleString('en-US')}) over ${win} days ending ${safeDate}.`,
      );
      const fMed = createFact(
        `tool:est:other_median_refund:${safeDate}`,
        'Other established stores median refund rate',
        medRate,
        'percent',
        `Median ${win}-day refund rate across the other 7 established stores ending ${safeDate}.`,
      );
      const fAfter8 = createFact(
        `tool:est:${storeId}:after8_unlinked_cash:${safeDate}`,
        'After-8pm unlinked cash refund share',
        after8SharePct,
        'share_percent',
        `Unlinked cash refunds after 20:00 ($${Math.round(after8Sum).toLocaleString('en-US')}, ${op14Till2Count} transactions on Till 2, operator 14) as a share of total ${STORE_MAP[storeId].name} refunds up to ${safeDate}.`,
      );
      const fOp14Count = createFact(
        `tool:est:${storeId}:after8_op14_count:${safeDate}`,
        'Till 2 operator 14 late unlinked cash refunds',
        op14Till2Count,
        'count',
        `Number of unlinked cash refunds processed after 20:00 on Till 2 by operator 14 between ${windowStart} and ${safeDate}.`,
      );
      const fExcessUsd = createFact(
        `tool:est:${storeId}:excess_refunds_wk:${safeDate}`,
        'Excess refunds per week above chain baseline',
        Math.max(0, ((targetRate - medRate) / 100) * (targetSales / (win / 7))),
        'USD',
        `Weekly dollar excess above the ${medRate.toFixed(1)}% chain refund median over ${win} days ending ${safeDate}.`,
      );

      return {
        toolName,
        argsSummary: `store_id=${storeId}, metric=${metric}, window_days=${win}`,
        facts: [fTarget, fMed, fAfter8, fOp14Count, fExcessUsd],
        payload: {
          facts: [fTarget, fMed, fAfter8, fOp14Count, fExcessUsd],
          till_pattern_note:
            op14Till2Count > 0
              ? `Till 2, operator 14 logged ${op14Till2Count} unlinked cash refunds after 20:00 between ${windowStart} and ${safeDate}.`
              : 'No concentrated single-operator after-hours cash pattern detected.',
        },
      };
    }

    // sales_vs_expected
    const otherGaps: number[] = [];
    let targetGap = 0;
    for (const st of ESTABLISHED_STORES) {
      let act = 0;
      let exp = 0;
      for (let k = startIdx; k <= safeDateIdx; k++) {
        const rec = sim.storeRecordsByDate[sim.dates[k]][st.id];
        act += rec.actualSales;
        exp += rec.expectedSales ?? rec.actualSales;
      }
      const gapPct = exp > 0 ? ((act / exp) - 1) * 100 : 0;
      if (st.id === storeId) targetGap = gapPct;
      else otherGaps.push(gapPct);
    }
    const medGap = median(otherGaps);
    const fTarget = createFact(
      `tool:est:${storeId}:sales_vs_exp:${safeDate}`,
      `${STORE_MAP[storeId].name} ${win}-day vs expected`,
      targetGap,
      'points',
      `${STORE_MAP[storeId].name} actual vs expected over ${win} days ending ${safeDate}.`,
    );
    const fMed = createFact(
      `tool:est:other_median_sales_vs_exp:${safeDate}`,
      'Other established stores median vs expected',
      medGap,
      'points',
      `Median ${win}-day sales vs expected across the other 7 established stores ending ${safeDate}.`,
    );
    return {
      toolName,
      argsSummary: `store_id=${storeId}, metric=${metric}, window_days=${win}`,
      facts: [fTarget, fMed],
      payload: { facts: [fTarget, fMed] },
    };
  }

  if (toolName === 'test_calendar_for_period') {
    const win = Math.max(1, Math.min(56, Number(args.window_days ?? 28)));
    const startDate = addDays(safeDate, -(win - 1));
    const currentSpans = getCalendarSpansOverlappingRange(startDate, safeDate);
    const pyStart = addDays(startDate, -364);
    const pyEnd = addDays(safeDate, -364);
    const pySpans = getCalendarSpansOverlappingRange(pyStart, pyEnd);

    const activeLabels = currentSpans.map((s) => `${s.label} (${s.startDate} to ${s.endDate})`);
    const pyLabels = pySpans.map((s) => `${s.label} (${s.startDate} to ${s.endDate})`);
    const isUnexplainedByCalendar = currentSpans.length === 0 && pySpans.length === 0;

    // For a clean fact indicating whether calendar explains the variance:
    const fCal = createFact(
      `tool:calendar:active_count:${safeDate}`,
      'Active or moved calendar events explaining period',
      currentSpans.length + pySpans.length,
      'count',
      isUnexplainedByCalendar
        ? `No seasonal swing or moved holiday overlaps ${startDate} to ${safeDate} or its prior-year window (calendar ruled out).`
        : `Overlapping calendar spans: current=[${activeLabels.join('; ') || 'none'}], prior-year=[${pyLabels.join('; ') || 'none'}]. Note: prior-year expectations already adjust for moved holidays and seasonal factors.`,
    );
    return {
      toolName,
      argsSummary: `window_days=${win}`,
      facts: [fCal],
      payload: {
        facts: [fCal],
        calendar_ruled_out: true,
        active_spans: activeLabels,
        prior_year_spans: pyLabels,
        note: 'Expectation model already controls for calendar seasonality and shifted events.',
      },
    };
  }

  if (toolName === 'test_store_mix') {
    const win = Math.max(7, Math.min(56, Number(args.window_days ?? 28)));
    const startIdx = Math.max(0, safeDateIdx - (win - 1));
    let estCur = 0;
    let estLy = 0;
    let newCur = 0;
    let newLy = 0;

    for (let k = startIdx; k <= safeDateIdx; k++) {
      const d = sim.dates[k];
      const py = getMatchingPriorYearDate(d).matchedDate;
      const curRecs = sim.storeRecordsByDate[d];
      const pyRecs = sim.storeRecordsByDate[py];
      for (const st of STORES) {
        const curVal = curRecs[st.id].isOpen ? curRecs[st.id].actualSales : 0;
        const pyVal = pyRecs && pyRecs[st.id].isOpen ? pyRecs[st.id].actualSales : 0;
        if (st.isEstablished) {
          estCur += curVal;
          estLy += pyVal;
        } else {
          newCur += curVal;
          newLy += pyVal;
        }
      }
    }

    const totalCur = estCur + newCur;
    const totalLy = estLy + newLy;
    const allStoreYoyPct = totalLy > 0 ? ((totalCur / totalLy) - 1) * 100 : 0;
    const estYoyPct = estLy > 0 ? ((estCur / estLy) - 1) * 100 : 0;
    const newStoreSales = newCur;
    const newStoreShareOfTotalPct = totalCur > 0 ? (newCur / totalCur) * 100 : 0;

    const fAllPct = createFact(
      `tool:mix:all_yoy:${safeDate}`,
      'All-store 28-day YoY change',
      allStoreYoyPct,
      'percent',
      `All open stores ${win}-day sales ($${Math.round(totalCur).toLocaleString('en-US')}) vs last year ($${Math.round(totalLy).toLocaleString('en-US')}) ending ${safeDate}.`,
    );
    const fEstPct = createFact(
      `tool:mix:est_yoy:${safeDate}`,
      'Established 8 stores YoY change',
      estYoyPct,
      'percent',
      `Established 8 stores ${win}-day sales ($${Math.round(estCur).toLocaleString('en-US')}) vs last year ($${Math.round(estLy).toLocaleString('en-US')}) ending ${safeDate}.`,
    );
    const fNewSales = createFact(
      `tool:mix:new_stores_sales:${safeDate}`,
      'New stores (Burlingame & Napa) 28-day contribution',
      newStoreSales,
      'USD',
      `Combined ${win}-day sales from new stores Burlingame and Napa (${newStoreShareOfTotalPct.toFixed(1)}% of chain total) ending ${safeDate}, masking established-store losses in the all-store figure.`,
    );
    return {
      toolName,
      argsSummary: `window_days=${win}`,
      facts: [fAllPct, fEstPct, fNewSales],
      payload: {
        facts: [fAllPct, fEstPct, fNewSales],
        store_mix_explains_established_drop: false,
        note: 'New stores lift the all-store total above last year, so store mix does NOT explain or excuse the drop inside the established stores (store mix fault ruled out as cause of established drop).',
      },
    };
  }

  if (toolName === 'test_data_fault') {
    const win = Math.max(7, Math.min(56, Number(args.window_days ?? 28)));
    const startIdx = Math.max(0, safeDateIdx - (win - 1));
    const seenDates = new Set<string>();
    let missingDays = 0;
    let duplicateDays = 0;
    let zeroSalesOpenDays = 0;

    for (let k = startIdx; k <= safeDateIdx; k++) {
      const d = sim.dates[k];
      if (seenDates.has(d)) duplicateDays += 1;
      seenDates.add(d);
      const recs = sim.storeRecordsByDate[d];
      if (!recs) {
        missingDays += 1;
        continue;
      }
      for (const st of STORES) {
        if (recs[st.id].isOpen && recs[st.id].actualSales <= 0) {
          zeroSalesOpenDays += 1;
        }
      }
    }

    const totalFaults = missingDays + duplicateDays + zeroSalesOpenDays;
    const fFault = createFact(
      `tool:data_fault:count:${safeDate}`,
      'Data integrity anomalies found',
      totalFaults,
      'count',
      `Scanned ${win} days (${sim.dates[startIdx]} to ${safeDate}) across all open stores: ${missingDays} missing days, ${duplicateDays} duplicate dates, ${zeroSalesOpenDays} open zero-sales store-days. Data fault ruled out.`,
    );
    return {
      toolName,
      argsSummary: `window_days=${win}`,
      facts: [fFault],
      payload: {
        facts: [fFault],
        data_fault_found: totalFaults > 0,
      },
    };
  }

  if (toolName === 'get_stock_cover_by_store_and_group') {
    const groupId = getValidGroupId(args.group_id ?? situation?.groupId);
    const grpLabel = groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
    const recs = sim.storeRecordsByDate[safeDate];
    const nextDel = sim.scheduledDeliveries
      .filter((d) => d.groupId === groupId && d.date > safeDate)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const daysUntilDelivery = nextDel
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${nextDel.date}T00:00:00Z`) - Date.parse(`${safeDate}T00:00:00Z`)) /
              86_400_000,
          ),
        )
      : null;

    const facts: Fact[] = [];
    const shortStores: Array<{ storeId: string; name: string; cover: number; units: number }> = [];
    const donorStores: Array<{
      storeId: string;
      name: string;
      cover: number;
      units: number;
      surplusUnits: number;
    }> = [];

    for (const st of STORES) {
      const rec = recs[st.id];
      if (!rec.isOpen) continue;
      const gs = rec.groups[groupId];
      const cover = gs.weeksOfCover ?? 0;
      const avgWeeklyUnits = cover > 0 ? gs.endingStock / cover : gs.unitsDemanded * 7;

      // Donor floor: keep at least 8 weeks, and never less than needed to reach next delivery + 1 week
      const deliveryPlusOneWeeks = daysUntilDelivery !== null ? daysUntilDelivery / 7 + 1 : 0;
      const floorWeeks = Math.max(8, deliveryPlusOneWeeks);
      const surplusUnits = Math.max(0, Math.floor(gs.endingStock - floorWeeks * avgWeeklyUnits));

      const fCover = createFact(
        `tool:stock:${st.id}:${groupId}:cover:${safeDate}`,
        `${st.name} ${grpLabel} cover`,
        cover,
        'weeks',
        `Ending ${grpLabel} stock at ${st.name} on ${safeDate} (${Math.round(gs.endingStock)} units) divided by weekly unit demand (${avgWeeklyUnits.toFixed(1)} units/wk).`,
      );
      facts.push(fCover);

      if (cover < 2.5) {
        shortStores.push({
          storeId: st.id,
          name: st.name,
          cover: Math.round(cover * 10) / 10,
          units: Math.round(gs.endingStock),
        });
      } else if (surplusUnits >= 15) {
        donorStores.push({
          storeId: st.id,
          name: st.name,
          cover: Math.round(cover * 10) / 10,
          units: Math.round(gs.endingStock),
          surplusUnits,
        });
      }
    }

    const totalSurplusUnits = donorStores.reduce((s, d) => s + d.surplusUnits, 0);
    const fSurplus = createFact(
      `tool:stock:donor_surplus:${groupId}:${safeDate}`,
      `${grpLabel} transferable donor surplus`,
      totalSurplusUnits,
      'units',
      `Total ${grpLabel} units available across ${donorStores.length} donor stores (${donorStores.map((d) => `${d.name} ${d.cover} wks`).join(', ') || 'none'}) after keeping each donor's 8-week and delivery-buffer floor.`,
    );
    facts.push(fSurplus);

    if (daysUntilDelivery !== null && nextDel) {
      facts.push(
        createFact(
          `tool:stock:next_delivery:${groupId}:${safeDate}`,
          `Days until next ${grpLabel} delivery (${formatShortDate(nextDel.date)})`,
          daysUntilDelivery,
          'days',
          `Next scheduled ${grpLabel} delivery is ${nextDel.date} (${daysUntilDelivery} days after ${safeDate}).`,
        ),
      );
    }

    return {
      toolName,
      argsSummary: `group_id=${groupId}`,
      facts,
      payload: {
        facts,
        short_stores: shortStores,
        donor_stores: donorStores,
        next_delivery_date: nextDel?.date ?? null,
      },
    };
  }

  if (toolName === 'compute_transfer_plan') {
    const groupId = getValidGroupId(args.group_id ?? situation?.groupId);
    const { plan, facts } = buildTransferPlanForGroup({
      sim,
      date: safeDate,
      groupId,
    });
    return {
      toolName,
      argsSummary: `group_id=${groupId}`,
      facts,
      payload: {
        facts,
        treated_stores: plan.treatedStoreIds,
        holdout_store: plan.holdoutStoreId ?? null,
        holdout_sentence: plan.holdoutSentence ?? null,
        limit_sentence: plan.limitSentence,
        arrival_date: plan.arrivalDate,
        shortfall_units: plan.shortfallUnitsFact?.value ?? 0,
        transfer_lines: plan.transferLines,
      },
    };
  }

  if (toolName === 'get_refund_breakdown') {
    const storeId: StoreId = isValidStoreId(args.store_id)
      ? args.store_id
      : situation?.stores?.[0]?.storeId ?? 'walnut_creek';
    const windowDays = Math.max(7, Math.min(35, Number(args.window_days ?? 28) || 28));
    const startIdx = Math.max(0, safeDateIdx - windowDays + 1);

    let storeSales = 0;
    let storeRefunds = 0;
    const otherRates: number[] = [];

    for (const est of ESTABLISHED_STORES) {
      let s = 0;
      let r = 0;
      for (let k = startIdx; k <= safeDateIdx; k++) {
        const rec = sim.storeRecordsByDate[sim.dates[k]][est.id];
        if (!rec.isOpen) continue;
        s += rec.actualSales;
        r += rec.refundAmount;
      }
      if (est.id === storeId) {
        storeSales = s;
        storeRefunds = r;
      } else if (s > 0) {
        otherRates.push((r / s) * 100);
      }
    }

    const storeRatePct = storeSales > 0 ? (storeRefunds / storeSales) * 100 : 0;
    const otherMedianPct = median(otherRates);
    const excessRefundUsd = Math.max(0, storeRefunds - storeSales * (otherMedianPct / 100));
    const weeklyExcessUsd = excessRefundUsd / (windowDays / 7);

    const logStart = addDays(safeDate, -34);
    const recentLogs =
      storeId === 'walnut_creek'
        ? getRefundsUpToDate(sim, safeDate).filter((r) => r.date >= logStart && r.date <= safeDate)
        : [];

    const cashLogs = recentLogs.filter((r) => r.method === 'cash');
    const cashUsd = cashLogs.reduce((s, r) => s + r.amount, 0);
    const totalLogUsd = recentLogs.reduce((s, r) => s + r.amount, 0);
    const cashSharePct = totalLogUsd > 0 ? (cashUsd / totalLogUsd) * 100 : 0;

    const after8UnlinkedCash = cashLogs.filter((r) => r.time >= '20:00' && !r.linkedOrder);
    const after8Op14Till2 = after8UnlinkedCash.filter((r) => r.till === 2 && r.operatorNumber === 14);
    const after8Op14Usd = after8Op14Till2.reduce((s, r) => s + r.amount, 0);
    const after8UnlinkedPct = totalLogUsd > 0 ? (after8UnlinkedCash.reduce((s, r) => s + r.amount, 0) / totalLogUsd) * 100 : 0;

    const byTill: Record<string, { count: number; usd: number }> = {};
    const byOperator: Record<string, { count: number; usd: number }> = {};
    const byHourBand = { before_20_00: { count: 0, usd: 0 }, at_or_after_20_00: { count: 0, usd: 0 } };
    for (const r of recentLogs) {
      const tillKey = `Till ${r.till}`;
      byTill[tillKey] = byTill[tillKey] ?? { count: 0, usd: 0 };
      byTill[tillKey].count += 1;
      byTill[tillKey].usd = Math.round((byTill[tillKey].usd + r.amount) * 100) / 100;

      const opKey = `Operator ${r.operatorNumber}`;
      byOperator[opKey] = byOperator[opKey] ?? { count: 0, usd: 0 };
      byOperator[opKey].count += 1;
      byOperator[opKey].usd = Math.round((byOperator[opKey].usd + r.amount) * 100) / 100;

      const band = r.time >= '20:00' ? byHourBand.at_or_after_20_00 : byHourBand.before_20_00;
      band.count += 1;
      band.usd = Math.round((band.usd + r.amount) * 100) / 100;
    }

    const fStoreRate = createFact(
      `tool:refund_bd:store_rate:${storeId}:${safeDate}`,
      `${STORE_MAP[storeId].name} refund rate (${windowDays}d)`,
      storeRatePct,
      'percent',
      `${STORE_MAP[storeId].name} total refunds ($${Math.round(storeRefunds).toLocaleString('en-US')}) divided by sales ($${Math.round(storeSales).toLocaleString('en-US')}) over ${windowDays} days through ${safeDate}.`,
    );
    const fOtherRate = createFact(
      `tool:refund_bd:other_rate:${storeId}:${safeDate}`,
      'Other established stores median refund rate',
      otherMedianPct,
      'percent',
      `Median ${windowDays}-day refund rate across the other 7 established stores ending ${safeDate}.`,
    );
    const fCashShare = createFact(
      `tool:refund_bd:cash_share:${storeId}:${safeDate}`,
      'Cash share of store refunds (35d)',
      cashSharePct,
      'percent',
      `Cash refunds ($${Math.round(cashUsd).toLocaleString('en-US')}) divided by total logged 35-day refunds ($${Math.round(totalLogUsd).toLocaleString('en-US')}).`,
    );
    const fAfter8Share = createFact(
      `tool:refund_bd:after8_share:${storeId}:${safeDate}`,
      'Unlinked cash refunds after 8 pm share',
      after8UnlinkedPct,
      'percent',
      `${after8UnlinkedCash.length} cash refunds recorded at or after 20:00 with no linked order out of ${recentLogs.length} 35-day refund records.`,
    );
    const fOp14Count = createFact(
      `tool:refund_bd:op14_count:${storeId}:${safeDate}`,
      'Flagged Till 2 operator 14 cash refunds after 8 pm',
      after8Op14Till2.length,
      'count',
      `Cash refunds at ${STORE_MAP[storeId].name} on Till 2, operator 14, at or after 20:00 with no linked order over the last 35 days through ${safeDate}.`,
    );
    const fOp14Usd = createFact(
      `tool:refund_bd:op14_usd:${storeId}:${safeDate}`,
      'Flagged Till 2 operator 14 cash refunds total',
      after8Op14Usd,
      'USD',
      `Total dollar value of ${after8Op14Till2.length} unlinked cash refunds after 20:00 on Till 2, operator 14, through ${safeDate}.`,
    );
    const fWeeklyExcess = createFact(
      `tool:refund_bd:weekly_excess:${storeId}:${safeDate}`,
      'Weekly excess cash refund exposure',
      weeklyExcessUsd,
      'USD',
      `Excess refunds above the ${otherMedianPct.toFixed(1)}% other-store benchmark per week.`,
    );

    const facts = [
      fStoreRate,
      fOtherRate,
      fCashShare,
      fAfter8Share,
      fOp14Count,
      fOp14Usd,
      fWeeklyExcess,
    ];

    return {
      toolName,
      argsSummary: `store_id=${storeId}, window_days=${windowDays}`,
      facts,
      payload: {
        facts,
        record_count_35d: recentLogs.length,
        by_till: byTill,
        by_operator: byOperator,
        by_hour_band: byHourBand,
        flagged_pattern: 'cash, at or after 20:00, no linked order, Till 2, operator 14',
        flagged_count: after8Op14Till2.length,
        flagged_usd: Math.round(after8Op14Usd * 100) / 100,
      },
    };
  }

  // get_lost_sales
  const groupId = getValidGroupId(args.group_id ?? situation?.groupId);
  const grpLabel = groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
  const targetStores: StoreId[] = isValidStoreId(args.store_id)
    ? [args.store_id]
    : situation?.stores?.map((s) => s.storeId) ??
      STORES.filter((st) => {
        const gs = sim.storeRecordsByDate[safeDate][st.id].groups[groupId];
        return sim.storeRecordsByDate[safeDate][st.id].isOpen && (gs.weeksOfCover ?? 99) < 2.5;
      }).map((s) => s.id);

  let cumulativeLostUsd = 0;
  let weeklyRateUsd = 0;
  const liveStartIdx = sim.dates.indexOf(sim.liveDates[0]);
  const startK = liveStartIdx >= 0 ? liveStartIdx : 0;

  for (let k = startK; k <= safeDateIdx; k++) {
    const recs = sim.storeRecordsByDate[sim.dates[k]];
    for (const sid of targetStores) {
      const grp = recs[sid].groups[groupId];
      cumulativeLostUsd += Math.max(0, grp.potentialSales - grp.actualSales);
    }
  }

  for (const sid of targetStores) {
    const grp = sim.storeRecordsByDate[safeDate][sid].groups[groupId];
    weeklyRateUsd += grp.potentialSales * 7;
  }

  // Estimate transferable weekly recovery if donor stock exists
  const fCum = createFact(
    `tool:lost:${groupId}:so_far:${safeDate}`,
    `${grpLabel} lost sales so far`,
    cumulativeLostUsd,
    'USD',
    `Cumulative ${grpLabel} potential sales minus actual sales across ${targetStores.map((s) => STORE_MAP[s].name).join(', ')} through ${safeDate}.`,
  );
  const fWeekly = createFact(
    `tool:lost:${groupId}:per_week:${safeDate}`,
    `${grpLabel} weekly sales at risk if nothing is done`,
    weeklyRateUsd,
    'USD',
    `Estimated weekly ${grpLabel} demand across ${targetStores.map((s) => STORE_MAP[s].name).join(', ')} at risk without action as of ${safeDate}.`,
  );
  const fDoNothingEffect = createFact(
    `tool:option:do_nothing:${groupId}:${safeDate}`,
    'Do nothing weekly effect',
    -weeklyRateUsd,
    'USD',
    `Weekly sales loss if no transfer or action is taken (-$${Math.round(weeklyRateUsd).toLocaleString('en-US')}/wk).`,
  );
  const fTransferEffect = createFact(
    `tool:option:transfer:${groupId}:${safeDate}`,
    'Rebalance from donor stores weekly effect',
    weeklyRateUsd * 0.85,
    'USD',
    `Estimated weekly sales protected by rebalancing idle surplus stock from donor stores to short stores (85% demand recovery).`,
  );

  return {
    toolName,
    argsSummary: `group_id=${groupId}${args.store_id ? `, store_id=${args.store_id}` : ''}`,
    facts: [fCum, fWeekly, fDoNothingEffect, fTransferEffect],
    payload: {
      facts: [fCum, fWeekly, fDoNothingEffect, fTransferEffect],
      affected_stores: targetStores,
    },
  };
}
