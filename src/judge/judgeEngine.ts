import { addDays, diffDays, formatShortDate, LIVE_END_DATE, LIVE_START_DATE } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation, SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES, STORE_MAP, STORES } from '../engine/stores';
import { runDetectorsForDay } from '../detectors/detectors';
import { applySilenceChecks } from '../detectors/silenceChecks';
import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { executeCheckerTool } from '../checker/tools';
import { evaluateActionsUpToDate } from '../followup/proof';
import { ActionDecision, Fact, StoreId, TransferLine } from '../types/domain';

export type JudgeChoiceId = 'a' | 'b' | 'c';

export interface JudgeOption {
  id: JudgeChoiceId;
  label: string;
  detail: string;
  lossUsd: number;
  lossFact?: Fact;
  isCorrect?: boolean;
  resultSummary: string;
  resultFacts: Fact[];
}

export interface JudgeTableRow {
  store: string;
  col1: string;
  col2: string;
  col3: string;
  col4?: string;
}

export interface JudgeNumbersLine {
  id: string;
  parts: Array<{ text?: string; fact?: Fact }>;
}

export interface JudgeCaseSpec {
  caseNumber: 1 | 2 | 3 | 4;
  date: string;
  dateFormatted: string;
  title: string;
  whatYouSeeLead: string;
  whatYouSeeColumns: string[];
  whatYouSeeRows: JudgeTableRow[];
  promptQuestion: string;
  options: [JudgeOption, JudgeOption, JudgeOption];
  numbersLines: JudgeNumbersLine[];
  hasDelaySlider: boolean;
  delaySliderConfig?: {
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    unitSingular: string;
    unitPlural: string;
    label: string;
    helperText: string;
  };
  noSliderExplanation?: string;
  opscienSummary: string;
  opscienCostFact?: Fact;
  opscienExtraFacts: Fact[];
}

export interface JudgeDelayEvaluation {
  delayValue: number;
  actDate: string;
  lossFact: Fact;
  lossUsd: number;
  detailText: string;
}

export interface JudgeScenarioBundle {
  seed: number;
  cases: [JudgeCaseSpec, JudgeCaseSpec, JudgeCaseSpec, JudgeCaseSpec];
  opscienTotalFact: Fact;
  worstTotalFact: Fact;
  baselineSim: SimulationRun;
}

const bundleCache = new Map<number, JudgeScenarioBundle>();
const case1DelayCache = new Map<string, JudgeDelayEvaluation>();
const case3DelayCache = new Map<string, JudgeDelayEvaluation>();

function sumBestSellersLossForStores(
  sim: SimulationRun,
  storeIds: StoreId[],
  upToDate: string = LIVE_END_DATE,
): { lossUsd: number; emptyDays: number } {
  let lossRaw = 0;
  let emptyDays = 0;
  for (const d of sim.liveDates) {
    if (d > upToDate) break;
    const recs = sim.storeRecordsByDate[d];
    let anyEmptyToday = false;
    for (const sid of storeIds) {
      const r = recs[sid];
      if (!r?.isOpen) continue;
      const g = r.groups.best_sellers;
      const diff = Math.max(0, g.potentialSales - g.actualSales);
      lossRaw += diff;
      if (diff > 0.01) anyEmptyToday = true;
    }
    if (anyEmptyToday) emptyDays += 1;
  }
  return { lossUsd: Math.round(lossRaw), emptyDays };
}

function sumUnlinkedCashRefunds(
  sim: SimulationRun,
  startDate: string = LIVE_START_DATE,
  endDate: string = LIVE_END_DATE,
): { count: number; lossUsd: number; minAmt: number; maxAmt: number; minTime: string; maxTime: string } {
  const rows = sim.walnutCreekRefunds.filter(
    (r) => r.date >= startDate && r.date <= endDate && !r.linkedOrder,
  );
  let sum = 0;
  let minAmt = rows.length > 0 ? Infinity : 0;
  let maxAmt = 0;
  let minTime = rows.length > 0 ? '23:59' : '';
  let maxTime = rows.length > 0 ? '00:00' : '';
  for (const r of rows) {
    sum += r.amount;
    if (r.amount < minAmt) minAmt = r.amount;
    if (r.amount > maxAmt) maxAmt = r.amount;
    if (r.time < minTime) minTime = r.time;
    if (r.time > maxTime) maxTime = r.time;
  }
  return {
    count: rows.length,
    lossUsd: Math.round(sum),
    minAmt: rows.length > 0 ? Math.round(minAmt) : 0,
    maxAmt: rows.length > 0 ? Math.round(maxAmt) : 0,
    minTime,
    maxTime,
  };
}

function buildManualBestSellersDecision(params: {
  id: string;
  date: string;
  donors: Array<{ storeId: StoreId; spare: number }>;
  allocations: Array<{ storeId: StoreId; units: number }>;
  holdoutStoreId?: StoreId;
}): ActionDecision {
  const donorPool = donorsCopy(params.donors);
  const transferLines: TransferLine[] = [];
  let donorIdx = 0;

  for (const alloc of params.allocations) {
    let rem = alloc.units;
    while (rem > 0 && donorIdx < donorPool.length) {
      const d = donorPool[donorIdx];
      if (d.spare <= 0) {
        donorIdx += 1;
        continue;
      }
      const move = Math.min(rem, d.spare);
      if (move > 0) {
        transferLines.push({
          fromStoreId: d.storeId,
          fromStoreName: STORE_MAP[d.storeId].name,
          toStoreId: alloc.storeId,
          toStoreName: STORE_MAP[alloc.storeId].name,
          groupId: 'best_sellers',
          units: move,
        });
        d.spare -= move;
        rem -= move;
      }
      if (d.spare <= 0) donorIdx += 1;
    }
  }

  return {
    id: params.id,
    candidateId: 'situation:stock_running_out:best_sellers',
    date: params.date,
    kind: 'transfer',
    groupId: 'best_sellers',
    holdoutStoreId: params.holdoutStoreId,
    transferLines,
    totalUnits: transferLines.reduce((s, l) => s + l.units, 0),
    arrivalDate: addDays(params.date, 2),
  };
}

function donorsCopy(donors: Array<{ storeId: StoreId; spare: number }>) {
  return donors.map((d) => ({ ...d }));
}

function computeQuietAndSignalCountsForOpscienRun(seed: number, sim0: SimulationRun): {
  signalsChecked: number;
  stayedQuiet: number;
} {
  // Purely deterministic count matching the seasonal Opscien actions without calling Gemini:
  // Re-run simulation with the 5 Opscien decisions and tally detector candidates & silence-checked items.
  const sep8Plan = buildTransferPlanForGroup({
    sim: sim0,
    date: '2026-09-08',
    groupId: 'best_sellers',
  }).plan;
  const decSep8: ActionDecision = {
    id: 'judge:opscien:bs1',
    candidateId: 'situation:stock_running_out:best_sellers',
    date: '2026-09-08',
    kind: 'transfer',
    groupId: 'best_sellers',
    holdoutStoreId: sep8Plan.holdoutStoreId,
    transferLines: sep8Plan.transferLines,
    totalUnits: sep8Plan.totalUnitsFact.value,
    arrivalDate: addDays('2026-09-08', 2),
  };
  const simAfterSep8 = runSimulation(seed, [decSep8], LIVE_END_DATE);
  const wcKwPlan = buildTransferPlanForGroup({
    sim: simAfterSep8,
    date: '2026-09-25',
    groupId: 'knitwear',
    controlStores: new Set(['santana_row']),
  }).plan;
  const decWcKw: ActionDecision = {
    id: 'judge:opscien:wckw',
    candidateId: 'situation:stock_running_out:knitwear',
    date: '2026-09-25',
    kind: 'transfer',
    groupId: 'knitwear',
    transferLines: wcKwPlan.transferLines,
    totalUnits: wcKwPlan.totalUnitsFact.value,
    arrivalDate: addDays('2026-09-25', 2),
  };
  const rolloutPlan = buildTransferPlanForGroup({
    sim: simAfterSep8,
    date: '2026-09-27',
    groupId: 'best_sellers',
    explicitReceivers: ['santana_row'],
    disableHoldout: true,
  }).plan;
  const decRollout: ActionDecision = {
    id: 'judge:opscien:bs_rollout',
    candidateId: 'rollout:judge:opscien:bs1',
    date: '2026-09-27',
    kind: 'transfer',
    groupId: 'best_sellers',
    parentDecisionId: decSep8.id,
    transferLines: rolloutPlan.transferLines,
    totalUnits: rolloutPlan.totalUnitsFact.value,
    arrivalDate: addDays('2026-09-27', 2),
  };
  const decRefund: ActionDecision = {
    id: 'judge:opscien:refund',
    candidateId: 'situation:refunds_out_of_line:walnut_creek',
    date: '2026-09-30',
    kind: 'refund_switch',
  };
  const midDecisions = [decSep8, decWcKw, decRollout, decRefund];
  const simMid = runSimulation(seed, midDecisions, LIVE_END_DATE);
  const pasPlan = buildTransferPlanForGroup({
    sim: simMid,
    date: '2026-10-15',
    groupId: 'knitwear',
  }).plan;
  const decPas: ActionDecision = {
    id: 'judge:opscien:paskw',
    candidateId: 'situation:stock_running_out:knitwear',
    date: '2026-10-15',
    kind: 'transfer',
    groupId: 'knitwear',
    isAutonomous: true,
    transferLines: pasPlan.transferLines,
    totalUnits: pasPlan.totalUnitsFact.value,
    arrivalDate: addDays('2026-10-15', 2),
  };
  const simAfterPas = runSimulation(seed, [...midDecisions, decPas], LIVE_END_DATE);
  const napaPlan = buildTransferPlanForGroup({
    sim: simAfterPas,
    date: '2026-11-01',
    groupId: 'knitwear',
  }).plan;
  const decNapa: ActionDecision = {
    id: 'judge:opscien:napakw',
    candidateId: 'situation:stock_running_out:knitwear',
    date: '2026-11-01',
    kind: 'transfer',
    groupId: 'knitwear',
    isAutonomous: true,
    transferLines: napaPlan.transferLines,
    totalUnits: napaPlan.totalUnitsFact.value,
    arrivalDate: addDays('2026-11-01', 2),
  };
  const fullDecs = [...midDecisions, decPas, decNapa];
  const simFull = runSimulation(seed, fullDecs, LIVE_END_DATE);

  let signalsChecked = 0;
  let stayedQuiet = 0;
  for (const d of simFull.liveDates) {
    const activeDecs = fullDecs.filter((dec) => dec.date <= d);
    const controlStores = new Set<string>();
    if (d >= decSep8.date && d < decRollout.date && decSep8.holdoutStoreId) {
      controlStores.add(decSep8.holdoutStoreId);
    }
    const rawCands = runDetectorsForDay(simFull, d);
    signalsChecked += rawCands.length;
    for (const raw of rawCands) {
      const checked = applySilenceChecks(raw, simFull, d, activeDecs, controlStores);
      if (checked.explainedBy) {
        stayedQuiet += 1;
      }
    }
  }
  return { signalsChecked, stayedQuiet };
}

export function getJudgeScenarioBundle(seed: number = DEFAULT_SEED): JudgeScenarioBundle {
  const cached = bundleCache.get(seed);
  if (cached) return cached;

  const sim0 = runSimulation(seed, [], LIVE_END_DATE);
  const shortStores: StoreId[] = ['union_square', 'palo_alto', 'santana_row'];

  // ---------- CASE 1: 2026-09-08 Best-sellers shortage ----------
  const sep8Date = '2026-09-08';
  const sep8Recs = sim0.storeRecordsByDate[sep8Date];
  const sep8StockTool = executeCheckerTool(
    'get_stock_cover_by_store_and_group',
    { group_id: 'best_sellers' },
    sim0,
    sep8Date,
  );
  const strictPlan = buildTransferPlanForGroup({
    sim: sim0,
    date: sep8Date,
    groupId: 'best_sellers',
    disableHoldout: true,
  }).plan;

  const donorStocks = (['sacramento', 'santa_barbara', 'rockridge', 'walnut_creek', 'pasadena', 'burlingame'] as StoreId[]).map(
    (sid) => {
      const gs = sep8Recs[sid].groups.best_sellers;
      const cov = gs.weeksOfCover ?? 0;
      const avgW = cov > 0.01 ? gs.endingStock / cov : gs.unitsDemanded * 7;
      return {
        storeId: sid,
        spare: Math.max(0, Math.floor(gs.endingStock - (62 / 7 + 1) * avgW)),
      };
    },
  );

  // Strict spare (8 weeks + delivery floor formula matching card top 3,822)
  const nextDelBs = sim0.scheduledDeliveries
    .filter((d) => d.groupId === 'best_sellers' && d.date > sep8Date)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysToDel = diffDays(sep8Date, nextDelBs.date);
  const strictFloor = Math.max(8, daysToDel / 7 + 1);
  let strictSpareTotal = 0;
  for (const st of STORES) {
    if (shortStores.includes(st.id)) continue;
    const gs = sep8Recs[st.id].groups.best_sellers;
    const cov = gs.weeksOfCover ?? 0;
    const baseW = (st.baseDailySales * 7 * 0.35 * 1.06) / 120;
    const avgW = cov > 0.01 ? gs.endingStock / cov : baseW;
    const sp = Math.floor(gs.endingStock - strictFloor * Math.max(avgW, baseW));
    if (sp >= 10) strictSpareTotal += sp;
  }

  const rawToolSpareFact = sep8StockTool.facts.find((f) => f.id.startsWith('tool:stock:donor_surplus:best_sellers:'))!;
  const toolSpareFact = createFact(
    'judge:c1:spare_pool',
    'Best-sellers spare units at giving stores',
    rawToolSpareFact.value,
    'units',
    'Total Best-sellers units available across 6 giving stores (Walnut Creek, Pasadena, Sacramento, Santa Barbara, Rockridge, Burlingame) after keeping each store’s 8-week and delivery-buffer floor.',
  );

  // Option A: Do nothing
  const c1OptA = sumBestSellersLossForStores(sim0, shortStores, LIVE_END_DATE);

  // Option B: Flat 1,500 units (500 units × 3 stores, allocated evenly across the 3 short stores: 700 / 500 / 300)
  const flatPool = 500 * shortStores.length;
  const weightSumB = shortStores.reduce(
    (s, sid) => s + sep8Recs[sid].groups.best_sellers.potentialSales,
    0,
  );
  const allocB: Array<{ storeId: StoreId; units: number }> = shortStores.map((sid, idx) => {
    if (idx < shortStores.length - 1) {
      return {
        storeId: sid,
        units: Math.round((sep8Recs[sid].groups.best_sellers.potentialSales / weightSumB) * flatPool / 100) * 100,
      };
    }
    return { storeId: sid, units: 0 };
  });
  allocB[allocB.length - 1].units = flatPool - allocB.slice(0, -1).reduce((s, a) => s + a.units, 0);
  const dec1B = buildManualBestSellersDecision({
    id: 'judge:c1:b',
    date: sep8Date,
    donors: donorStocks,
    allocations: allocB,
  });
  const sim1B = runSimulation(seed, [dec1B], LIVE_END_DATE);
  const c1OptB = sumBestSellersLossForStores(sim1B, shortStores, LIVE_END_DATE);

  // Option C: 9 weeks of trailing 28-day demand (2,191 units = 945 + 685 + 561)
  const allocC: Array<{ storeId: StoreId; units: number }> = shortStores.map((sid) => {
    const gs = sep8Recs[sid].groups.best_sellers;
    const avgW = gs.endingStock / (gs.weeksOfCover ?? 1);
    return { storeId: sid, units: Math.max(0, Math.ceil(9 * avgW - gs.endingStock)) };
  });
  const unitsC = allocC.reduce((s, a) => s + a.units, 0);
  const dec1C = buildManualBestSellersDecision({
    id: 'judge:c1:c',
    date: sep8Date,
    donors: donorStocks,
    allocations: allocC,
  });
  const sim1C = runSimulation(seed, [dec1C], LIVE_END_DATE);
  const c1OptC = sumBestSellersLossForStores(sim1C, shortStores, LIVE_END_DATE);

  // Opscien actual Case 1 path (Sep 8 holdout transfer + Sep 27 rollout)
  const opscienPlanSep8 = buildTransferPlanForGroup({
    sim: sim0,
    date: sep8Date,
    groupId: 'best_sellers',
  }).plan;
  const decOpsSep8: ActionDecision = {
    id: 'judge:ops:sep8',
    candidateId: 'situation:stock_running_out:best_sellers',
    date: sep8Date,
    kind: 'transfer',
    groupId: 'best_sellers',
    holdoutStoreId: opscienPlanSep8.holdoutStoreId,
    transferLines: opscienPlanSep8.transferLines,
    totalUnits: opscienPlanSep8.totalUnitsFact.value,
    arrivalDate: addDays(sep8Date, 2),
  };
  const simAfterOpsSep8 = runSimulation(seed, [decOpsSep8], LIVE_END_DATE);
  const opsRolloutPlan = buildTransferPlanForGroup({
    sim: simAfterOpsSep8,
    date: '2026-09-27',
    groupId: 'best_sellers',
    explicitReceivers: ['santana_row'],
    disableHoldout: true,
  }).plan;
  const decOpsRollout: ActionDecision = {
    id: 'judge:ops:sep27',
    candidateId: 'rollout:judge:ops:sep8',
    date: '2026-09-27',
    kind: 'transfer',
    groupId: 'best_sellers',
    parentDecisionId: decOpsSep8.id,
    transferLines: opsRolloutPlan.transferLines,
    totalUnits: opsRolloutPlan.totalUnitsFact.value,
    arrivalDate: addDays('2026-09-27', 2),
  };
  const simOpsC1 = runSimulation(seed, [decOpsSep8, decOpsRollout], LIVE_END_DATE);
  const opsC1Loss = sumBestSellersLossForStores(simOpsC1, shortStores, LIVE_END_DATE);

  // Case 1 pacing facts
  const unionRec = sep8Recs.union_square.groups.best_sellers;
  const paloRec = sep8Recs.palo_alto.groups.best_sellers;
  const santRec = sep8Recs.santana_row.groups.best_sellers;
  const unionEarlyAugWk =
    sim0.dates
      .filter((d) => d >= '2026-08-01' && d <= '2026-08-24')
      .reduce((s, d) => s + sim0.storeRecordsByDate[d].union_square.groups.best_sellers.unitsSold, 0) /
    (24 / 7);
  const unionLast7Units = sim0.dates
    .filter((d) => d >= '2026-09-02' && d <= '2026-09-08')
    .reduce((s, d) => s + sim0.storeRecordsByDate[d].union_square.groups.best_sellers.unitsSold, 0);
  const unionPaceJumpPct = ((unionLast7Units / unionEarlyAugWk) - 1) * 100;

  const case1Spec: JudgeCaseSpec = {
    caseNumber: 1,
    date: sep8Date,
    dateFormatted: formatShortDate(sep8Date),
    title: 'Best-sellers running low at three stores',
    whatYouSeeLead: `Three busy stores are under three weeks of Best-sellers stock, and the next factory delivery is ${daysToDel} days away on ${formatShortDate(nextDelBs.date)}. Other stores hold full shelves.`,
    whatYouSeeColumns: ['Store', 'Stock on hand', 'Weekly pace', 'Stock left'],
    whatYouSeeRows: [
      {
        store: 'Union Square',
        col1: `${Math.round(unionRec.endingStock).toLocaleString('en-US')} units`,
        col2: `${Math.round(unionRec.endingStock / (unionRec.weeksOfCover ?? 1)).toLocaleString('en-US')} units/wk`,
        col3: `${(unionRec.weeksOfCover ?? 0).toFixed(1)} wks`,
      },
      {
        store: 'Palo Alto',
        col1: `${Math.round(paloRec.endingStock).toLocaleString('en-US')} units`,
        col2: `${Math.round(paloRec.endingStock / (paloRec.weeksOfCover ?? 1)).toLocaleString('en-US')} units/wk`,
        col3: `${(paloRec.weeksOfCover ?? 0).toFixed(1)} wks`,
      },
      {
        store: 'Santana Row',
        col1: `${Math.round(santRec.endingStock).toLocaleString('en-US')} units`,
        col2: `${Math.round(santRec.endingStock / (santRec.weeksOfCover ?? 1)).toLocaleString('en-US')} units/wk`,
        col3: `${(santRec.weeksOfCover ?? 0).toFixed(1)} wks`,
      },
      {
        store: 'Sacramento, Santa Barbara, Rockridge (combined)',
        col1: `${(['sacramento', 'santa_barbara', 'rockridge'] as StoreId[])
          .reduce((s, sid) => s + Math.round(sep8Recs[sid].groups.best_sellers.endingStock), 0)
          .toLocaleString('en-US')} units`,
        col2: `${(['sacramento', 'santa_barbara', 'rockridge'] as StoreId[])
          .reduce(
            (s, sid) =>
              s +
              Math.round(
                sep8Recs[sid].groups.best_sellers.endingStock /
                  (sep8Recs[sid].groups.best_sellers.weeksOfCover ?? 1),
              ),
            0,
          )
          .toLocaleString('en-US')} units/wk`,
        col3: `${Math.min(
          sep8Recs.sacramento.groups.best_sellers.weeksOfCover ?? 0,
          sep8Recs.santa_barbara.groups.best_sellers.weeksOfCover ?? 0,
          sep8Recs.rockridge.groups.best_sellers.weeksOfCover ?? 0,
        ).toFixed(1)}+ wks`,
      },
    ],
    promptQuestion: 'What would you do this morning?',
    options: [
      {
        id: 'a',
        label: `Wait for the ${formatShortDate(nextDelBs.date)} delivery`,
        detail: 'Leave stock where it sits and let the next planned delivery fill the shelves.',
        lossUsd: c1OptA.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_a:loss',
          'Case 1 Option A lost sales',
          c1OptA.lossUsd,
          'USD',
          'Simulated Best-sellers sales lost across Union Square, Palo Alto, and Santana Row through 14 Nov with no transfer.',
        ),
        resultSummary: `All three stores run dry for ${c1OptA.emptyDays} days until the ${formatShortDate(nextDelBs.date)} delivery arrives.`,
        resultFacts: [
          createFact(
            'judge:c1:opt_a:empty_days',
            'Days with empty shelves',
            c1OptA.emptyDays,
            'days',
            'Days from 21 Sep through 8 Nov where affected stores had zero Best-sellers stock.',
          ),
        ],
      },
      {
        id: 'b',
        label: `Move ${flatPool.toLocaleString('en-US')} units now`,
        detail: `Send a quick round transfer (${allocB.map((a) => `${a.units} to ${STORE_MAP[a.storeId].name}`).join(', ')}) from well-stocked stores.`,
        lossUsd: c1OptB.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_b:loss',
          'Case 1 Option B lost sales',
          c1OptB.lossUsd,
          'USD',
          `Simulated Best-sellers sales lost after transferring ${flatPool.toLocaleString('en-US')} units on 8 Sep.`,
        ),
        resultSummary: `It buys time, then runs short again before ${formatShortDate(nextDelBs.date)} because the gap is larger than ${flatPool.toLocaleString('en-US')} units.`,
        resultFacts: [
          createFact(
            'judge:c1:opt_b:empty_days',
            'Days still short',
            c1OptB.emptyDays,
            'days',
            'Days later in the season with empty shelves after the 1,500-unit transfer ran out.',
          ),
        ],
      },
      {
        id: 'c',
        label: `Cover 9 weeks at recent sales pace (${unitsC.toLocaleString('en-US')} units)`,
        detail: `Move ${allocC.map((a) => `${a.units} to ${STORE_MAP[a.storeId].name}`).join(', ')} based on the last four weeks of sales.`,
        lossUsd: c1OptC.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_c:loss',
          'Case 1 Option C lost sales',
          c1OptC.lossUsd,
          'USD',
          `Simulated Best-sellers sales lost after transferring ${unitsC.toLocaleString('en-US')} units based on 9 weeks of trailing 28-day demand.`,
        ),
        resultSummary: `Leaves out the ${daysToDel}-day wait until ${formatShortDate(nextDelBs.date)} plus buffer, so shelves still empty out late in the gap (${c1OptC.emptyDays} days short).`,
        resultFacts: [
          createFact(
            'judge:c1:opt_c:opt_needed',
            'Needed to stop all loss',
            strictPlan.totalUnitsFact.value,
            'units',
            'Full transfer units needed on 8 Sep without holding a store back to avoid any lost sales before 9 Nov.',
          ),
        ],
      },
    ],
    numbersLines: [
      {
        id: 'c1-num-1',
        parts: [
          {
            text: `Union Square holds ${Math.round(unionRec.endingStock)} units (` +
              `${(unionRec.weeksOfCover ?? 0).toFixed(1)} wks) and sales pace in the last week rose `,
          },
          {
            fact: createFact(
              'judge:c1:pace_jump',
              'Union Square sales pace rise',
              unionPaceJumpPct,
              'percent',
              'Union Square Best-sellers units sold in the 7 days ending 8 Sep vs early-August weekly average.',
            ),
          },
          { text: ' above early August.' },
        ],
      },
      {
        id: 'c1-num-2',
        parts: [
          {
            text: `The next Best-sellers delivery is `,
          },
          {
            fact: createFact(
              'judge:c1:del_days',
              'Days until next delivery',
              daysToDel,
              'days',
              'Days from 8 Sep until the 9 Nov scheduled Best-sellers delivery.',
            ),
          },
          {
            text: ` away (${formatShortDate(nextDelBs.date)}). Without help, shelves empty out on 21 Sep for ${c1OptA.emptyDays} days.`,
          },
        ],
      },
      {
        id: 'c1-num-3',
        parts: [
          { text: 'Giving stores (Sacramento, Santa Barbara, Rockridge, and three more) hold ' },
          { fact: toolSpareFact },
          {
            text: ` above their own safety limit (${strictSpareTotal.toLocaleString('en-US')} under the stricter card limit). Reaching ${formatShortDate(nextDelBs.date)} at zero loss requires `,
          },
          {
            fact: createFact(
              'judge:c1:zero_loss_units',
              'Units needed for zero loss',
              strictPlan.totalUnitsFact.value,
              'units',
              'Total Best-sellers units needed across Union Square, Palo Alto, and Santana Row on 8 Sep.',
            ),
          },
          { text: ' moved now.' },
        ],
      },
    ],
    hasDelaySlider: true,
    delaySliderConfig: {
      min: 0,
      max: 28,
      step: 1,
      defaultValue: 14,
      unitSingular: 'day',
      unitPlural: 'days',
      label: 'Days after shelves run empty (starting 21 Sep) before you approve a full move',
      helperText: 'Slide to see how much waiting costs once Union Square, Palo Alto, and Santana Row start running out.',
    },
    opscienSummary:
      `Opscien noticed the shortage on ${formatShortDate(sep8Date)}, moved ${opscienPlanSep8.totalUnitsFact.formatted} to Union Square and Palo Alto, and held Santana Row back to prove it worked. Once proven on 27 Sep, it sent ${opsRolloutPlan.totalUnitsFact.formatted} to Santana Row. No extra stock was bought.`,
    opscienCostFact: createFact(
      'judge:ops:c1_cost',
      'Opscien Case 1 lost sales',
      opsC1Loss.lossUsd,
      'USD',
      'Sales lost at Santana Row only while held back from 21 Sep to 29 Sep to prove the transfer caused the gain.',
    ),
    opscienExtraFacts: [
      createFact(
        'judge:ops:c1_sep8_units',
        'Units moved on 8 Sep',
        opscienPlanSep8.totalUnitsFact.value,
        'units',
        'Total Best-sellers units moved from giving stores to Union Square and Palo Alto on 8 Sep.',
      ),
      createFact(
        'judge:ops:c1_sep27_units',
        'Units moved on 27 Sep',
        opsRolloutPlan.totalUnitsFact.value,
        'units',
        'Remaining Best-sellers units moved from giving stores to Santana Row on 27 Sep once proven.',
      ),
    ],
  };

  // ---------- CASE 2: 2026-08-10 Summer lull dip ----------
  const aug10Date = '2026-08-10';
  const aug3_9Sales = sim0.dates
    .filter((d) => d >= '2026-08-03' && d <= '2026-08-09')
    .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0);
  const jul4wSales =
    sim0.dates
      .filter((d) => d >= '2026-06-29' && d <= '2026-07-26')
      .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0) / 4;
  const augDropVsJulyPct = ((aug3_9Sales / jul4wSales) - 1) * 100;
  const crAug9 = sim0.chainRecordsByDate['2026-08-09'];
  const estVsExpectedPct = ((crAug9.establishedTrailing7Actual / crAug9.establishedTrailing7Expected) - 1) * 100;
  const pyJulSales =
    sim0.dates
      .filter((d) => d >= '2025-07-06' && d <= '2025-08-02')
      .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0) / 4;
  const pyAugSales =
    sim0.dates
      .filter((d) => d >= '2025-08-11' && d <= '2025-08-24')
      .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0) / 2;
  const pyLullPct = ((pyAugSales / pyJulSales) - 1) * 100;
  const sepReboundWeek = sim0.dates
    .filter((d) => d >= '2026-09-07' && d <= '2026-09-13')
    .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0);

  const aug10_16Sales = sim0.dates
    .filter((d) => d >= '2026-08-10' && d <= '2026-08-16')
    .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0);
  const aug14_16Sales = sim0.dates
    .filter((d) => d >= '2026-08-14' && d <= '2026-08-16')
    .reduce((s, d) => s + sim0.chainRecordsByDate[d].allStoresActualSales, 0);

  const c2OptACost = Math.round(aug10_16Sales * 0.2); // $47,103
  const c2OptBCost = Math.round(aug14_16Sales * 0.2); // $25,158
  const c2OptCCost = 0;

  const workCounts = computeQuietAndSignalCountsForOpscienRun(seed, sim0);

  const case2Spec: JudgeCaseSpec = {
    caseNumber: 2,
    date: aug10Date,
    dateFormatted: formatShortDate(aug10Date),
    title: 'Weekly sales dropped in early August',
    whatYouSeeLead:
      'Your Monday morning report shows a steep drop compared with midsummer weeks in July across all open stores.',
    whatYouSeeColumns: ['Period', 'Open stores', 'Weekly sales', 'Compared with July'],
    whatYouSeeRows: [
      {
        store: 'Midsummer weekly average (July)',
        col1: '9',
        col2: `$${Math.round(jul4wSales).toLocaleString('en-US')}`,
        col3: 'Peak summer pace',
      },
      {
        store: 'Last week (3 Aug – 9 Aug)',
        col1: '9',
        col2: `$${Math.round(aug3_9Sales).toLocaleString('en-US')}`,
        col3: `${augDropVsJulyPct.toFixed(1)}% vs July`,
      },
      {
        store: 'Same week a year ago (drop vs July)',
        col1: '8',
        col2: `$${Math.round(pyAugSales).toLocaleString('en-US')}`,
        col3: `${pyLullPct.toFixed(1)}% vs prior July`,
      },
    ],
    promptQuestion: 'What would you do on Monday morning?',
    options: [
      {
        id: 'a',
        label: 'Run a 20% sale all week (10 Aug – 16 Aug)',
        detail: 'Cut shelf prices by 20% across all stores for seven days to pull shoppers back.',
        lossUsd: c2OptACost,
        lossFact: createFact(
          'judge:c2:opt_a:cost',
          'Case 2 Option A discount given away',
          c2OptACost,
          'USD',
          `20% of normal week sales ($${Math.round(aug10_16Sales).toLocaleString('en-US')}) from 10 Aug to 16 Aug given away unnecessarily.`,
        ),
        resultSummary: `You give away 20% of a full week of normal summer sales while demand returns on its own anyway.`,
        resultFacts: [
          createFact(
            'judge:c2:opt_a:week_sales',
            'Sales during 7-day discount',
            Math.round(aug10_16Sales),
            'USD',
            'Actual sales across all open stores from 10 Aug to 16 Aug.',
          ),
        ],
      },
      {
        id: 'b',
        label: 'Run a 20% sale for the weekend (14 Aug – 16 Aug)',
        detail: 'Offer 20% off from Friday to Sunday only.',
        lossUsd: c2OptBCost,
        lossFact: createFact(
          'judge:c2:opt_b:cost',
          'Case 2 Option B discount given away',
          c2OptBCost,
          'USD',
          `20% of Friday–Sunday sales ($${Math.round(aug14_16Sales).toLocaleString('en-US')}) from 14 Aug to 16 Aug given away unnecessarily.`,
        ),
        resultSummary: `Weekend shoppers were coming anyway, so discounting Friday to Sunday still gives away ${`$${c2OptBCost.toLocaleString('en-US')}`}.`,
        resultFacts: [
          createFact(
            'judge:c2:opt_b:wknd_sales',
            'Friday–Sunday sales',
            Math.round(aug14_16Sales),
            'USD',
            'Actual sales across all open stores from 14 Aug to 16 Aug.',
          ),
        ],
      },
      {
        id: 'c',
        label: 'Do nothing and keep watching',
        detail: 'Leave prices alone and check whether sales sit inside the expected range for early August.',
        lossUsd: c2OptCCost,
        lossFact: createFact(
          'judge:c2:opt_c:cost',
          'Case 2 Option C discount lost',
          c2OptCCost,
          'USD',
          'No unnecessary price cut was run; sales returned naturally in September.',
        ),
        resultSummary: `Nothing was broken. Weekly sales rose back to $${Math.round(sepReboundWeek).toLocaleString('en-US')} in early September with full margin kept.`,
        resultFacts: [
          createFact(
            'judge:c2:opt_c:rebound',
            'Early September weekly sales',
            Math.round(sepReboundWeek),
            'USD',
            'All-store sales during 7 Sep – 13 Sep after normal August summer lull passed.',
          ),
        ],
      },
    ],
    numbersLines: [
      {
        id: 'c2-num-1',
        parts: [
          { text: 'All-store sales in 3 Aug – 9 Aug were ' },
          {
            fact: createFact(
              'judge:c2:aug_week',
              'Early August weekly sales',
              Math.round(aug3_9Sales),
              'USD',
              'Sum of all-store sales from 3 Aug to 9 Aug.',
            ),
          },
          { text: ` (${augDropVsJulyPct.toFixed(1)}% below midsummer July average ` },
          {
            fact: createFact(
              'judge:c2:jul_avg',
              'July weekly average',
              Math.round(jul4wSales),
              'USD',
              'Four-week average across 29 Jun – 26 Jul.',
            ),
          },
          { text: ').' },
        ],
      },
      {
        id: 'c2-num-2',
        parts: [
          {
            text: `On the 8 stores open more than 18 months, sales ($${Math.round(crAug9.establishedTrailing7Actual).toLocaleString('en-US')}) sat within `,
          },
          {
            fact: createFact(
              'judge:c2:est_gap',
              'Gap vs expected range',
              Math.abs(estVsExpectedPct),
              'percent',
              'How close established stores were to the expected range for the same week last year times growth.',
            ),
          },
          { text: ` of the expected range for this exact week of the calendar.` },
        ],
      },
      {
        id: 'c2-num-3',
        parts: [
          { text: 'Sales dipped ' },
          {
            fact: createFact(
              'judge:c2:py_lull',
              'Last August dip',
              Math.abs(pyLullPct),
              'percent',
              'Normal late-summer August dip measured against July the year before.',
            ),
          },
          {
            text: ` in mid-August the year before too, and recovered to $${Math.round(sepReboundWeek).toLocaleString('en-US')} a week by 13 Sep.`,
          },
        ],
      },
    ],
    hasDelaySlider: false,
    noSliderExplanation:
      'Speed is not the risk here. Raising a false alarm wastes money on a price cut even if you act that same morning — whereas checking properly shows there is nothing to fix.',
    opscienSummary: `Opscien noticed the August dip, checked the trading calendar against prior-year August, and kept quiet. Over the full 106 days it checked ${workCounts.signalsChecked.toLocaleString('en-US')} signals and kept ${workCounts.stayedQuiet} normal swings quiet — waking you zero times for false alarms.`,
    opscienCostFact: createFact(
      'judge:ops:c2_cost',
      'Opscien Case 2 lost margin',
      0,
      'USD',
      'Zero dollars lost on unnecessary discounts.',
    ),
    opscienExtraFacts: [
      createFact(
        'judge:ops:signals',
        'Signals checked across season',
        workCounts.signalsChecked,
        'count',
        'Total daily signals checked across the 106-day season.',
      ),
      createFact(
        'judge:ops:quiet',
        'Swings kept quiet',
        workCounts.stayedQuiet,
        'count',
        'Normal calendar and new-store swings checked and kept quiet.',
      ),
    ],
  };

  // ---------- CASE 3: 2026-09-30 Walnut Creek refunds ----------
  const sep30Date = '2026-09-30';
  const rbTool = executeCheckerTool(
    'get_refund_breakdown',
    { store_id: 'walnut_creek', window_days: 28 },
    sim0,
    sep30Date,
  );
  const storeRateFact = rbTool.facts.find((f) => f.id.includes('store_rate'))!;
  const otherRateFact = rbTool.facts.find((f) => f.id.includes('other_rate'))!;
  const op14UsdSep30Fact = rbTool.facts.find((f) => f.id.includes('op14_usd'))!;
  const op14CountSep30Fact = rbTool.facts.find((f) => f.id.includes('op14_count'))!;

  // 14d rate 17 Sep..30 Sep
  const sep17_30RefundUsd = sim0.walnutCreekRefunds
    .filter((r) => r.date >= '2026-09-17' && r.date <= sep30Date)
    .reduce((s, r) => s + r.amount, 0);
  const sep17_30Sales = sim0.dates
    .filter((d) => d >= '2026-09-17' && d <= sep30Date)
    .reduce((s, d) => s + sim0.storeRecordsByDate[d].walnut_creek.actualSales, 0);
  const last14RatePct = sep17_30Sales > 0 ? (sep17_30RefundUsd / sep17_30Sales) * 100 : 0;

  // All live-window unlinked refunds with no switch vs with switch on Sep 30
  const unlinkedAll = sumUnlinkedCashRefunds(sim0, LIVE_START_DATE, LIVE_END_DATE);
  const unlinkedSep30 = sumUnlinkedCashRefunds(sim0, LIVE_START_DATE, sep30Date);
  const simWithSwitchSep30 = runSimulation(
    seed,
    [{ id: 'judge:c3:sw', candidateId: 'situation:refunds_out_of_line:walnut_creek', date: sep30Date, kind: 'refund_switch' }],
    LIVE_END_DATE,
  );
  const unlinkedIfSwitchSep30 = sumUnlinkedCashRefunds(
    simWithSwitchSep30,
    LIVE_START_DATE,
    LIVE_END_DATE,
  );

  const sampleUnlinked = sim0.walnutCreekRefunds
    .filter((r) => r.date <= sep30Date && !r.linkedOrder)
    .slice(-3);
  const sampleLinked = sim0.walnutCreekRefunds
    .filter((r) => r.date <= sep30Date && r.linkedOrder)
    .slice(-1);

  const case3Spec: JudgeCaseSpec = {
    caseNumber: 3,
    date: sep30Date,
    dateFormatted: formatShortDate(sep30Date),
    title: 'Cash refunds spiked at Walnut Creek',
    whatYouSeeLead: `Walnut Creek’s refund rate over the last 28 days reached ${storeRateFact.formatted}, more than twice the ${otherRateFact.formatted} median at your other stores open more than 18 months. Below are four recent refund slips from the till.`,
    whatYouSeeColumns: ['Date & time', 'Method & till', 'Matching order', 'Amount'],
    whatYouSeeRows: [
      ...sampleUnlinked.map((r) => ({
        store: `${formatShortDate(r.date)} · ${r.time}`,
        col1: `Cash · Till ${r.till} (Staff ${r.operatorNumber})`,
        col2: 'None on file',
        col3: `$${Math.round(r.amount)}`,
      })),
      ...sampleLinked.map((r) => ({
        store: `${formatShortDate(r.date)} · ${r.time}`,
        col1: `${r.method === 'card' ? 'Card' : 'Cash'} · Till ${r.till} (Staff ${r.operatorNumber})`,
        col2: 'Linked sale receipt',
        col3: `$${Math.round(r.amount)}`,
      })),
    ],
    promptQuestion: 'What would you do this morning?',
    options: [
      {
        id: 'a',
        label: 'Leave it until the month-end review',
        detail: 'Make no till changes now and inspect refund totals at the end of next month.',
        lossUsd: unlinkedAll.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_a:loss',
          'Case 3 Option A unlinked cash refunds',
          unlinkedAll.lossUsd,
          'USD',
          `${unlinkedAll.count} unlinked cash refunds at Walnut Creek from 1 Aug through 14 Nov.`,
        ),
        resultSummary: `Without a rule change, ${unlinkedAll.count} unlinked late-evening cash refunds pass through the till by 14 Nov.`,
        resultFacts: [
          createFact(
            'judge:c3:opt_a:cnt',
            'Total unlinked cash refunds',
            unlinkedAll.count,
            'count',
            'Total cash refunds after 8 pm with no matching order through 14 Nov.',
          ),
        ],
      },
      {
        id: 'b',
        label: 'Turn on manager approval over $50 today',
        detail: 'Require a manager PIN on any cash refund above $50 with no linked order starting 30 Sep.',
        lossUsd: unlinkedIfSwitchSep30.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_b:loss',
          'Case 3 Option B lost before switch',
          unlinkedIfSwitchSep30.lossUsd,
          'USD',
          'Cash refunds lost before 30 Sep; future unlinked cash refunds over $50 stop immediately.',
        ),
        resultSummary: `Stops the loss right away on 30 Sep, saving $${(unlinkedAll.lossUsd - unlinkedIfSwitchSep30.lossUsd).toLocaleString('en-US')} between 30 Sep and 14 Nov.`,
        resultFacts: [
          createFact(
            'judge:c3:opt_b:saved',
            'Saved after 30 Sep',
            unlinkedAll.lossUsd - unlinkedIfSwitchSep30.lossUsd,
            'USD',
            'Future unlinked cash refunds prevented from 30 Sep through 14 Nov.',
          ),
        ],
      },
      {
        id: 'c',
        label: 'Turn on the $50 rule and add a daily review screen',
        detail: 'Block unlinked cash refunds over $50 without manager approval and give Walnut Creek a daily exception list.',
        lossUsd: unlinkedIfSwitchSep30.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_c:loss',
          'Case 3 Option C lost before switch',
          unlinkedIfSwitchSep30.lossUsd,
          'USD',
          'Cash refunds lost before 30 Sep; all future unlinked cash refunds over $50 stop immediately.',
        ),
        resultSummary: `Same $${unlinkedIfSwitchSep30.lossUsd.toLocaleString('en-US')} total prior loss — and the daily exception list flags repeat receipts right away.`,
        resultFacts: [
          createFact(
            'judge:c3:opt_c:saved',
            'Saved after 30 Sep',
            unlinkedAll.lossUsd - unlinkedIfSwitchSep30.lossUsd,
            'USD',
            'Future unlinked cash refunds prevented from 30 Sep through 14 Nov.',
          ),
        ],
      },
    ],
    numbersLines: [
      {
        id: 'c3-num-1',
        parts: [
          { text: 'Walnut Creek’s 28-day refund rate reached ' },
          { fact: storeRateFact },
          { text: ' vs ' },
          { fact: otherRateFact },
          { text: ' at other stores open more than 18 months — rising to ' },
          {
            fact: createFact(
              'judge:c3:14d_rate',
              'Last 14 days refund rate',
              last14RatePct,
              'percent',
              'Walnut Creek refunds divided by sales over 17 Sep – 30 Sep.',
            ),
          },
          { text: ' in the last 14 days.' },
        ],
      },
      {
        id: 'c3-num-2',
        parts: [
          { text: `Every unlinked cash refund came from Till 2, operator 14, between ${unlinkedSep30.minTime} and ${unlinkedSep30.maxTime}, for ` },
          {
            fact: createFact(
              'judge:c3:amt_min',
              'Smallest unlinked cash refund',
              unlinkedSep30.minAmt,
              'USD',
              'Smallest unlinked late-evening cash refund at Walnut Creek through 30 Sep.',
            ),
          },
          { text: ' to ' },
          {
            fact: createFact(
              'judge:c3:amt_max',
              'Largest unlinked cash refund',
              unlinkedSep30.maxAmt,
              'USD',
              'Largest unlinked late-evening cash refund at Walnut Creek through 30 Sep.',
            ),
          },
          { text: ' each.' },
        ],
      },
      {
        id: 'c3-num-3',
        parts: [
          { text: 'By 30 Sep, ' },
          { fact: op14CountSep30Fact },
          { text: ' of those receipts totaled ' },
          { fact: op14UsdSep30Fact },
          {
            text: `. Across the full season without a switch, ${unlinkedAll.count} receipts total $${unlinkedAll.lossUsd.toLocaleString('en-US')}.`,
          },
        ],
      },
    ],
    hasDelaySlider: true,
    delaySliderConfig: {
      min: 0,
      max: 6,
      step: 1,
      defaultValue: 2,
      unitSingular: 'week',
      unitPlural: 'weeks',
      label: 'Weeks before you turn on the $50 manager approval rule (after 30 Sep)',
      helperText: 'Slide to see how fast unlinked late-evening cash refunds pile up while a question waits in a queue.',
    },
    opscienSummary:
      'Opscien caught the spike without anyone asking, checked receipts by till, hour, and staff number, built and tested the Walnut Creek refund desk three times, and asked you to flip the $50 approval switch on 30 Sep.',
    opscienCostFact: createFact(
      'judge:ops:c3_cost',
      'Opscien Case 3 lost before 30 Sep rule',
      unlinkedIfSwitchSep30.lossUsd,
      'USD',
      'Unlinked cash refunds before Opscien’s $50 approval switch started on 30 Sep.',
    ),
    opscienExtraFacts: [op14CountSep30Fact, op14UsdSep30Fact],
  };

  // ---------- CASE 4: 2026-09-27 Holdout proof ----------
  const sep27Date = '2026-09-27';
  const sumStoreSales = (sim: SimulationRun, sids: StoreId[], start: string, end: string) =>
    sim.dates
      .filter((d) => d >= start && d <= end)
      .reduce(
        (s, d) => s + sids.reduce((ss, sid) => ss + sim.storeRecordsByDate[d][sid].actualSales, 0),
        0,
      );

  const treatedAfter = Math.round(sumStoreSales(simAfterOpsSep8, ['union_square', 'palo_alto'], '2026-09-10', '2026-09-23'));
  const treatedBefore = Math.round(sumStoreSales(simAfterOpsSep8, ['union_square', 'palo_alto'], '2026-08-25', '2026-09-07'));
  const treatedJumpPct = ((treatedAfter / treatedBefore) - 1) * 100;

  const healthyAfter = Math.round(sumStoreSales(simAfterOpsSep8, ['walnut_creek', 'pasadena'], '2026-09-10', '2026-09-23'));
  const healthyBefore = Math.round(sumStoreSales(simAfterOpsSep8, ['walnut_creek', 'pasadena'], '2026-08-25', '2026-09-07'));
  const healthyJumpPct = ((healthyAfter / healthyBefore) - 1) * 100;

  const srSep21_27 = simAfterOpsSep8.dates
    .filter((d) => d >= '2026-09-21' && d <= '2026-09-27')
    .reduce(
      (acc, d) => {
        const r = simAfterOpsSep8.storeRecordsByDate[d].santana_row;
        return {
          act: acc.act + r.actualSales,
          exp: acc.exp + (r.expectedSales ?? r.potentialSales),
          bsAct: acc.bsAct + r.groups.best_sellers.actualSales,
          bsPot: acc.bsPot + r.groups.best_sellers.potentialSales,
        };
      },
      { act: 0, exp: 0, bsAct: 0, bsPot: 0 },
    );
  const santanaDropPct = ((srSep21_27.act / srSep21_27.exp) - 1) * 100;

  const followUpSep27 = evaluateActionsUpToDate({
    sim: simAfterOpsSep8,
    decisions: [decOpsSep8],
    date: sep27Date,
    handledRolloutIds: new Set(),
  });
  const provenSep27Item = followUpSep27.doneForYou.find((d) => d.decisionId === decOpsSep8.id)!;
  const provenGainUsd = provenSep27Item.provenMoneyFact?.value ?? 0;

  // Compute Pasadena Knitwear automatic transfer savings
  const wcKwPlan = buildTransferPlanForGroup({
    sim: simAfterOpsSep8,
    date: '2026-09-25',
    groupId: 'knitwear',
    controlStores: new Set(['santana_row']),
  }).plan;
  const decWcKw: ActionDecision = {
    id: 'judge:ops:wckw',
    candidateId: 'situation:stock_running_out:knitwear',
    date: '2026-09-25',
    kind: 'transfer',
    groupId: 'knitwear',
    transferLines: wcKwPlan.transferLines,
    totalUnits: wcKwPlan.totalUnitsFact.value,
    arrivalDate: '2026-09-27',
  };
  const simWithPasBase = runSimulation(seed, [decOpsSep8, decOpsRollout, decWcKw], LIVE_END_DATE);
  const pasKwPlan = buildTransferPlanForGroup({
    sim: simWithPasBase,
    date: '2026-10-15',
    groupId: 'knitwear',
  }).plan;
  const decPasKw: ActionDecision = {
    id: 'judge:ops:paskw',
    candidateId: 'situation:stock_running_out:knitwear',
    date: '2026-10-15',
    kind: 'transfer',
    groupId: 'knitwear',
    isAutonomous: true,
    transferLines: pasKwPlan.transferLines,
    totalUnits: pasKwPlan.totalUnitsFact.value,
    arrivalDate: '2026-10-17',
  };
  const simWithPasAct = runSimulation(
    seed,
    [decOpsSep8, decOpsRollout, decWcKw, decPasKw],
    LIVE_END_DATE,
  );
  const pasBaseLoss = sim0.liveDates.reduce((s, d) => {
    const g = sim0.storeRecordsByDate[d].pasadena.groups.knitwear;
    return s + Math.max(0, g.potentialSales - g.actualSales);
  }, 0);
  const pasWithActLoss = simWithPasAct.liveDates.reduce((s, d) => {
    const g = simWithPasAct.storeRecordsByDate[d].pasadena.groups.knitwear;
    return s + Math.max(0, g.potentialSales - g.actualSales);
  }, 0);
  const pasadenaSavedUsd = Math.round(pasBaseLoss - pasWithActLoss);

  const proofEvalDates = simAfterOpsSep8.dates.filter(
    (d) => d >= '2026-09-10' && d <= '2026-09-27',
  );
  let treatedWindowAct = 0;
  let treatedWindowExp = 0;
  let holdoutWindowAct = 0;
  let holdoutWindowExp = 0;
  for (const d of proofEvalDates) {
    for (const sid of ['union_square', 'palo_alto'] as StoreId[]) {
      const r = simAfterOpsSep8.storeRecordsByDate[d][sid];
      treatedWindowAct += r.actualSales;
      treatedWindowExp += r.expectedSales ?? r.potentialSales;
    }
    const hr = simAfterOpsSep8.storeRecordsByDate[d].santana_row;
    holdoutWindowAct += hr.actualSales;
    holdoutWindowExp += hr.expectedSales ?? hr.potentialSales;
  }
  const treatedRatioPct = (treatedWindowAct / treatedWindowExp) * 100;
  const holdoutRatioPct = (holdoutWindowAct / holdoutWindowExp) * 100;

  const case4Spec: JudgeCaseSpec = {
    caseNumber: 4,
    date: sep27Date,
    dateFormatted: formatShortDate(sep27Date),
    title: 'Did the Best-sellers transfer cause the sales jump?',
    whatYouSeeLead:
      'Two weeks after the 8 Sep stock arrival (10 Sep – 23 Sep), sales jumped at the stores that got stock — and at healthy stores that already had plenty of stock.',
    whatYouSeeColumns: ['Store pair', '25 Aug – 7 Sep', '10 Sep – 23 Sep', 'Change'],
    whatYouSeeRows: [
      {
        store: 'Union Square & Palo Alto (got Best-sellers)',
        col1: `$${treatedBefore.toLocaleString('en-US')}`,
        col2: `$${treatedAfter.toLocaleString('en-US')}`,
        col3: `+${treatedJumpPct.toFixed(1)}%`,
      },
      {
        store: 'Walnut Creek & Pasadena (already stocked)',
        col1: `$${healthyBefore.toLocaleString('en-US')}`,
        col2: `$${healthyAfter.toLocaleString('en-US')}`,
        col3: `+${healthyJumpPct.toFixed(1)}%`,
      },
      {
        store: 'Santana Row (21 Sep – 27 Sep, held back)',
        col1: `$${Math.round(srSep21_27.exp).toLocaleString('en-US')} expected`,
        col2: `$${Math.round(srSep21_27.act).toLocaleString('en-US')} actual`,
        col3: `${santanaDropPct.toFixed(1)}%`,
      },
    ],
    promptQuestion: `Does the +${treatedJumpPct.toFixed(1)}% sales rise prove the transfer caused the jump?`,
    options: [
      {
        id: 'a',
        label: `Yes — before-and-after sales jumped ${treatedJumpPct.toFixed(1)}%`,
        detail: 'Sales at Union Square and Palo Alto went straight up once the stock arrived.',
        lossUsd: 0,
        isCorrect: false,
        resultSummary: `Before-and-after alone fools you here: Walnut Creek and Pasadena jumped +${healthyJumpPct.toFixed(1)}% over the exact same weeks because cool autumn shopping started across the whole chain.`,
        resultFacts: [
          createFact(
            'judge:c4:opt_a:healthy',
            'Healthy peer stores gain',
            healthyJumpPct,
            'percent',
            'Walnut Creek and Pasadena sales rise between 25 Aug – 7 Sep and 10 Sep – 23 Sep with no transfer.',
          ),
        ],
      },
      {
        id: 'b',
        label: 'Not alone — only holding Santana Row back proves it',
        detail: 'Both groups rose with autumn traffic, so comparing against the store held back settles it.',
        lossUsd: 0,
        isCorrect: true,
        resultSummary: `Right. Autumn traffic pushed every stocked store up, while Santana Row dropped ${santanaDropPct.toFixed(1)}% once its Best-sellers shelves emptied.`,
        resultFacts: [
          createFact(
            'judge:c4:opt_b:proven',
            'Proven gain against store held back',
            Math.round(provenGainUsd),
            'USD',
            'Proven sales gain from 10 Sep to 27 Sep compared against Santana Row held back.',
          ),
        ],
      },
      {
        id: 'c',
        label: 'No — the transfer made no real difference',
        detail: `Healthy stores grew even faster (+${healthyJumpPct.toFixed(1)}%), so the stock move was pointless.`,
        lossUsd: 0,
        isCorrect: false,
        resultSummary: `Wrong the other way: Santana Row — identical in Best-sellers cover on 8 Sep — collapsed to $${Math.round(srSep21_27.bsAct).toLocaleString('en-US')} out of $${Math.round(srSep21_27.bsPot).toLocaleString('en-US')} in Best-sellers demand (${santanaDropPct.toFixed(1)}% overall) when held back.`,
        resultFacts: [
          createFact(
            'judge:c4:opt_c:bs_act',
            'Santana Row Best-sellers sales (21–27 Sep)',
            Math.round(srSep21_27.bsAct),
            'USD',
            'Actual Best-sellers sales at Santana Row while out of stock in 21 Sep – 27 Sep.',
          ),
        ],
      },
    ],
    numbersLines: [
      {
        id: 'c4-num-1',
        parts: [
          {
            text: `Union Square and Palo Alto jumped +${treatedJumpPct.toFixed(1)}% ($${treatedBefore.toLocaleString('en-US')} to $${treatedAfter.toLocaleString('en-US')}), while already-stocked Walnut Creek and Pasadena jumped +${healthyJumpPct.toFixed(1)}% ($${healthyBefore.toLocaleString('en-US')} to $${healthyAfter.toLocaleString('en-US')}).`,
          },
        ],
      },
      {
        id: 'c4-num-2',
        parts: [
          {
            text: `Across 10 Sep – 27 Sep against each store's own expected range, stores that got stock sold `,
          },
          {
            fact: createFact(
              'judge:c4:treated_pct',
              'Stocked stores vs expected range',
              treatedRatioPct,
              'percent',
              'Union Square and Palo Alto actual sales divided by expected sales over 10 Sep – 27 Sep.',
            ),
          },
          { text: ' of expected, while held-back Santana Row fell to ' },
          {
            fact: createFact(
              'judge:c4:heldback_pct',
              'Santana Row vs expected range',
              holdoutRatioPct,
              'percent',
              'Santana Row actual sales divided by expected sales over 10 Sep – 27 Sep.',
            ),
          },
          {
            text: ` (${santanaDropPct.toFixed(1)}% in 21–27 Sep, selling only $${Math.round(srSep21_27.bsAct).toLocaleString('en-US')} of $${Math.round(srSep21_27.bsPot).toLocaleString('en-US')} Best-sellers demand).`,
          },
        ],
      },
      {
        id: 'c4-num-3',
        parts: [
          { text: 'Proven gain by 27 Sep: ' },
          {
            fact: createFact(
              'judge:c4:proven_gain',
              'Proven gain',
              Math.round(provenGainUsd),
              'USD',
              'Gain proven by comparing stores that got stock against Santana Row over 10 Sep – 27 Sep.',
            ),
          },
          { text: '. Cost of holding Santana Row back: ' },
          {
            fact: createFact(
              'judge:c4:heldback_cost',
              'Cost of holding Santana Row back',
              opsC1Loss.lossUsd,
              'USD',
              'Lost sales at Santana Row while held back for proof.',
            ),
          },
          { text: '. Later automatic Pasadena Knitwear move saved ' },
          {
            fact: createFact(
              'judge:c4:pas_saved',
              'Pasadena Knitwear saved later',
              pasadenaSavedUsd,
              'USD',
              'Lost Knitwear sales prevented later at Pasadena by acting automatically within your limits.',
            ),
          },
          { text: '.' },
        ],
      },
    ],
    hasDelaySlider: false,
    noSliderExplanation:
      'There is no delay slider here because proof is about knowing — not rushing. Without holding one store back, nobody can separate seasonal lift from a real fix, and Opscien would not earn trust to handle small transfers on its own.',
    opscienSummary: `Opscien held Santana Row back on 8 Sep, proved $${Math.round(provenGainUsd).toLocaleString('en-US')} of gain by 27 Sep (at a $${opsC1Loss.lossUsd.toLocaleString('en-US')} comparison cost), earned permission to act within small limits on 5 Oct, and automatically saved $${pasadenaSavedUsd.toLocaleString('en-US')} on Pasadena Knitwear later without bothering you.`,
    opscienExtraFacts: [
      createFact(
        'judge:ops:c4_proven',
        'Proven gain by 27 Sep',
        Math.round(provenGainUsd),
        'USD',
        'Gain proven against Santana Row held back.',
      ),
      createFact(
        'judge:ops:c4_pas',
        'Pasadena saved automatically later',
        pasadenaSavedUsd,
        'USD',
        'Saved automatically at Pasadena after earning autonomy.',
      ),
    ],
  };

  const worstTotalUsd = c1OptA.lossUsd + c2OptACost + unlinkedAll.lossUsd;
  const opscienTotalUsd = opsC1Loss.lossUsd + 0 + unlinkedIfSwitchSep30.lossUsd;

  const bundle: JudgeScenarioBundle = {
    seed,
    cases: [case1Spec, case2Spec, case3Spec, case4Spec],
    opscienTotalFact: createFact(
      'judge:ops:total',
      'Opscien total lost across these cases',
      opscienTotalUsd,
      'USD',
      `Sum of Opscien losses across Case 1 ($${opsC1Loss.lossUsd.toLocaleString('en-US')}), Case 2 ($0), and Case 3 ($${unlinkedIfSwitchSep30.lossUsd.toLocaleString('en-US')}).`,
    ),
    worstTotalFact: createFact(
      'judge:worst:total',
      'Worst choice total lost',
      worstTotalUsd,
      'USD',
      `Sum of worst choices across Case 1 ($${c1OptA.lossUsd.toLocaleString('en-US')}), Case 2 ($${c2OptACost.toLocaleString('en-US')}), and Case 3 ($${unlinkedAll.lossUsd.toLocaleString('en-US')}).`,
    ),
    baselineSim: sim0,
  };

  bundleCache.set(seed, bundle);
  return bundle;
}

export function evaluateCase1Delay(
  seed: number = DEFAULT_SEED,
  delayDays: number,
): JudgeDelayEvaluation {
  const clamped = Math.max(0, Math.min(28, Math.round(delayDays)));
  const cacheKey = `${seed}:${clamped}`;
  const cached = case1DelayCache.get(cacheKey);
  if (cached) return cached;

  const actDate = addDays('2026-09-21', clamped);
  const preSim = runSimulation(seed, [], actDate);
  const plan = buildTransferPlanForGroup({
    sim: preSim,
    date: actDate,
    groupId: 'best_sellers',
    disableHoldout: true,
  }).plan;
  const dec: ActionDecision = {
    id: `judge:c1:delay:${clamped}`,
    candidateId: 'situation:stock_running_out:best_sellers',
    date: actDate,
    kind: 'transfer',
    groupId: 'best_sellers',
    transferLines: plan.transferLines,
    totalUnits: plan.totalUnitsFact.value,
    arrivalDate: addDays(actDate, 2),
  };
  const postSim = runSimulation(seed, [dec], LIVE_END_DATE);
  const loss = sumBestSellersLossForStores(
    postSim,
    ['union_square', 'palo_alto', 'santana_row'],
    LIVE_END_DATE,
  );

  const res: JudgeDelayEvaluation = {
    delayValue: clamped,
    actDate,
    lossUsd: loss.lossUsd,
    lossFact: createFact(
      `judge:c1:delay_loss:${clamped}`,
      `Lost sales with ${clamped}-day delay`,
      loss.lossUsd,
      'USD',
      `Simulated Best-sellers sales lost when a ${plan.totalUnitsFact.formatted} transfer is approved on ${actDate} (${clamped} days after shelves run empty on 21 Sep).`,
    ),
    detailText: `Approving on ${formatShortDate(actDate)} sends ${plan.totalUnitsFact.formatted} (arrives ${formatShortDate(addDays(actDate, 2))}), after ${loss.emptyDays} empty shelf days.`,
  };
  case1DelayCache.set(cacheKey, res);
  return res;
}

export function evaluateCase3Delay(
  seed: number = DEFAULT_SEED,
  delayWeeks: number,
): JudgeDelayEvaluation {
  const clamped = Math.max(0, Math.min(6, Math.round(delayWeeks)));
  const cacheKey = `${seed}:${clamped}`;
  const cached = case3DelayCache.get(cacheKey);
  if (cached) return cached;

  const switchDate = addDays('2026-09-30', clamped * 7);
  const dec: ActionDecision = {
    id: `judge:c3:delay:${clamped}`,
    candidateId: 'situation:refunds_out_of_line:walnut_creek',
    date: switchDate,
    kind: 'refund_switch',
  };
  const postSim = runSimulation(seed, [dec], LIVE_END_DATE);
  const unl = sumUnlinkedCashRefunds(postSim, LIVE_START_DATE, LIVE_END_DATE);

  const res: JudgeDelayEvaluation = {
    delayValue: clamped,
    actDate: switchDate,
    lossUsd: unl.lossUsd,
    lossFact: createFact(
      `judge:c3:delay_loss:${clamped}`,
      `Refunds lost with ${clamped}-week delay`,
      unl.lossUsd,
      'USD',
      `Unlinked cash refunds lost at Walnut Creek from 1 Aug until the $50 approval switch starts on ${switchDate} (${clamped} weeks after 30 Sep).`,
    ),
    detailText: `Starting the $50 rule on ${formatShortDate(switchDate)} allows ${unl.count} unlinked cash refunds before the tap stops.`,
  };
  case3DelayCache.set(cacheKey, res);
  return res;
}
