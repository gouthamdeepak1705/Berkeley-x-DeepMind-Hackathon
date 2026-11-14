import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { STORE_MAP } from '../engine/stores';
import {
  callInteractionRaw,
  formatGeminiError,
  getUnavailableModelReason,
  InteractionStep,
  isGeminiCallBlocked,
  isModelUnavailableError,
  recordGeminiCall,
} from '../gemini/client';
import {
  resolveTextPlaceholdersWithFallback,
  sanitizeSegmentsWithFallback,
  validateAndResolvePlaceholders,
} from '../gemini/placeholders';
import { GEMINI_SETTINGS, GeminiJobKey } from '../gemini/settings';
import {
  Fact,
  InvestigationOption,
  InvestigationOutcomeKind,
  InvestigationResult,
  InvestigationRuledOut,
  InvestigationToolTrace,
  RaisedItem,
  TextSegment,
} from '../types/domain';
import { runSecondCheck } from './secondCheck';
import { CHECKER_TOOL_DECLARATIONS, executeCheckerTool } from './tools';
import { buildTransferPlanForGroup } from './transferPlan';

export interface InvestigationStreamEvent {
  type: 'started' | 'tool_call' | 'tool_result' | 'structured' | 'done';
  message: string;
  toolTrace?: InvestigationToolTrace;
  result?: InvestigationResult;
}

interface StructuredInvestigationPayload {
  confirmed: 'yes' | 'no' | 'unclear';
  causes: Array<{ summary: string; fact_ids: string[] }>;
  ruled_out: Array<{
    kind: 'calendar' | 'store_mix' | 'data_fault';
    ruled_out: boolean;
    summary: string;
    fact_id: string;
  }>;
  options: Array<{
    id: string;
    label: string;
    is_do_nothing: boolean;
    description: string;
    weekly_effect_fact_id: string;
  }>;
  outcome_kind: InvestigationOutcomeKind;
  outcome_detail: string;
  finding_template: string;
  cause_template: string;
  proposal_template: string;
}

const INVESTIGATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    confirmed: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    causes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          fact_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary', 'fact_ids'],
      },
    },
    ruled_out: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['calendar', 'store_mix', 'data_fault'] },
          ruled_out: { type: 'boolean' },
          summary: { type: 'string' },
          fact_id: { type: 'string' },
        },
        required: ['kind', 'ruled_out', 'summary', 'fact_id'],
      },
    },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          is_do_nothing: { type: 'boolean' },
          description: { type: 'string' },
          weekly_effect_fact_id: { type: 'string' },
        },
        required: ['id', 'label', 'is_do_nothing', 'description', 'weekly_effect_fact_id'],
      },
    },
    outcome_kind: {
      type: 'string',
      enum: ['nothing_to_do', 'recommendation', 'person_decision', 'tool_to_build', 'start_recording'],
    },
    outcome_detail: { type: 'string' },
    finding_template: { type: 'string' },
    cause_template: { type: 'string' },
    proposal_template: { type: 'string' },
  },
  required: [
    'confirmed',
    'causes',
    'ruled_out',
    'options',
    'outcome_kind',
    'outcome_detail',
    'finding_template',
    'cause_template',
    'proposal_template',
  ],
};

function selectInvestigationJob(
  situation: RaisedItem,
  sim: SimulationRun,
  date: string,
  controlStores?: Set<string>,
  dismissedStores?: Set<string>,
): 'investigate_large' | 'investigate_routine' {
  if (situation.detectorKind === 'stock_running_out' && (!situation.stores || situation.stores.length <= 1)) {
    const grpId = situation.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
    const { plan } = buildTransferPlanForGroup({
      sim,
      date,
      groupId: grpId,
      controlStores,
      dismissedStores,
    });
    if (
      plan.receiverStoreIds.length <= 1 &&
      !plan.holdoutStoreId &&
      plan.totalUnitsFact.value > 0 &&
      plan.totalUnitsFact.value < 500
    ) {
      return 'investigate_routine';
    }
  }
  if (
    situation.stakePerWeek.value >= GEMINI_SETTINGS.watcherThresholds.largeSituationStakeThresholdUsd ||
    situation.detectorKind === 'lfl_break' ||
    (situation.stores && situation.stores.length > 1)
  ) {
    return 'investigate_large';
  }
  return 'investigate_routine';
}

function seedFactsFromSituation(situation: RaisedItem): Record<string, Fact> {
  const map: Record<string, Fact> = {};
  const add = (f?: Fact) => {
    if (f) map[f.id] = { ...f };
  };
  add(situation.expected);
  add(situation.actual);
  add(situation.stakePerWeek);
  add(situation.todayExpected);
  add(situation.todayActual);
  add(situation.todayStakePerWeek);
  for (const st of situation.stores ?? []) {
    add(st.initialExpected);
    add(st.initialActual);
    add(st.initialStakePerWeek);
    add(st.todayExpected);
    add(st.todayActual);
    add(st.todayStakePerWeek);
  }
  for (const ev of situation.evidence ?? []) {
    add(ev.expected);
    add(ev.actual);
    add(ev.stakePerWeek);
    add(ev.todayExpected);
    add(ev.todayActual);
    add(ev.todayStakePerWeek);
  }
  return map;
}

function buildCodeFallbackInvestigation(
  situation: RaisedItem,
  sim: SimulationRun,
  date: string,
  existingFacts: Record<string, Fact>,
  existingTrace: InvestigationToolTrace[],
  modelUsed: string,
  mode: 'live' | 'replayed' | 'fallback',
  latencyMs: number,
  usedFallbackWording: boolean,
): InvestigationResult {
  const factsById: Record<string, Fact> = { ...existingFacts };
  const trace = [...existingTrace];

  const ensureTool = (toolName: string, args: Record<string, unknown>, round: number) => {
    if (!trace.some((t) => t.toolName === toolName)) {
      const res = executeCheckerTool(toolName, args, sim, date, situation);
      for (const f of res.facts) factsById[f.id] = f;
      trace.push({
        round,
        toolName,
        argsSummary: res.argsSummary,
        factIds: res.facts.map((f) => f.id),
        facts: res.facts,
      });
    }
  };

  let nextRound = trace.length + 1;
  ensureTool('test_calendar_for_period', { window_days: 28 }, nextRound++);
  ensureTool('test_store_mix', { window_days: 28 }, nextRound++);
  ensureTool('test_data_fault', { window_days: 28 }, nextRound++);

  if (situation.detectorKind === 'stock_running_out') {
    const grp = situation.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
    ensureTool('get_stock_cover_by_store_and_group', { group_id: grp }, nextRound++);
    ensureTool('get_lost_sales', { group_id: grp }, nextRound++);
  } else if (situation.detectorKind === 'refunds_out_of_line') {
    const targetStoreId = situation.stores?.[0]?.storeId ?? 'walnut_creek';
    ensureTool(
      'compare_store_with_established',
      { store_id: targetStoreId, metric: 'refund_rate', window_days: 28 },
      nextRound++,
    );
    ensureTool(
      'get_refund_breakdown',
      { store_id: targetStoreId, window_days: 28 },
      nextRound++,
    );
  }

  const ruledOut = buildRuledOutSentences(factsById);

  const isStock = situation.detectorKind === 'stock_running_out';
  const isRefunds = situation.detectorKind === 'refunds_out_of_line';
  const grp = situation.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';

  const doNothingFact =
    Object.values(factsById).find((f) => f.id.startsWith('tool:option:do_nothing:')) ??
    createFact(
      `fallback:do_nothing:${situation.candidateId}:${date}`,
      'Do nothing weekly effect',
      -situation.stakePerWeek.value,
      'USD',
      'Estimated weekly exposure if no action is taken.',
    );
  factsById[doNothingFact.id] = doNothingFact;

  let findingSegments: TextSegment[];
  let causeSegments: TextSegment[];
  let proposalSegments: TextSegment[];
  let options: InvestigationOption[];
  let outcomeKind: InvestigationOutcomeKind;
  let outcomeDetail: string;

  if (isStock) {
    const surplusFact = Object.values(factsById).find((f) =>
      f.id.startsWith(`tool:stock:donor_surplus:${grp}:`),
    );
    const transferFact =
      Object.values(factsById).find((f) => f.id.startsWith(`tool:option:transfer:${grp}:`)) ??
      createFact(
        `fallback:transfer:${grp}:${date}`,
        'Rebalance donor surplus weekly effect',
        situation.stakePerWeek.value * 0.85,
        'USD',
        'Estimated weekly demand protected by transferring idle donor stock.',
      );
    factsById[transferFact.id] = transferFact;

    const storeNames = (situation.stores ?? []).map((s) => s.storeName).join(', ') || 'affected stores';
    findingSegments = [
      {
        type: 'text',
        text: `${grp === 'best_sellers' ? 'Best-sellers' : 'Knitwear'} cover at ${storeNames} fell to `,
      },
      { type: 'fact', fact: situation.actual },
      { type: 'text', text: ', risking ' },
      { type: 'fact', fact: situation.stakePerWeek },
      { type: 'text', text: '/wk.' },
    ];
    causeSegments = surplusFact && surplusFact.value > 0
      ? [
          { type: 'text', text: 'Supplier delivery is delayed while ' },
          { type: 'fact', fact: surplusFact },
          { type: 'text', text: ' of spare stock sit at donor stores.' },
        ]
      : [
          { type: 'text', text: 'Cover fell below the ' },
          { type: 'fact', fact: situation.expected },
          { type: 'text', text: ' safety floor with no delivery near.' },
        ];
    proposalSegments = [
      {
        type: 'text',
        text:
          surplusFact && surplusFact.value > 0
            ? 'Transfer spare donor stock to protect '
            : 'Reallocate available units to protect ',
      },
      { type: 'fact', fact: transferFact },
      { type: 'text', text: '/wk.' },
    ];
    options = [
      {
        id: 'rebalance_transfer',
        label: surplusFact && surplusFact.value > 0 ? 'Transfer surplus from donor stores' : 'Prepare emergency stock reallocation',
        isDoNothing: false,
        description: 'Move excess inventory above each donor store safety floor to the short stores.',
        weeklyEffectFact: transferFact,
      },
      {
        id: 'do_nothing',
        label: 'Do nothing',
        isDoNothing: true,
        description: 'Wait for the scheduled delivery while losing demand at out-of-stock locations.',
        weeklyEffectFact: doNothingFact,
      },
    ];
    outcomeKind = 'recommendation';
    outcomeDetail = 'Recommend inter-store stock transfer respecting the donor 8-week and approval rules.';
  } else if (isRefunds) {
    const excessFact =
      Object.values(factsById).find((f) => f.id.includes('refund_bd:weekly_excess') || f.id.includes('excess_refunds_wk')) ??
      situation.stakePerWeek;
    const op14UsdFact =
      Object.values(factsById).find((f) => f.id.includes('refund_bd:op14_usd')) ??
      excessFact;
    const op14CountFact = Object.values(factsById).find((f) => f.id.includes('refund_bd:op14_count'));
    const storeName = situation.stores?.[0]?.storeName ?? 'Walnut Creek';
    const saveFact = createFact(
      `fallback:refund_desk:${date}`,
      'Refund exceptions desk & approval switch recovery',
      excessFact.value,
      'USD',
      'Weekly excess refund exposure addressed by reviewing flagged till receipts and requiring approval above $50.',
    );
    factsById[saveFact.id] = saveFact;

    findingSegments = [
      { type: 'text', text: `${storeName} refund rate climbed to ` },
      { type: 'fact', fact: situation.actual },
      { type: 'text', text: ' versus the other-store rate of ' },
      { type: 'fact', fact: situation.expected },
      { type: 'text', text: '.' },
    ];
    causeSegments = op14CountFact
      ? [
          { type: 'fact', fact: op14CountFact },
          { type: 'text', text: ' unlinked cash refunds after eight pm on Till two, operator fourteen, total ' },
          { type: 'fact', fact: op14UsdFact },
          { type: 'text', text: '.' },
        ]
      : [
          { type: 'text', text: 'Unlinked cash refunds after eight pm on Till two, operator fourteen, drove ' },
          { type: 'fact', fact: excessFact },
          { type: 'text', text: ' weekly excess.' },
        ];
    proposalSegments = [
      { type: 'text', text: 'Build a refund exceptions desk and require manager approval for large cash refunds, protecting ' },
      { type: 'fact', fact: saveFact },
      { type: 'text', text: '/wk.' },
    ];
    options = [
      {
        id: 'build_refund_desk',
        label: 'Build a refund exceptions desk',
        isDoNothing: false,
        description:
          'Write a focused desk for the finance lead showing 35 days of Walnut Creek refunds, flagged Till 2 evening cash entries, and an approval switch.',
        weeklyEffectFact: saveFact,
      },
      {
        id: 'ask_store_manager',
        label: 'Ask the store manager',
        isDoNothing: false,
        description:
          'Send a question to the Walnut Creek store manager asking for an explanation of the cash refunds on Till 2 after 8 pm (due in 3 days).',
        weeklyEffectFact: saveFact,
      },
      {
        id: 'do_nothing',
        label: 'Do nothing',
        isDoNothing: true,
        description: 'Leave refund controls unchanged and continue accepting the elevated cash refund rate.',
        weeklyEffectFact: doNothingFact,
      },
    ];
    outcomeKind = 'tool_to_build';
    outcomeDetail =
      'Tool to build: write a Refund exceptions desk for the finance lead, and optionally ask the store manager about Till 2 cash refunds after 8 pm.';
  } else {
    findingSegments = [
      { type: 'text', text: `${situation.title}: actual ` },
      { type: 'fact', fact: situation.actual },
      { type: 'text', text: ' versus expected ' },
      { type: 'fact', fact: situation.expected },
      { type: 'text', text: '.' },
    ];
    causeSegments = [
      { type: 'text', text: 'Calendar, store mix, and data faults were ruled out across ' },
      { type: 'fact', fact: situation.stakePerWeek },
      { type: 'text', text: ' per week in exposure.' },
    ];
    proposalSegments = [
      { type: 'text', text: 'Keep monitoring with ' },
      { type: 'fact', fact: doNothingFact },
      { type: 'text', text: ' weekly exposure if left unchanged.' },
    ];
    options = [
      {
        id: 'investigate_further',
        label: 'Review store operations',
        isDoNothing: false,
        description: 'Inspect local store operations for causes not explained by calendar or stock.',
        weeklyEffectFact: situation.stakePerWeek,
      },
      {
        id: 'do_nothing',
        label: 'Do nothing',
        isDoNothing: true,
        description: 'Continue normal trading without intervention.',
        weeklyEffectFact: doNothingFact,
      },
    ];
    outcomeKind = 'recommendation';
    outcomeDetail = 'Operational review recommended.';
  }

  return {
    candidateId: situation.candidateId,
    status: 'confirmed',
    confirmed: 'yes',
    findingSegments,
    causeSegments,
    proposalSegments,
    causes: [
      {
        summary: causeSegments.map((s) => (s.type === 'text' ? s.text : s.fact.formatted)).join(''),
        factIds: causeSegments.filter((s) => s.type === 'fact').map((s) => s.fact.id),
        facts: causeSegments.filter((s) => s.type === 'fact').map((s) => s.fact),
      },
    ],
    ruledOut,
    options,
    outcomeKind,
    outcomeDetail,
    model: modelUsed,
    mode,
    latencyMs,
    usedFallbackWording,
    toolTrace: trace,
    factsById,
  };
}

function buildRuledOutSentences(factsById: Record<string, Fact>): InvestigationRuledOut[] {
  const calFact = Object.values(factsById).find((f) => f.id.startsWith('tool:calendar:'));
  const estMixFact = Object.values(factsById).find((f) => f.id.startsWith('tool:mix:est_yoy:'));
  const newMixFact = Object.values(factsById).find((f) => f.id.startsWith('tool:mix:new_stores_sales:'));
  const faultFact = Object.values(factsById).find((f) => f.id.startsWith('tool:data_fault:'));

  const calSegments: TextSegment[] = calFact
    ? calFact.value === 0
      ? [
          { type: 'text', text: 'Calendar: no event or season change explains this week (' },
          { type: 'fact', fact: calFact },
          { type: 'text', text: ' shifts).' },
        ]
      : [
          { type: 'text', text: 'Calendar: expectations already adjust for active calendar shifts (' },
          { type: 'fact', fact: calFact },
          { type: 'text', text: ' overlapping).' },
        ]
    : [{ type: 'text', text: 'Calendar: no event or season change explains this week.' }];

  const mixFactToUse = estMixFact ?? newMixFact;
  const mixSegments: TextSegment[] = estMixFact
    ? estMixFact.value >= 0
      ? [
          { type: 'text', text: 'Store mix: established stores alone are up (' },
          { type: 'fact', fact: estMixFact },
          { type: 'text', text: '), so new stores are not the cause.' },
        ]
      : [
          { type: 'text', text: 'Store mix: established stores alone are down (' },
          { type: 'fact', fact: estMixFact },
          { type: 'text', text: '), not a new-store mix artifact.' },
        ]
    : newMixFact
      ? [
          { type: 'text', text: 'Store mix: new stores added ' },
          { type: 'fact', fact: newMixFact },
          { type: 'text', text: ', so they do not explain this issue.' },
        ]
      : [{ type: 'text', text: 'Store mix: new stores do not explain this issue.' }];

  const faultSegments: TextSegment[] = faultFact
    ? [
        { type: 'text', text: 'Data fault: no missing or repeated days (' },
        { type: 'fact', fact: faultFact },
        { type: 'text', text: ' anomalies found).' },
      ]
    : [{ type: 'text', text: 'Data fault: no missing or repeated days.' }];

  const toText = (segs: TextSegment[]) =>
    segs.map((s) => (s.type === 'text' ? s.text : s.fact.formatted)).join('');

  return [
    {
      kind: 'calendar',
      label: 'Calendar',
      ruledOut: true,
      summary: toText(calSegments),
      summarySegments: calSegments,
      fact: calFact,
    },
    {
      kind: 'store_mix',
      label: 'Store mix',
      ruledOut: true,
      summary: toText(mixSegments),
      summarySegments: mixSegments,
      fact: mixFactToUse,
    },
    {
      kind: 'data_fault',
      label: 'Data fault',
      ruledOut: true,
      summary: toText(faultSegments),
      summarySegments: faultSegments,
      fact: faultFact,
    },
  ];
}

export async function runSituationInvestigation(params: {
  situation: RaisedItem;
  sim: SimulationRun;
  date: string;
  controlStores?: Set<string>;
  dismissedStores?: Set<string>;
  bypassCache?: boolean;
  onEvent?: (ev: InvestigationStreamEvent) => void;
}): Promise<InvestigationResult> {
  const {
    situation,
    sim,
    date,
    controlStores = new Set(),
    dismissedStores,
    bypassCache = false,
    onEvent,
  } = params;
  const jobKey = selectInvestigationJob(situation, sim, date, controlStores, dismissedStores);
  const cfg = GEMINI_SETTINGS.jobs[jobKey];
  const factsById = seedFactsFromSituation(situation);
  const startAll = Date.now();

  onEvent?.({
    type: 'started',
    message: `Noticed: ${situation.title}. Checking now.`,
  });

  const transferPlanResult =
    situation.detectorKind === 'stock_running_out'
      ? buildTransferPlanForGroup({
          sim,
          date,
          groupId: situation.groupId === 'knitwear' ? 'knitwear' : 'best_sellers',
          controlStores,
          dismissedStores,
        })
      : null;
  if (transferPlanResult) {
    for (const f of transferPlanResult.facts) {
      factsById[f.id] = f;
    }
  }

  const runSecondCheckStep = async () => {
    onEvent?.({
      type: 'tool_call',
      message: 'Running second check in Python (code execution)...',
    });
    return runSecondCheck({
      situation,
      sim,
      date,
      firstValueFact: situation.stakePerWeek,
      bypassCache,
    });
  };

  const blockReason = isGeminiCallBlocked(cfg.capBucket);
  if (blockReason) {
    recordGeminiCall({
      feature: `checker:${situation.candidateId}`,
      job: jobKey,
      model: 'code',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: blockReason,
    });
    const secondCheck = await runSecondCheckStep();
    const fallback = buildCodeFallbackInvestigation(
      situation,
      sim,
      date,
      factsById,
      [],
      'code (fallback, Gemini not used)',
      'fallback',
      0,
      true,
    );
    fallback.secondCheck = secondCheck;
    fallback.transferPlan = transferPlanResult?.plan;
    fallback.jobKey = jobKey;
    onEvent?.({ type: 'done', message: 'Fallback investigation ready.', result: fallback });
    return fallback;
  }

  const evidenceNote = (situation.evidence ?? [])
    .map((ev) => `${ev.title} (${ev.actual.formatted} vs ${ev.expected.formatted})`)
    .join('; ');
  const storeListNote = (situation.stores ?? [])
    .map((st) => `${STORE_MAP[st.storeId].name} (${st.storeId}, initial ${st.initialActual.formatted})`)
    .join('; ');

  const systemInstruction = [
    'You are the data scientist for Linden & Rye, a California womenswear chain.',
    'Find out what is true and why for the raised situation.',
    'Mandatory discipline:',
    '1. Always test the rival explanations (call test_calendar_for_period, test_store_mix, and test_data_fault) BEFORE naming a cause.',
    '2. Call the relevant domain tools (e.g. get_stock_cover_by_store_and_group, get_lost_sales, compare_store_with_established, get_refund_breakdown, compare_with_last_year, recompute_figure) to gather exact fact IDs.',
    '3. For refund anomalies, ALWAYS call get_refund_breakdown and set outcome_kind to "tool_to_build" when unlinked late-evening cash refunds concentrate on one till and operator.',
    '4. NEVER calculate numbers yourself and NEVER type digits (0-9) in templates — always reference facts by their exact fact id using {{fact_id}}.',
    '5. Always include a "do nothing" option among the options.',
    '6. When investigating stock shortages, check donor stores with idle surplus and respect the 8-week + next-delivery+1-week donor floor.',
  ].join('\n');

  const initialPrompt = [
    `Current simulated date: ${date}.`,
    `Situation ID: ${situation.candidateId}`,
    `Title: ${situation.title}`,
    `Summary: ${situation.summary}`,
    `Expected: {{${situation.expected.id}}} (${situation.expected.formatted}) | Actual: {{${situation.actual.id}}} (${situation.actual.formatted}) | Weekly stake: {{${situation.stakePerWeek.id}}} (${situation.stakePerWeek.formatted})`,
    storeListNote ? `Affected stores: ${storeListNote}` : '',
    evidenceNote ? `Linked supporting evidence: ${evidenceNote}` : '',
    'Investigate using your tools now. Test calendar, store mix, and data fault, inspect stock/refund/YoY details as appropriate, then summarize your findings.',
  ]
    .filter(Boolean)
    .join('\n');

  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx < cfg.models.length - 1) {
      continue;
    }

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    const localFacts: Record<string, Fact> = { ...factsById };
    const toolTrace: InvestigationToolTrace[] = [];
    let anyLive = false;
    let totalModelLatencyMs = 0;

    try {
      let resp = await callInteractionRaw({
        job: jobKey,
        feature: `checker:loop:${situation.candidateId}`,
        model,
        systemInstruction,
        input: initialPrompt,
        tools: CHECKER_TOOL_DECLARATIONS,
        timeoutMs,
      });
      if (resp.mode === 'live') anyLive = true;
      totalModelLatencyMs += resp.latencyMs;

      let round = 0;
      while (round < GEMINI_SETTINGS.checkerLimits.maxToolRounds) {
        const fnCalls = resp.steps.filter((s) => s.type === 'function_call' && s.id && s.name);
        if (fnCalls.length === 0) break;
        round += 1;

        const toolResultsInput: InteractionStep[] = [];
        for (const fc of fnCalls) {
          const tName = fc.name!;
          const tArgs = (fc.arguments ?? {}) as Record<string, unknown>;
          onEvent?.({
            type: 'tool_call',
            message: `Checking ${tName.replace(/_/g, ' ')}...`,
          });

          const toolRes = executeCheckerTool(tName, tArgs, sim, date, situation);
          for (const f of toolRes.facts) {
            localFacts[f.id] = f;
          }
          const traceItem: InvestigationToolTrace = {
            round,
            toolName: tName,
            argsSummary: toolRes.argsSummary,
            factIds: toolRes.facts.map((f) => f.id),
            facts: toolRes.facts,
          };
          toolTrace.push(traceItem);

          onEvent?.({
            type: 'tool_result',
            message: `${tName.replace(/_/g, ' ')}: ${toolRes.facts.map((f) => `${f.label} ${f.formatted}`).slice(0, 2).join(' · ')}`,
            toolTrace: traceItem,
          });

          toolResultsInput.push({
            type: 'function_result',
            call_id: fc.id,
            name: tName,
            result: JSON.stringify(toolRes.payload),
          });
        }

        resp = await callInteractionRaw({
          job: jobKey,
          feature: `checker:loop:${situation.candidateId}:r${round}`,
          model,
          previousInteractionId: resp.id,
          systemInstruction,
          tools: CHECKER_TOOL_DECLARATIONS,
          input: toolResultsInput,
          timeoutMs,
        });
        if (resp.mode === 'live') anyLive = true;
        totalModelLatencyMs += resp.latencyMs;
      }

      // Ensure all gathered facts are clearly summarized for the structured output step
      const factCatalog = Object.values(localFacts)
        .map((f) => `- {{${f.id}}}: ${f.label} = ${f.formatted} (${f.note})`)
        .join('\n');

      const maxWords = GEMINI_SETTINGS.checkerLimits.maxProseWords;
      const buildStructuredPrompt = (extraError?: string) =>
        [
          'Produce the final structured investigation JSON.',
          'CRITICAL RULES:',
          `- Each of finding_template, cause_template, and proposal_template MUST be 25 words or fewer (strict cap: <= ${maxWords} words each), one calm sentence, one single idea each.`,
          '- Keep the finding focused strictly on the raised situation itself — do NOT mix unrelated metrics (such as new-store total sales) into a stock finding.',
          '- NEVER type any digits 0-9 anywhere in `finding_template`, `cause_template`, or `proposal_template` outside `{{fact_id}}` placeholders (for example write "three stores", "eight weeks", "late evening", not digits!).',
          '- Every `{{fact_id}}` placeholder MUST come verbatim from the gathered fact catalog below.',
          '- `ruled_out` MUST include all 3 items: `calendar`, `store_mix`, `data_fault`, each with its gathered `fact_id`.',
          '- `options` MUST always include a `do_nothing` option (`is_do_nothing: true`).',
          '- For stock shortages, mention donor stores holding spare stock if present in the gathered facts.',
          extraError ? `\nFix this issue from your previous draft: ${extraError}` : '',
          '\nGathered Fact Catalog:',
          factCatalog,
        ]
          .filter(Boolean)
          .join('\n');

      const callStructuredStep = async (promptText: string, usePrevId: boolean) => {
        if (usePrevId) {
          try {
            return await callInteractionRaw({
              job: jobKey,
              feature: `checker:struct:${situation.candidateId}`,
              model,
              previousInteractionId: resp.id,
              input: promptText,
              responseFormat: {
                type: 'text',
                mime_type: 'application/json',
                schema: INVESTIGATION_RESPONSE_SCHEMA,
              },
              timeoutMs,
            });
          } catch {
            // Fallback to fresh call with gathered facts written into input (per spec)
          }
        }
        return await callInteractionRaw({
          job: jobKey,
          feature: `checker:struct_fresh:${situation.candidateId}`,
          model,
          systemInstruction,
          input: `${initialPrompt}\n\n${promptText}`,
          responseFormat: {
            type: 'text',
            mime_type: 'application/json',
            schema: INVESTIGATION_RESPONSE_SCHEMA,
          },
          timeoutMs,
          store: false,
        });
      };

      onEvent?.({ type: 'structured', message: 'Synthesizing findings and checking facts...' });

      let parsedPayload: StructuredInvestigationPayload | null = null;
      let findingSegments: TextSegment[] = [];
      let causeSegments: TextSegment[] = [];
      let proposalSegments: TextSegment[] = [];
      let validationOk = false;
      let extraRetryNote: string | undefined;

      for (let attempt = 0; attempt <= GEMINI_SETTINGS.checkerLimits.maxPlaceholderRetries; attempt++) {
        const sRes = await callStructuredStep(buildStructuredPrompt(extraRetryNote), attempt === 0);
        if (sRes.mode === 'live') anyLive = true;
        totalModelLatencyMs += sRes.latencyMs;
        const candidateJson = JSON.parse(sRes.output_text) as StructuredInvestigationPayload;

        const cFinding = validateAndResolvePlaceholders(candidateJson.finding_template, localFacts);
        const cCause = validateAndResolvePlaceholders(candidateJson.cause_template, localFacts);
        const cProposal = validateAndResolvePlaceholders(candidateJson.proposal_template, localFacts);

        const withinWordCap =
          cFinding.wordCount <= maxWords &&
          cCause.wordCount <= maxWords &&
          cProposal.wordCount <= maxWords;

        if (cFinding.ok && cCause.ok && cProposal.ok && withinWordCap) {
          parsedPayload = candidateJson;
          findingSegments = cFinding.segments;
          causeSegments = cCause.segments;
          proposalSegments = cProposal.segments;
          validationOk = true;
          break;
        }

        const issues: string[] = [];
        if (cFinding.hasTypedDigits || cCause.hasTypedDigits || cProposal.hasTypedDigits) {
          issues.push('Remove ALL typed digits 0-9 outside {{fact_id}} placeholders (write counts like "three" or "two" in words, or use {{fact_id}}).');
        }
        if (!withinWordCap) {
          issues.push(`Shorten finding (${cFinding.wordCount}w), cause (${cCause.wordCount}w), and proposal (${cProposal.wordCount}w) so EACH is at most ${maxWords} words.`);
        }
        const missingAll = [...cFinding.missingIds, ...cCause.missingIds, ...cProposal.missingIds];
        if (missingAll.length > 0) {
          issues.push(`Replace unknown placeholders [${missingAll.join(', ')}] with valid IDs from the Gathered Fact Catalog.`);
        }
        extraRetryNote = issues.join(' ');
      }

      const secondCheck = await runSecondCheckStep();
      const totalLatency = Math.max(1, totalModelLatencyMs);
      const finalMode: 'live' | 'replayed' = anyLive ? 'live' : 'replayed';

      if (!validationOk || !parsedPayload) {
        const codeFallback = buildCodeFallbackInvestigation(
          situation,
          sim,
          date,
          localFacts,
          toolTrace,
          model,
          finalMode,
          totalLatency,
          true,
        );
        codeFallback.secondCheck = secondCheck;
        codeFallback.transferPlan = transferPlanResult?.plan;
        onEvent?.({ type: 'done', message: 'Investigation verified with code wording.', result: codeFallback });
        return codeFallback;
      }

      // Build code-wording sentences strictly for unresolved placeholder safety fallback
      const codeFallbackWording = buildCodeFallbackInvestigation(
        situation,
        sim,
        date,
        localFacts,
        toolTrace,
        model,
        finalMode,
        totalLatency,
        false,
      );

      let anySentenceFallback = false;
      const cleanFinding = sanitizeSegmentsWithFallback(
        findingSegments,
        localFacts,
        codeFallbackWording.findingSegments,
      );
      const cleanCause = sanitizeSegmentsWithFallback(
        causeSegments,
        localFacts,
        codeFallbackWording.causeSegments,
      );
      const cleanProposal = sanitizeSegmentsWithFallback(
        proposalSegments,
        localFacts,
        codeFallbackWording.proposalSegments,
      );
      if (cleanFinding.usedFallback || cleanCause.usedFallback || cleanProposal.usedFallback) {
        anySentenceFallback = true;
      }

      // Build plain English Ruled Out sentences from gathered computed facts
      const ruledOut: InvestigationRuledOut[] = buildRuledOutSentences(localFacts);

      const fallbackActionOpt =
        codeFallbackWording.options.find((o) => !o.isDoNothing) ?? codeFallbackWording.options[0];
      const fallbackDoNothingOpt =
        codeFallbackWording.options.find((o) => o.isDoNothing) ?? codeFallbackWording.options[0];

      const options: InvestigationOption[] = parsedPayload.options.map((opt) => {
        const refOpt = opt.is_do_nothing ? fallbackDoNothingOpt : fallbackActionOpt;
        const defaultDesc =
          !opt.is_do_nothing && transferPlanResult?.plan
            ? `Move ${transferPlanResult.plan.totalUnitsFact.formatted} from stores with stock to spare while keeping safety stock.`
            : refOpt?.description ?? 'Carry out the recommended operational action.';
        const cleanLabel = resolveTextPlaceholdersWithFallback(
          opt.label,
          localFacts,
          refOpt?.label ?? (opt.is_do_nothing ? 'Do nothing' : 'Take recommended action'),
        );
        const cleanDesc = resolveTextPlaceholdersWithFallback(
          opt.description,
          localFacts,
          defaultDesc,
        );
        if (cleanLabel.usedFallback || cleanDesc.usedFallback) {
          anySentenceFallback = true;
        }
        return {
          id: opt.id,
          label: cleanLabel.text,
          isDoNothing: opt.is_do_nothing,
          description: cleanDesc.text,
          weeklyEffectFact: localFacts[opt.weekly_effect_fact_id],
        };
      });
      if (!options.some((o) => o.isDoNothing)) {
        const fallbackDn = createFact(
          `checker:dn:${situation.candidateId}:${date}`,
          'Do nothing weekly effect',
          -situation.stakePerWeek.value,
          'USD',
          'Weekly sales exposure if no action is taken.',
        );
        localFacts[fallbackDn.id] = fallbackDn;
        options.push({
          id: 'do_nothing',
          label: 'Do nothing',
          isDoNothing: true,
          description: 'Take no action and accept the ongoing weekly exposure.',
          weeklyEffectFact: fallbackDn,
        });
      }

      const fallbackCauseSummary =
        codeFallbackWording.causes[0]?.summary ?? 'Verified store cause based on computed facts.';
      const causes = parsedPayload.causes.map((c) => {
        const cleanSummary = resolveTextPlaceholdersWithFallback(
          c.summary,
          localFacts,
          fallbackCauseSummary,
        );
        if (cleanSummary.usedFallback) {
          anySentenceFallback = true;
        }
        return {
          summary: cleanSummary.text,
          factIds: c.fact_ids,
          facts: c.fact_ids.map((id) => localFacts[id]).filter((f): f is Fact => Boolean(f)),
        };
      });

      const cleanOutcomeDetail = resolveTextPlaceholdersWithFallback(
        parsedPayload.outcome_detail,
        localFacts,
        codeFallbackWording.outcomeDetail,
      );
      if (cleanOutcomeDetail.usedFallback) {
        anySentenceFallback = true;
      }

      const isLetGo = parsedPayload.outcome_kind === 'nothing_to_do';
      const resolvedOutcomeKind: InvestigationOutcomeKind =
        situation.detectorKind === 'refunds_out_of_line' && !isLetGo
          ? 'tool_to_build'
          : parsedPayload.outcome_kind;

      let finalOptions = options;
      if (situation.detectorKind === 'refunds_out_of_line' && !isLetGo) {
        const weeklyEffect =
          Object.values(localFacts).find((f) => f.id.includes('refund_bd:weekly_excess')) ??
          situation.stakePerWeek;
        const doNothingOpt = options.find((o) => o.isDoNothing);
        finalOptions = [
          {
            id: 'build_refund_desk',
            label: 'Build a refund exceptions desk',
            isDoNothing: false,
            description:
              'Write a focused desk for the finance lead showing 35 days of Walnut Creek refunds, flagged Till 2 evening cash entries, and an approval switch.',
            weeklyEffectFact: weeklyEffect,
          },
          {
            id: 'ask_store_manager',
            label: 'Ask the store manager',
            isDoNothing: false,
            description:
              'Send a question to the Walnut Creek store manager asking for an explanation of the cash refunds on Till 2 after 8 pm (due in 3 days).',
            weeklyEffectFact: weeklyEffect,
          },
          ...(doNothingOpt ? [doNothingOpt] : []),
        ];
      }

      const finalResult: InvestigationResult = {
        candidateId: situation.candidateId,
        status: isLetGo ? 'let_go' : 'confirmed',
        confirmed: parsedPayload.confirmed,
        findingSegments: cleanFinding.segments,
        causeSegments: cleanCause.segments,
        proposalSegments: cleanProposal.segments,
        causes,
        ruledOut,
        options: finalOptions,
        outcomeKind: resolvedOutcomeKind,
        outcomeDetail: cleanOutcomeDetail.text,
        model,
        mode: finalMode,
        latencyMs: totalLatency,
        usedFallbackWording: anySentenceFallback,
        toolTrace,
        factsById: localFacts,
        secondCheck,
        transferPlan: transferPlanResult?.plan,
        jobKey,
      };

      onEvent?.({ type: 'done', message: 'Investigation complete.', result: finalResult });
      return finalResult;
    } catch (err) {
      const msg = formatGeminiError(err);
      if (isModelUnavailableError(err) && mIdx < cfg.models.length - 1) {
        continue;
      }
      // Also allow 1 try on next model on timeout/failure if this was the primary model
      if (mIdx === 0 && cfg.models.length > 1) {
        continue;
      }
      const secondCheck = await runSecondCheckStep();
      const totalLatency = Math.max(1, Date.now() - startAll);
      const fallback = buildCodeFallbackInvestigation(
        situation,
        sim,
        date,
        localFacts,
        toolTrace,
        `code (fallback, Gemini not used: ${msg})`,
        'fallback',
        totalLatency,
        true,
      );
      fallback.secondCheck = secondCheck;
      fallback.transferPlan = transferPlanResult?.plan;
      fallback.jobKey = jobKey;
      onEvent?.({ type: 'done', message: 'Investigation completed on code fallback.', result: fallback });
      return fallback;
    }
  }

  const secondCheck = await runSecondCheckStep();
  const fallback = buildCodeFallbackInvestigation(
    situation,
    sim,
    date,
    factsById,
    [],
    'code (fallback, Gemini not used)',
    'fallback',
    Math.max(1, Date.now() - startAll),
    true,
  );
  fallback.secondCheck = secondCheck;
  fallback.transferPlan = transferPlanResult?.plan;
  fallback.jobKey = jobKey;
  onEvent?.({ type: 'done', message: 'Investigation completed on code fallback.', result: fallback });
  return fallback;
}
