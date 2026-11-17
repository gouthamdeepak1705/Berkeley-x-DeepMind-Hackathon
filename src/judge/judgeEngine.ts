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
  costLabel?: string;
  lossUsd: number;
  lossFact?: Fact;
  isCorrect?: boolean;
  resultSummary: string;
  emptyStoreLines?: string[];
  resultFacts: Fact[];
}

export interface JudgeTableRow {
  store: string;
  col1: string;
  col2: string;
  col3: string;
  col4?: string;
}

export interface JudgeNumbersTable {
  columns: string[];
  rows: JudgeTableRow[];
}

export interface JudgeNumbersLine {
  id: string;
  parts: Array<{ text?: string; fact?: Fact }>;
  table?: JudgeNumbersTable;
}

export interface JudgeCaseSpec {
  caseNumber: 1 | 2 | 3 | 4;
  date: string;
  dateFormatted: string;
  title: string;
  whatYouSeeLead?: string;
  whatYouSeeLines?: JudgeNumbersLine[];
  whatYouSeeColumns: string[];
  whatYouSeeRows: JudgeTableRow[];
  promptQuestion: string;
  options: [JudgeOption, JudgeOption, JudgeOption];
  optionsFootnote?: string;
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
    aboveSliderLines?: JudgeNumbersLine[];
    belowSliderLines?: JudgeNumbersLine[];
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

import { getIsoWeekKey } from '../engine/calendar';

const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function formatLongDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  void y;
  return `${d} ${FULL_MONTHS[(m ?? 1) - 1] ?? ''}`;
}

function format12HourTime(hhmm: string): string {
  const [hhRaw, mmRaw] = hhmm.split(':').map(Number);
  const hh = hhRaw ?? 0;
  const mm = String(mmRaw ?? 0).padStart(2, '0');
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm} ${suffix}`;
}

function makeCustomCountFact(
  id: string,
  label: string,
  value: number,
  formatted: string,
  note: string,
): Fact {
  return {
    id,
    label,
    value,
    formatted,
    unit: 'count',
    note,
  };
}

function summarizeEmptyStores(
  sim: SimulationRun,
  storeIds: StoreId[],
  upToDate: string = LIVE_END_DATE,
): { lines: string[]; firstEmptyDate: string | null } {
  const lines: string[] = [];
  let earliest: string | null = null;
  for (const sid of storeIds) {
    const emptyDates: string[] = [];
    for (const d of sim.liveDates) {
      if (d > upToDate) break;
      const r = sim.storeRecordsByDate[d]?.[sid];
      if (!r?.isOpen) continue;
      const g = r.groups.best_sellers;
      if (g.potentialSales - g.actualSales > 0.01) {
        emptyDates.push(d);
      }
    }
    if (emptyDates.length > 0) {
      const firstDate = emptyDates[0];
      if (!earliest || firstDate < earliest) earliest = firstDate;
      lines.push(
        `${STORE_MAP[sid].name}: empty from ${formatLongDate(firstDate)}, ${emptyDates.length} ${emptyDates.length === 1 ? 'day' : 'days'}`,
      );
    }
  }
  return { lines, firstEmptyDate: earliest };
}

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
  const letGoWeeks = new Set<string>();
  for (const d of simFull.liveDates) {
    const activeDecs = fullDecs.filter((dec) => dec.date <= d);
    const controlStores = new Set<string>();
    if (d >= decSep8.date && d < decRollout.date && decSep8.holdoutStoreId) {
      controlStores.add(decSep8.holdoutStoreId);
    }
    const rawCands = runDetectorsForDay(simFull, d);
    signalsChecked += rawCands.length;
    const weekKey = getIsoWeekKey(d);
    for (const raw of rawCands) {
      const checked = applySilenceChecks(raw, simFull, d, activeDecs, controlStores);
      if (checked.explainedBy) {
        letGoWeeks.add(`${raw.id}:${checked.explainedBy.check}:${weekKey}`);
      }
    }
  }
  return { signalsChecked, stayedQuiet: letGoWeeks.size };
}

export function getJudgeScenarioBundle(seed: number = DEFAULT_SEED): JudgeScenarioBundle {
  const cached = bundleCache.get(seed);
  if (cached) return cached;

  const sim0 = runSimulation(seed, [], LIVE_END_DATE);
  const shortStores: StoreId[] = ['union_square', 'palo_alto', 'santana_row'];

  const sep8Date = '2026-09-08';
  const sep8Recs = sim0.storeRecordsByDate[sep8Date];
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

  const nextDelBs = sim0.scheduledDeliveries
    .filter((d) => d.groupId === 'best_sellers' && d.date > sep8Date)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const daysToDel = diffDays(sep8Date, nextDelBs.date);

  // Case 1 Step 1 rates
  const estThisWeekSales = sim0.dates
    .filter((d) => d >= '2026-09-02' && d <= '2026-09-08')
    .reduce((s, d) => s + sim0.chainRecordsByDate[d].establishedActualSales, 0);
  const estPrior4WeekAvg =
    sim0.dates
      .filter((d) => d >= '2026-08-05' && d <= '2026-09-01')
      .reduce((s, d) => s + sim0.chainRecordsByDate[d].establishedActualSales, 0) / 4;
  const estWeekVsLast4Pct = Math.trunc(((estThisWeekSales / estPrior4WeekAvg) - 1) * 100);
  const allStoresLyPctSep8 = Math.round(sim0.chainRecordsByDate[sep8Date].allStores28dVsLastYearPct);

  // Option A: Leave it
  const c1OptA = sumBestSellersLossForStores(sim0, shortStores, LIVE_END_DATE);
  const c1OptAEmpty = summarizeEmptyStores(sim0, shortStores, LIVE_END_DATE);

  // Option B: Send 500 units to each of the three stores (Sacramento->Union Square, Santa Barbara->Palo Alto, Rockridge->Santana Row)
  const flatPerStore = 500;
  const flatPool = flatPerStore * shortStores.length;
  const dec1B: ActionDecision = {
    id: 'judge:c1:b',
    candidateId: 'situation:stock_running_out:best_sellers',
    date: sep8Date,
    kind: 'transfer',
    groupId: 'best_sellers',
    transferLines: [
      {
        fromStoreId: 'sacramento',
        fromStoreName: STORE_MAP.sacramento.name,
        toStoreId: 'union_square',
        toStoreName: STORE_MAP.union_square.name,
        groupId: 'best_sellers',
        units: flatPerStore,
      },
      {
        fromStoreId: 'santa_barbara',
        fromStoreName: STORE_MAP.santa_barbara.name,
        toStoreId: 'palo_alto',
        toStoreName: STORE_MAP.palo_alto.name,
        groupId: 'best_sellers',
        units: flatPerStore,
      },
      {
        fromStoreId: 'rockridge',
        fromStoreName: STORE_MAP.rockridge.name,
        toStoreId: 'santana_row',
        toStoreName: STORE_MAP.santana_row.name,
        groupId: 'best_sellers',
        units: flatPerStore,
      },
    ],
    totalUnits: flatPool,
    arrivalDate: addDays(sep8Date, 2),
  };
  const sim1B = runSimulation(seed, [dec1B], LIVE_END_DATE);
  const c1OptB = sumBestSellersLossForStores(sim1B, shortStores, LIVE_END_DATE);
  const c1OptBEmpty = summarizeEmptyStores(sim1B, shortStores, LIVE_END_DATE);

  // Option C: Do the sum from the report (9 weeks of trailing 28-day demand = 2,191 units)
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
  const c1OptCEmpty = summarizeEmptyStores(sim1C, shortStores, LIVE_END_DATE);

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

  // Case 1 "What the numbers say" computed metrics
  const unionRec = sep8Recs.union_square.groups.best_sellers;
  const paloRec = sep8Recs.palo_alto.groups.best_sellers;
  const santRec = sep8Recs.santana_row.groups.best_sellers;
  const wcRec = sep8Recs.walnut_creek.groups.best_sellers;

  const unionReportWeeklyPace = Math.round(unionRec.endingStock / (unionRec.weeksOfCover ?? 1));
  const unionAfterSep8WeeklyDemand = Math.round(
    sim0.dates
      .filter((d) => d >= '2026-09-09' && d <= '2026-10-06')
      .reduce((s, d) => s + sim0.storeRecordsByDate[d].union_square.groups.best_sellers.unitsDemanded, 0) /
      4,
  );
  const unionFirstEmpty = c1OptAEmpty.firstEmptyDate ?? '2026-09-21';
  const daysToFirstEmpty = diffDays(sep8Date, unionFirstEmpty);

  const demandSep9ToNov8 = (sid: StoreId) =>
    sim0.dates
      .filter((d) => d >= '2026-09-09' && d < nextDelBs.date)
      .reduce((s, d) => s + sim0.storeRecordsByDate[d][sid].groups.best_sellers.unitsDemanded, 0);

  const unionDemand61 = Math.round(demandSep9ToNov8('union_square'));
  const unionStockSep8 = Math.round(unionRec.endingStock);
  const paloShort61 = Math.round(demandSep9ToNov8('palo_alto') - paloRec.endingStock);
  const santShort61 = Math.round(demandSep9ToNov8('santana_row') - santRec.endingStock);
  const wcDemand61 = Math.round(demandSep9ToNov8('walnut_creek'));
  const wcStockSep8 = Math.round(wcRec.endingStock);
  const wcWeeksSep8 = wcRec.weeksOfCover ?? 0;

  const strictToUnion = strictPlan.transferLines
    .filter((l) => l.toStoreId === 'union_square')
    .reduce((s, l) => s + l.units, 0);
  const strictToPalo = strictPlan.transferLines
    .filter((l) => l.toStoreId === 'palo_alto')
    .reduce((s, l) => s + l.units, 0);
  const strictToSantana = strictPlan.transferLines
    .filter((l) => l.toStoreId === 'santana_row')
    .reduce((s, l) => s + l.units, 0);

  const sep21LyPct = Math.round(sim0.chainRecordsByDate[unionFirstEmpty].allStores28dVsLastYearPct);
  const sliderDay0Eval = evaluateCase1Delay(seed, 0);
  const sliderDay28Eval = evaluateCase1Delay(seed, 28);
  const extraDayAvgUsd = Math.round((sliderDay28Eval.lossUsd - sliderDay0Eval.lossUsd) / 28 / 100) * 100;

  const case1StoreOrder: StoreId[] = [
    'union_square',
    'palo_alto',
    'santana_row',
    'walnut_creek',
    'burlingame',
    'pasadena',
    'napa',
    'sacramento',
    'santa_barbara',
    'rockridge',
  ];

  const case1Spec: JudgeCaseSpec = {
    caseNumber: 1,
    date: sep8Date,
    dateFormatted: formatLongDate(sep8Date),
    title: 'The shelf that looked full',
    whatYouSeeLines: [
      {
        id: 'c1-see-1',
        parts: [
          { text: 'Summer is over. Sales at the eight older stores this week are up ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:see:est_lift',
              'Eight older stores weekly rise',
              estWeekVsLast4Pct,
              String(estWeekVsLast4Pct),
              'Sales across the 8 established stores over 2 Sep – 8 Sep vs their prior 4-week average (5 Aug – 1 Sep).',
            ),
          },
          { text: '% on the last four weeks.' },
        ],
      },
      {
        id: 'c1-see-2',
        parts: [
          { text: 'All stores against last year: up ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:see:all_ly',
              'All stores vs last year',
              allStoresLyPctSep8,
              String(allStoresLyPctSep8),
              'All-store sales over the 28 days ending 8 September vs matching days last year.',
            ),
          },
          { text: '%.' },
        ],
      },
      {
        id: 'c1-see-3',
        parts: [
          { text: 'The supplier of Best-sellers has paused deliveries. The next delivery is 9 November.' },
        ],
      },
    ],
    whatYouSeeColumns: ['Store', 'Stock on hand', 'Weekly pace', 'Stock left'],
    whatYouSeeRows: case1StoreOrder.map((sid) => {
      const rec = sep8Recs[sid].groups.best_sellers;
      const pace = rec.weeksOfCover ? Math.round(rec.endingStock / rec.weeksOfCover) : 0;
      return {
        store: STORE_MAP[sid].name,
        col1: `${Math.round(rec.endingStock).toLocaleString('en-US')} units`,
        col2: `${pace.toLocaleString('en-US')} units/wk`,
        col3: `${(rec.weeksOfCover ?? 0).toFixed(1)} wks`,
      };
    }),
    promptQuestion: 'What would you do this morning?',
    options: [
      {
        id: 'a',
        label: 'Leave it.',
        detail: 'Sales are strong and every store has stock.',
        lossUsd: c1OptA.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_a:loss',
          'Case 1 Option A lost sales',
          c1OptA.lossUsd,
          'USD',
          'Simulated Best-sellers sales lost across Union Square, Palo Alto, and Santana Row through 14 Nov with no transfer.',
        ),
        resultSummary: `All three stores run out before the ${formatLongDate(nextDelBs.date)} delivery arrives.`,
        emptyStoreLines: c1OptAEmpty.lines,
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
        label: `Send ${flatPerStore} units to each of the three stores.`,
        detail: `${flatPerStore} is more than double what they hold. That is plenty.`,
        lossUsd: c1OptB.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_b:loss',
          'Case 1 Option B lost sales',
          c1OptB.lossUsd,
          'USD',
          `Simulated Best-sellers sales lost after transferring ${flatPerStore} units to each of the three stores on 8 Sep (Sacramento to Union Square, Santa Barbara to Palo Alto, Rockridge to Santana Row).`,
        ),
        resultSummary: `Each store holds out longer, then empties before ${formatLongDate(nextDelBs.date)}.`,
        emptyStoreLines: c1OptBEmpty.lines,
        resultFacts: [
          createFact(
            'judge:c1:opt_b:empty_days',
            'Days still short',
            c1OptB.emptyDays,
            'days',
            'Days later in the season with at least one of the three stores holding zero Best-sellers stock.',
          ),
        ],
      },
      {
        id: 'c',
        label: `Do the sum from the report (${unitsC.toLocaleString('en-US')} units).`,
        detail: 'Nine weeks until the delivery, times weekly sales, minus what they hold.',
        lossUsd: c1OptC.lossUsd,
        lossFact: createFact(
          'judge:c1:opt_c:loss',
          'Case 1 Option C lost sales',
          c1OptC.lossUsd,
          'USD',
          `Simulated Best-sellers sales lost after transferring ${unitsC.toLocaleString('en-US')} units based on 9 weeks of August report pace.`,
        ),
        resultSummary: 'You did the arithmetic and still lost money, because the report gave a summer selling rate.',
        emptyStoreLines: c1OptCEmpty.lines,
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
            text: "The 'weekly pace' column was measured in August, the slowest month. After summer, Union Square sells ",
          },
          {
            fact: makeCustomCountFact(
              'judge:c1:us_autumn_wk',
              'Union Square post-summer weekly pace',
              unionAfterSep8WeeklyDemand,
              unionAfterSep8WeeklyDemand.toLocaleString('en-US'),
              'Average Best-sellers units customers asked for per week at Union Square over the 28 days after 8 September.',
            ),
          },
          { text: ' a week, not ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:us_aug_wk',
              'Union Square August weekly pace',
              unionReportWeeklyPace,
              unionReportWeeklyPace.toLocaleString('en-US'),
              'Union Square Best-sellers weekly sales pace shown on the 8 September report from trailing 28-day August sales.',
            ),
          },
          { text: '.' },
        ],
      },
      {
        id: 'c1-num-2',
        parts: [
          { text: 'Union Square has ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:us_days_left',
              'Days until Union Square empties',
              daysToFirstEmpty,
              String(daysToFirstEmpty),
              'Days from 8 September until Union Square Best-sellers shelves run dry on 21 September.',
            ),
          },
          { text: ' days of stock. The delivery is ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:del_days',
              'Days until next delivery',
              daysToDel,
              String(daysToDel),
              'Days from 8 September until the 9 November Best-sellers delivery.',
            ),
          },
          { text: ' days away.' },
        ],
      },
      {
        id: 'c1-num-3',
        parts: [
          { text: 'Before 9 November customers will ask Union Square for ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:us_dem61',
              'Union Square Best-sellers demand until 9 Nov',
              unionDemand61,
              unionDemand61.toLocaleString('en-US'),
              'Simulated Best-sellers units customers want at Union Square from 9 September through 8 November.',
            ),
          },
          { text: ' units. It has ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:us_stock',
              'Union Square Best-sellers stock on 8 Sep',
              unionStockSep8,
              unionStockSep8.toLocaleString('en-US'),
              'Ending Best-sellers stock at Union Square on 8 September.',
            ),
          },
          { text: '. Palo Alto is short by ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:pa_short',
              'Palo Alto Best-sellers gap until 9 Nov',
              paloShort61,
              paloShort61.toLocaleString('en-US'),
              'Simulated Best-sellers demand at Palo Alto from 9 Sep to 8 Nov minus ending stock on 8 Sep.',
            ),
          },
          { text: ', Santana Row by ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:sr_short',
              'Santana Row Best-sellers gap until 9 Nov',
              santShort61,
              santShort61.toLocaleString('en-US'),
              'Simulated Best-sellers demand at Santana Row from 9 Sep to 8 Nov minus ending stock on 8 Sep.',
            ),
          },
          { text: '.' },
        ],
      },
      {
        id: 'c1-num-4',
        parts: [
          { text: 'Walnut Creek shows ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:wc_wks',
              'Walnut Creek cover on 8 Sep',
              wcWeeksSep8,
              wcWeeksSep8.toFixed(1),
              'Walnut Creek weeks of Best-sellers cover on 8 September.',
            ),
          },
          { text: ' weeks, but it will sell ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:wc_dem61',
              'Walnut Creek demand before 9 Nov',
              wcDemand61,
              wcDemand61.toLocaleString('en-US'),
              'Simulated Best-sellers units Walnut Creek itself needs from 9 Sep to 8 Nov.',
            ),
          },
          { text: ' of its ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:wc_stock',
              'Walnut Creek stock on 8 Sep',
              wcStockSep8,
              wcStockSep8.toLocaleString('en-US'),
              'Ending Best-sellers stock at Walnut Creek on 8 September.',
            ),
          },
          { text: ' units itself. Only Sacramento, Santa Barbara and Rockridge have real spare stock.' },
        ],
      },
      {
        id: 'c1-num-5',
        parts: [
          { text: 'The right move is ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:zero_loss_units',
              'Units needed for zero loss',
              strictPlan.totalUnitsFact.value,
              strictPlan.totalUnitsFact.value.toLocaleString('en-US'),
              'Total Best-sellers units needed across Union Square, Palo Alto, and Santana Row on 8 Sep.',
            ),
          },
          { text: ' units: ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:move_us',
              'Units for Union Square',
              strictToUnion,
              strictToUnion.toLocaleString('en-US'),
              'Best-sellers units moved to Union Square from giving stores.',
            ),
          },
          { text: ' to Union Square, ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:move_pa',
              'Units for Palo Alto',
              strictToPalo,
              strictToPalo.toLocaleString('en-US'),
              'Best-sellers units moved to Palo Alto from giving stores.',
            ),
          },
          { text: ' to Palo Alto, ' },
          {
            fact: makeCustomCountFact(
              'judge:c1:move_sr',
              'Units for Santana Row',
              strictToSantana,
              strictToSantana.toLocaleString('en-US'),
              'Best-sellers units moved to Santana Row from giving stores.',
            ),
          },
          { text: ' to Santana Row. Result: nothing lost.' },
        ],
      },
    ],
    hasDelaySlider: true,
    delaySliderConfig: {
      min: 0,
      max: 28,
      step: 1,
      defaultValue: 7,
      unitSingular: 'day',
      unitPlural: 'days',
      label: 'Days after shelves run empty (starting 21 September) before you approve a full move',
      helperText:
        'Slide to see how much waiting costs once Union Square, Palo Alto, and Santana Row start running out.',
      aboveSliderLines: [
        {
          id: 'c1-slider-above',
          parts: [
            {
              text: `Nothing in the reports looks wrong until a shelf is empty. The first empty shelf is ${formatLongDate(unionFirstEmpty)}. On that day the headline still says all stores are up `,
            },
            {
              fact: makeCustomCountFact(
                'judge:c1:sep21_ly',
                'All stores vs last year on 21 Sep',
                sep21LyPct,
                String(sep21LyPct),
                'All-store sales over the 28 days ending 21 September vs prior year, buoyed by Burlingame and Napa openings.',
              ),
            },
            { text: '% on last year, because two new stores opened.' },
          ],
        },
      ],
      belowSliderLines: [
        {
          id: 'c1-slider-below-1',
          parts: [
            { text: 'Each extra day costs about ' },
            {
              fact: createFact(
                'judge:c1:extra_day_cost',
                'Cost of each extra day waiting',
                extraDayAvgUsd,
                'USD',
                'Average additional lost Best-sellers sales per extra day of waiting between 0 and 28 days after 21 September.',
              ),
            },
            { text: '.' },
          ],
        },
        {
          id: 'c1-slider-below-2',
          parts: [
            { text: 'Even an answer on the same day loses ' },
            {
              fact: createFact(
                'judge:c1:same_day_loss',
                'Loss even with same-day answer',
                sliderDay0Eval.lossUsd,
                'USD',
                'Sales lost while the transfer is in transit for two days after approving on 21 September.',
              ),
            },
            { text: ', because stock takes two days to travel.' },
          ],
        },
      ],
    },
    opscienSummary:
      `Opscien raised this on 8 September, ${daysToFirstEmpty} days before the first empty shelf. It moved ${opscienPlanSep8.totalUnitsFact.formatted} to Union Square and Palo Alto, and held Santana Row back to prove it worked. Once proven on 27 September, it sent ${opsRolloutPlan.totalUnitsFact.formatted} to Santana Row. No extra stock was bought.`,
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
    optionsFootnote:
      'This simulation has no price response. A real discount would also bring some extra sales. We count only the discount on sales that happened without it.',
    options: [
      {
        id: 'a',
        label: 'Run a 20% sale all week (10 Aug – 16 Aug)',
        detail: 'Cut shelf prices by 20% across all stores for seven days to pull shoppers back.',
        costLabel: 'Discount given on sales that were coming anyway',
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
        costLabel: 'Discount given on sales that were coming anyway',
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
    opscienSummary: `Opscien noticed the August dip, checked the trading calendar against prior-year August, and kept quiet. Over the full 106 days it checked ${workCounts.signalsChecked.toLocaleString('en-US')} signals and stayed quiet on ${workCounts.stayedQuiet}.`,
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
  const op14UsdSep30Fact = rbTool.facts.find((f) => f.id.includes('op14_usd'))!;
  const op14CountSep30Fact = rbTool.facts.find((f) => f.id.includes('op14_count'))!;

  // Step 1 rates: August all stores vs 15..30 Sep all stores, Walnut Creek, and other 9 stores
  let augAllSales = 0;
  let augAllRefunds = 0;
  let sep15_30AllSales = 0;
  let sep15_30AllRefunds = 0;
  let sep15_30WcSales = 0;
  let sep15_30WcRefunds = 0;
  let sep15_30OtherSales = 0;
  let sep15_30OtherRefunds = 0;
  for (const d of sim0.liveDates) {
    for (const st of STORES) {
      const r = sim0.storeRecordsByDate[d]?.[st.id];
      if (!r?.isOpen) continue;
      if (d >= '2026-08-01' && d <= '2026-08-31') {
        augAllSales += r.actualSales;
        augAllRefunds += r.refundAmount;
      }
      if (d >= '2026-09-15' && d <= sep30Date) {
        sep15_30AllSales += r.actualSales;
        sep15_30AllRefunds += r.refundAmount;
        if (st.id === 'walnut_creek') {
          sep15_30WcSales += r.actualSales;
          sep15_30WcRefunds += r.refundAmount;
        } else {
          sep15_30OtherSales += r.actualSales;
          sep15_30OtherRefunds += r.refundAmount;
        }
      }
    }
  }
  const allAugRatePct = augAllSales > 0 ? (augAllRefunds / augAllSales) * 100 : 0;
  const allSep15_30RatePct = sep15_30AllSales > 0 ? (sep15_30AllRefunds / sep15_30AllSales) * 100 : 0;
  const wcSep15_30RatePct = sep15_30WcSales > 0 ? (sep15_30WcRefunds / sep15_30WcSales) * 100 : 0;
  const otherSep15_30RatePct = sep15_30OtherSales > 0 ? (sep15_30OtherRefunds / sep15_30OtherSales) * 100 : 0;

  // All 15 Sep .. 14 Nov refunds (false vs honest)
  const unlinkedAll = sumUnlinkedCashRefunds(sim0, '2026-09-15', LIVE_END_DATE);
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

  const sep15ToNov14Weeks = (diffDays('2026-09-15', LIVE_END_DATE) + 1) / 7;
  const unlinkedWeeklyUsd = Math.round(unlinkedAll.lossUsd / sep15ToNov14Weeks);
  const unlinkedAnnualUsd = Math.round(((unlinkedAll.lossUsd / sep15ToNov14Weeks) * 52) / 1000) * 1000;

  let chainCash15SepTo14Nov = 0;
  for (const d of sim0.liveDates) {
    if (d < '2026-09-15' || d > LIVE_END_DATE) continue;
    for (const st of STORES) {
      const r = sim0.storeRecordsByDate[d]?.[st.id];
      if (r?.isOpen) chainCash15SepTo14Nov += r.cashRefundAmount;
    }
  }
  const chainHonestCashWeeklyUsd = Math.round(
    (chainCash15SepTo14Nov - unlinkedAll.lossUsd) / sep15ToNov14Weeks,
  );

  const honestWcRows = sim0.walnutCreekRefunds.filter(
    (r) => r.date >= '2026-09-15' && r.date <= LIVE_END_DATE && r.linkedOrder,
  );
  const honestWcCount = honestWcRows.length;
  const honestWcAvgUsd =
    honestWcCount > 0
      ? Math.round(honestWcRows.reduce((s, r) => s + r.amount, 0) / honestWcCount)
      : 0;
  const honestWcOver50Count = honestWcRows.filter((r) => r.amount > 50).length;
  const honestWcOver50PerWeek = Math.round(honestWcOver50Count / sep15ToNov14Weeks);

  const sampleUnlinked = sim0.walnutCreekRefunds
    .filter((r) => r.date <= sep30Date && !r.linkedOrder)
    .slice(-3);
  const sampleLinked = sim0.walnutCreekRefunds
    .filter((r) => r.date <= sep30Date && r.linkedOrder)
    .slice(-1);

  const case3SlipRows: JudgeTableRow[] = [
    ...sampleUnlinked.map((r) => ({
      store: `${formatShortDate(r.date)} · ${format12HourTime(r.time)}`,
      col1: `Cash · Till ${r.till} (Staff ${r.operatorNumber})`,
      col2: 'None on file',
      col3: `$${Math.round(r.amount)}`,
    })),
    ...sampleLinked.map((r) => ({
      store: `${formatShortDate(r.date)} · ${format12HourTime(r.time)}`,
      col1: `${r.method === 'card' ? 'Card' : 'Cash'} · Till ${r.till} (Staff ${r.operatorNumber})`,
      col2: 'Linked sale receipt',
      col3: `$${Math.round(r.amount)}`,
    })),
  ];

  const case3Spec: JudgeCaseSpec = {
    caseNumber: 3,
    date: sep30Date,
    dateFormatted: formatLongDate(sep30Date),
    title: 'The leak nobody was looking for',
    whatYouSeeLines: [
      {
        id: 'c3-see-1',
        parts: [
          { text: 'Refunds across all stores are ' },
          {
            fact: createFact(
              'judge:c3:see:all_sep',
              'All-store refund rate (15–30 Sep)',
              allSep15_30RatePct,
              'share_percent',
              'Total refunds divided by total sales across all open stores from 15 Sep to 30 Sep.',
            ),
          },
          { text: ' of sales. In August they were ' },
          {
            fact: createFact(
              'judge:c3:see:all_aug',
              'All-store refund rate in August',
              allAugRatePct,
              'share_percent',
              'Total refunds divided by total sales across all open stores from 1 Aug to 31 Aug.',
            ),
          },
          { text: '.' },
        ],
      },
      {
        id: 'c3-see-2',
        parts: [
          { text: 'By store: Walnut Creek ' },
          {
            fact: createFact(
              'judge:c3:see:wc',
              'Walnut Creek refund rate (15–30 Sep)',
              wcSep15_30RatePct,
              'share_percent',
              'Walnut Creek refunds divided by sales from 15 Sep to 30 Sep.',
            ),
          },
          { text: '. The other nine stores ' },
          {
            fact: createFact(
              'judge:c3:see:other9',
              'Other nine stores refund rate (15–30 Sep)',
              otherSep15_30RatePct,
              'share_percent',
              'Combined refunds divided by combined sales at the other nine stores from 15 Sep to 30 Sep.',
            ),
          },
          { text: '.' },
        ],
      },
    ],
    whatYouSeeColumns: [],
    whatYouSeeRows: [],
    promptQuestion: 'What would you do this morning?',
    options: [
      {
        id: 'a',
        label: 'Leave it.',
        detail: 'Refunds are a cost of doing business.',
        lossUsd: unlinkedAll.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_a:loss',
          'Case 3 Option A unlinked cash refunds',
          unlinkedAll.lossUsd,
          'USD',
          `${unlinkedAll.count} unlinked cash refunds at Walnut Creek from 15 Sep through 14 Nov.`,
        ),
        resultSummary: `$${unlinkedAll.lossUsd.toLocaleString('en-US')} by 14 November ($${unlinkedWeeklyUsd.toLocaleString('en-US')} a week on average), about $${unlinkedAnnualUsd.toLocaleString('en-US')} a year at that rate.`,
        resultFacts: [
          createFact(
            'judge:c3:opt_a:weekly',
            'Average per week',
            unlinkedWeeklyUsd,
            'USD',
            'Average weekly unlinked cash refunds from 15 Sep through 14 Nov.',
          ),
          createFact(
            'judge:c3:opt_a:annual',
            'Annualized rate',
            unlinkedAnnualUsd,
            'USD',
            'Weekly average multiplied by 52 weeks, rounded to nearest thousand.',
          ),
        ],
      },
      {
        id: 'b',
        label: 'Stop cash refunds in all ten stores.',
        detail: 'Close the door completely.',
        lossUsd: unlinkedIfSwitchSep30.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_b:loss',
          'Case 3 Option B lost before switch',
          unlinkedIfSwitchSep30.lossUsd,
          'USD',
          'Unlinked cash refunds lost before 30 Sep; future cash refunds stopped completely across all 10 stores.',
        ),
        resultSummary: `Honest customers are refused about $${chainHonestCashWeeklyUsd.toLocaleString('en-US')} of cash refunds a week across the chain.`,
        resultFacts: [
          createFact(
            'judge:c3:opt_b:honest_cash_wk',
            'Honest cash refunds refused per week',
            chainHonestCashWeeklyUsd,
            'USD',
            'All cash refunds across all open stores from 15 Sep to 14 Nov minus false refunds, averaged per week.',
          ),
        ],
      },
      {
        id: 'c',
        label: 'Every refund over $50 needs the manager.',
        detail: 'Put a check on all of them.',
        lossUsd: unlinkedIfSwitchSep30.lossUsd,
        lossFact: createFact(
          'judge:c3:opt_c:loss',
          'Case 3 Option C lost before switch',
          unlinkedIfSwitchSep30.lossUsd,
          'USD',
          'Unlinked cash refunds lost before 30 Sep; future refunds over $50 require manager approval.',
        ),
        resultSummary: `At Walnut Creek alone the manager is called for ${honestWcOver50Count} honest refunds in two months, about ${honestWcOver50PerWeek} a week.`,
        resultFacts: [
          makeCustomCountFact(
            'judge:c3:opt_c:honest_over50',
            'Honest refunds stopped for check',
            honestWcOver50Count,
            String(honestWcOver50Count),
            'Linked normal Walnut Creek refunds over $50 between 15 Sep and 14 Nov.',
          ),
          makeCustomCountFact(
            'judge:c3:opt_c:per_week',
            'Manager checks per week',
            honestWcOver50PerWeek,
            String(honestWcOver50PerWeek),
            'Weekly average of honest Walnut Creek refunds over $50 requiring manager override.',
          ),
        ],
      },
    ],
    numbersLines: [
      {
        id: 'c3-num-1',
        parts: [
          { text: 'There are ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:false_count',
              'False refunds',
              unlinkedAll.count,
              String(unlinkedAll.count),
              'Unlinked cash refunds at Walnut Creek from 15 September through 14 November.',
            ),
          },
          { text: ' false refunds. All of them share five facts: cash, no order attached, till ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:till',
              'Till number',
              2,
              '2',
              'Every unlinked cash refund occurred on Till 2 at Walnut Creek.',
            ),
          },
          { text: ', operator ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:op',
              'Operator number',
              14,
              '14',
              'Every unlinked cash refund was processed under operator 14.',
            ),
          },
          {
            text: `, between ${format12HourTime(unlinkedAll.minTime)} and ${format12HourTime(unlinkedAll.maxTime)}. Each is between `,
          },
          {
            fact: createFact(
              'judge:c3:amt_min',
              'Smallest unlinked cash refund',
              unlinkedAll.minAmt,
              'USD',
              'Smallest unlinked cash refund at Walnut Creek across 15 September – 14 November.',
            ),
          },
          { text: ' and ' },
          {
            fact: createFact(
              'judge:c3:amt_max',
              'Largest unlinked cash refund',
              unlinkedAll.maxAmt,
              'USD',
              'Largest unlinked cash refund at Walnut Creek across 15 September – 14 November.',
            ),
          },
          { text: '.' },
        ],
        table: {
          columns: ['Date & time', 'Method & till', 'Matching order', 'Amount'],
          rows: case3SlipRows,
        },
      },
      {
        id: 'c3-num-2',
        parts: [
          { text: 'Honest refunds at the same store in the same weeks: ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:honest_cnt',
              'Honest refunds at Walnut Creek',
              honestWcCount,
              String(honestWcCount),
              'Linked normal refunds at Walnut Creek from 15 September through 14 November.',
            ),
          },
          { text: ', average ' },
          {
            fact: createFact(
              'judge:c3:honest_avg',
              'Average honest refund',
              honestWcAvgUsd,
              'USD',
              'Mean dollar amount of linked normal refunds at Walnut Creek across 15 September – 14 November.',
            ),
          },
          { text: ', every one attached to an order.' },
        ],
      },
      {
        id: 'c3-num-3',
        parts: [
          {
            text: 'The narrow rule: a cash refund over $50 with no order attached needs the manager. It stops ',
          },
          {
            fact: makeCustomCountFact(
              'judge:c3:narrow_false',
              'False refunds stopped',
              unlinkedAll.count,
              String(unlinkedAll.count),
              'All unlinked cash refunds over $50 are blocked without manager approval.',
            ),
          },
          { text: ' of ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:narrow_false_tot',
              'Total false refunds',
              unlinkedAll.count,
              String(unlinkedAll.count),
              'Total false unlinked cash refunds across 15 September – 14 November.',
            ),
          },
          { text: ' false refunds and ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:narrow_honest',
              'Honest refunds interrupted',
              0,
              '0',
              'Every honest refund has a matching order attached, so zero honest refunds are interrupted.',
            ),
          },
          { text: ' of ' },
          {
            fact: makeCustomCountFact(
              'judge:c3:narrow_honest_tot',
              'Total honest refunds',
              honestWcCount,
              String(honestWcCount),
              'Total honest order-linked refunds at Walnut Creek across 15 September – 14 November.',
            ),
          },
          { text: ' honest ones.' },
        ],
      },
      {
        id: 'c3-num-4',
        parts: [
          {
            text: 'The till has no screen for that rule. Somebody has to build one. Opscien built the Refund exceptions desk the same day.',
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
      label: 'Weeks before you turn on the $50 manager approval rule (after 30 September)',
      helperText:
        'Slide to see how fast unlinked late-evening cash refunds pile up while a question waits in a queue.',
    },
    opscienSummary:
      `The refunds began on 15 September. Opscien needed 15 days of evidence. On 30 September it named the pattern, built the tool, and the loss stopped at $${unlinkedIfSwitchSep30.lossUsd.toLocaleString('en-US')}.`,
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
    dateFormatted: formatLongDate(sep27Date),
    title: 'Did the Best-sellers transfer cause the sales jump?',
    whatYouSeeLead:
      'Two weeks after the 8 September stock arrival (10 September – 23 September), sales rose at Union Square and Palo Alto.',
    whatYouSeeColumns: ['Store pair', '25 Aug – 7 Sep', '10 Sep – 23 Sep', 'Change'],
    whatYouSeeRows: [
      {
        store: 'Union Square & Palo Alto (got Best-sellers)',
        col1: `$${treatedBefore.toLocaleString('en-US')}`,
        col2: `$${treatedAfter.toLocaleString('en-US')}`,
        col3: `+${treatedJumpPct.toFixed(1)}%`,
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
        table: {
          columns: ['Store pair', '25 Aug – 7 Sep', '10 Sep – 23 Sep', 'Change'],
          rows: [
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
        },
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
