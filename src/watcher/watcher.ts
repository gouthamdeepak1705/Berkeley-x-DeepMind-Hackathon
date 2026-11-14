import { formatShortDate } from '../engine/calendar';
import { SimulationRun } from '../engine/simulation';
import { STORE_MAP } from '../engine/stores';
import {
  callDecisionsRaw,
  callInteractionRaw,
  DecisionAnswerResult,
  DecisionQuestionInput,
  formatGeminiError,
  getUnavailableModelReason,
  isGeminiCallBlocked,
  isModelUnavailableError,
  recordGeminiCall,
} from '../gemini/client';
import { GEMINI_SETTINGS } from '../gemini/settings';
import {
  BuiltToolRecord,
  Candidate,
  RaisedItem,
  StoreId,
  WatcherEvalRecord,
} from '../types/domain';
import { buildWatcherBriefing, WatcherSubject } from './briefing';

export interface WatcherSubjectOutcome {
  key: string;
  action: 'raise' | 'keep_watching' | 'let_go' | 'disagree_keep_watching';
  choice: 'raise_now' | 'keep_watching' | 'stay_quiet';
  confidence: number;
  explainedProb: number;
  actionableProb: number;
  urgencyIndex: number;
  urgencyLevel: string;
  reason: string;
  evalRecord: WatcherEvalRecord;
}

export interface WatcherMergeDecision {
  situationAId: string;
  situationBId: string;
  probability: number;
  merged: boolean;
}

export interface WatcherBatchResult {
  questionCount: number;
  latencyMs: number;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  errorNotice?: string;
  briefing: string;
  outcomes: Map<string, WatcherSubjectOutcome>;
  merges: WatcherMergeDecision[];
}

const URGENCY_LEVELS = ['can wait a month', 'this month', 'this week', 'today'];

function sanitizeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function highestProbabilityKey(probs?: Record<string, number>): number {
  if (!probs) return 2;
  let bestKey = 2;
  let bestVal = -1;
  for (const [k, v] of Object.entries(probs)) {
    const idx = Number(k);
    if (!Number.isNaN(idx) && typeof v === 'number' && v > bestVal) {
      bestVal = v;
      bestKey = idx;
    }
  }
  return Math.max(0, Math.min(URGENCY_LEVELS.length - 1, bestKey));
}

function buildCodeFallbackBatch(
  date: string,
  subjects: WatcherSubject[],
  openSituations: RaisedItem[],
  briefing: string,
  errorNotice?: string,
): WatcherBatchResult {
  const outcomes = new Map<string, WatcherSubjectOutcome>();
  for (const subj of subjects) {
    const cand = subj.primaryCandidate;
    const explained = subj.hasCodeSilenceExplanation;
    const choice: 'raise_now' | 'keep_watching' | 'stay_quiet' = explained
      ? 'stay_quiet'
      : 'raise_now';
    const action: WatcherSubjectOutcome['action'] = explained ? 'let_go' : 'raise';
    const confidence = explained ? 0.95 : 0.85;
    const explainedProb = explained ? 0.95 : 0.1;
    const actionableProb = cand.kind === 'refunds_out_of_line' || cand.kind === 'stock_running_out' ? 0.9 : 0.6;
    const urgencyIndex = cand.actual.value <= 0.01 ? 3 : 2;
    const reason = explained
      ? subj.codeSilenceReason ?? 'Explained by code silence check.'
      : `Unexplained ${cand.title.toLowerCase()} (fallback, Gemini not used).`;

    outcomes.set(subj.key, {
      key: subj.key,
      action,
      choice,
      confidence,
      explainedProb,
      actionableProb,
      urgencyIndex,
      urgencyLevel: URGENCY_LEVELS[urgencyIndex],
      reason,
      evalRecord: {
        date,
        situationId: subj.key,
        groundTruth: cand.groundTruth,
        decisionChoice: choice,
        confidence,
        explainedProb,
        actionableProb,
        urgencyIndex,
        latencyMs: 0,
        model: 'code',
        mode: 'fallback',
        outcome: action === 'raise' ? 'raised' : 'let_go',
      },
    });
  }

  recordGeminiCall({
    feature: `watcher:${date}`,
    job: 'watcher',
    model: 'code',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    mode: 'fallback',
    error: errorNotice,
  });

  // Still keep signature aligned for merges
  const merges: WatcherMergeDecision[] = [];
  void openSituations;

  return {
    questionCount: subjects.length * 4,
    latencyMs: 0,
    model: 'code',
    mode: 'fallback',
    errorNotice,
    briefing,
    outcomes,
    merges,
  };
}

async function runLiteStructuredFallback(params: {
  model: string;
  briefing: string;
  subjects: WatcherSubject[];
  pairDefs: Array<{ key: string; sitA: RaisedItem; sitB: RaisedItem }>;
  timeoutMs: number;
  date: string;
}): Promise<{
  answers: Record<string, DecisionAnswerResult>;
  latencyMs: number;
  mode: 'live' | 'replayed';
}> {
  const subjectList = params.subjects
    .map((s, idx) => `${idx}: key="${s.key}" title="${s.title}"`)
    .join('\n');
  const pairList =
    params.pairDefs.length > 0
      ? params.pairDefs
          .map((p) => `pair "${p.key}": "${p.sitA.title}" vs "${p.sitB.title}"`)
          .join('\n')
      : 'none';

  const prompt = [
    params.briefing,
    '',
    'For each subject below, return a JSON decision item:',
    '- choice: "raise_now" | "keep_watching" | "stay_quiet"',
    '- choice_confidence: number between 0.01 and 0.99',
    '- explained_prob: number between 0.01 and 0.99 (is it fully explained by calendar, opening ramp, partial period, or action already underway?)',
    '- actionable_prob: number between 0.01 and 0.99 (can the business act within 2 weeks?)',
    '- urgency_index: integer 0 (can wait a month), 1 (this month), 2 (this week), or 3 (today)',
    '',
    'Subjects:',
    subjectList,
    '',
    'Pairs to check for same underlying problem (return same_problem_prob 0.01..0.99):',
    pairList,
  ].join('\n');

  const res = await callInteractionRaw({
    job: 'watcher',
    feature: `watcher_fallback:${params.date}`,
    model: params.model,
    input: prompt,
    responseFormat: {
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        properties: {
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                choice: { type: 'string', enum: ['raise_now', 'keep_watching', 'stay_quiet'] },
                choice_confidence: { type: 'number' },
                explained_prob: { type: 'number' },
                actionable_prob: { type: 'number' },
                urgency_index: { type: 'integer' },
              },
              required: [
                'key',
                'choice',
                'choice_confidence',
                'explained_prob',
                'actionable_prob',
                'urgency_index',
              ],
            },
          },
          merges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                same_problem_prob: { type: 'number' },
              },
              required: ['key', 'same_problem_prob'],
            },
          },
        },
        required: ['decisions', 'merges'],
      },
    },
    timeoutMs: params.timeoutMs,
    store: false,
  });

  const parsed = JSON.parse(res.output_text) as {
    decisions?: Array<{
      key: string;
      choice: 'raise_now' | 'keep_watching' | 'stay_quiet';
      choice_confidence: number;
      explained_prob: number;
      actionable_prob: number;
      urgency_index: number;
    }>;
    merges?: Array<{ key: string; same_problem_prob: number }>;
  };

  const answers: Record<string, DecisionAnswerResult> = {};
  for (const subj of params.subjects) {
    const d = parsed.decisions?.find((x) => x.key === subj.key);
    const prefix = sanitizeKey(subj.key);
    const choice = d?.choice ?? (subj.hasCodeSilenceExplanation ? 'stay_quiet' : 'keep_watching');
    const conf = Math.max(0.01, Math.min(0.99, d?.choice_confidence ?? 0.75));
    const expl = Math.max(0.01, Math.min(0.99, d?.explained_prob ?? (subj.hasCodeSilenceExplanation ? 0.9 : 0.15)));
    const act = Math.max(0.01, Math.min(0.99, d?.actionable_prob ?? 0.7));
    const urg = Math.max(0, Math.min(3, Math.round(d?.urgency_index ?? 2)));

    answers[`${prefix}_choice`] = { type: 'choice', choice, confidence: conf };
    answers[`${prefix}_explained`] = { type: 'noul', noul: expl, confidence: Math.max(expl, 1 - expl) };
    answers[`${prefix}_actionable`] = { type: 'noul', noul: act, confidence: Math.max(act, 1 - act) };
    answers[`${prefix}_urgency`] = {
      type: 'score',
      score: urg,
      probabilities: { [String(urg)]: 0.8 },
      confidence: 0.8,
    };
  }
  for (const p of params.pairDefs) {
    const m = parsed.merges?.find((x) => x.key === p.key);
    const prob = Math.max(0.01, Math.min(0.99, m?.same_problem_prob ?? 0.1));
    answers[p.key] = { type: 'noul', noul: prob, confidence: Math.max(prob, 1 - prob) };
  }

  return {
    answers,
    latencyMs: res.latencyMs,
    mode: res.mode === 'replayed' ? 'replayed' : 'live',
  };
}

export async function evaluateWatcherBatch(params: {
  sim: SimulationRun;
  date: string;
  subjects: WatcherSubject[];
  openSituations: RaisedItem[];
  letGoSummaries: string[];
  decisions: Parameters<typeof buildWatcherBriefing>[0]['decisions'];
  controlStores: Set<string>;
  builtTools?: BuiltToolRecord[];
  reviewedRefundIds?: string[];
}): Promise<WatcherBatchResult> {
  const {
    sim,
    date,
    subjects,
    openSituations,
    letGoSummaries,
    decisions,
    controlStores,
    builtTools,
    reviewedRefundIds,
  } = params;
  const briefing = buildWatcherBriefing({
    sim,
    date,
    subjects,
    openSituations,
    letGoSummaries,
    decisions,
    controlStores,
    builtTools,
    reviewedRefundIds,
  });

  if (subjects.length === 0) {
    return {
      questionCount: 0,
      latencyMs: 0,
      model: GEMINI_SETTINGS.jobs.watcher.models[0],
      mode: 'replayed',
      briefing,
      outcomes: new Map(),
      merges: [],
    };
  }

  // Pair-merge checks for open situations not already linked by code (up to 10 pairs, largest stake first)
  const sortedOpen = [...openSituations].sort(
    (a, b) => b.stakePerWeek.value - a.stakePerWeek.value,
  );
  const pairDefs: Array<{ key: string; sitA: RaisedItem; sitB: RaisedItem }> = [];
  for (let i = 0; i < sortedOpen.length && pairDefs.length < GEMINI_SETTINGS.watcherThresholds.maxMergePairsPerRequest; i++) {
    for (let j = i + 1; j < sortedOpen.length && pairDefs.length < GEMINI_SETTINGS.watcherThresholds.maxMergePairsPerRequest; j++) {
      const a = sortedOpen[i];
      const b = sortedOpen[j];
      const linkedInA = a.evidence?.some((e) => e.candidateId === b.candidateId);
      const linkedInB = b.evidence?.some((e) => e.candidateId === a.candidateId);
      if (linkedInA || linkedInB) continue;
      pairDefs.push({
        key: `merge_${pairDefs.length}`,
        sitA: a,
        sitB: b,
      });
    }
  }

  const questions: Record<string, DecisionQuestionInput> = {};
  const keyMap = new Map<string, { choiceKey: string; explainedKey: string; actionableKey: string; urgencyKey: string }>();

  for (let idx = 0; idx < subjects.length; idx++) {
    const subj = subjects[idx];
    const prefix = `s${idx}_${sanitizeKey(subj.key)}`.slice(0, 46);
    const choiceKey = `${prefix}_choice`;
    const explainedKey = `${prefix}_expl`;
    const actionableKey = `${prefix}_act`;
    const urgencyKey = `${prefix}_urg`;
    keyMap.set(subj.key, { choiceKey, explainedKey, actionableKey, urgencyKey });

    const scopeLabel = `${subj.title} [${subj.key}]`;

    questions[choiceKey] = {
      type: 'choice',
      instructions: `For "${scopeLabel}" on ${formatShortDate(date)}: What should a careful operations manager do about this today?`,
      criteria: {
        raise_now:
          'the facts break what was expected by enough to matter, nothing in the briefing explains it, and something can still be done',
        keep_watching: 'something looks off but it is small, early or partly explained',
        stay_quiet: 'the briefing explains it, or it is too small to matter',
      },
    };

    questions[explainedKey] = {
      type: 'noul',
      instructions: `For "${scopeLabel}" on ${formatShortDate(date)}: According to the briefing, is this change fully explained by the calendar, a new store's opening ramp, an unfinished period, or an action already under way?`,
      criteria: {
        true_description: 'Yes, the briefing explicitly states a calendar event, opening ramp, unfinished period, or existing action explains it.',
        false_description: 'No, nothing in the briefing fully explains this change.',
      },
    };

    questions[actionableKey] = {
      type: 'noul',
      instructions: `For "${scopeLabel}" on ${formatShortDate(date)}: Can the business still do something useful about this within the next two weeks?`,
      criteria: {
        true_description: 'Yes, stock transfers, audits, or operational adjustments can usefully respond within two weeks.',
        false_description: 'No, no useful action can or should be taken within two weeks.',
      },
    };

    questions[urgencyKey] = {
      type: 'score',
      instructions: `For "${scopeLabel}" on ${formatShortDate(date)}: How soon does this need a decision?`,
      criteria: URGENCY_LEVELS,
    };
  }

  for (const p of pairDefs) {
    questions[p.key] = {
      type: 'noul',
      instructions: `Do these two open situations describe the same underlying problem? (1) ${p.sitA.title}: ${p.sitA.summary} (2) ${p.sitB.title}: ${p.sitB.summary}`,
    };
  }

  const questionCount = Object.keys(questions).length;
  const cfg = GEMINI_SETTINGS.jobs.watcher;

  const blockReason = isGeminiCallBlocked(cfg.capBucket);
  if (blockReason) {
    const notice = `fallback, Gemini not used (${blockReason})`;
    return buildCodeFallbackBatch(date, subjects, openSituations, briefing, notice);
  }

  let answers: Record<string, DecisionAnswerResult> | null = null;
  let answeredModel = cfg.models[0];
  let answeredMode: 'live' | 'replayed' = 'live';
  let latencyMs = 0;
  let errorNotice: string | undefined;

  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx === 0) {
      errorNotice = `${model} unavailable: ${priorUnavail}`;
      continue;
    }

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    try {
      if (model === 'gemini-decision-1') {
        const res = await callDecisionsRaw({
          model,
          input: briefing,
          questions,
          timeoutMs,
          feature: `watcher:${date}`,
        });
        answers = res.payload.answers ?? {};
        answeredModel = model;
        answeredMode = res.mode === 'replayed' ? 'replayed' : 'live';
        latencyMs = res.latencyMs;
        break;
      } else {
        const res = await runLiteStructuredFallback({
          model,
          briefing,
          subjects,
          pairDefs,
          timeoutMs,
          date,
        });
        answers = res.answers;
        answeredModel = model;
        answeredMode = res.mode;
        latencyMs = res.latencyMs;
        break;
      }
    } catch (err) {
      const msg = formatGeminiError(err);
      if (isModelUnavailableError(err)) {
        errorNotice = `${model} unavailable: ${msg}`;
        continue;
      }
      errorNotice = `fallback, Gemini not used (${msg})`;
      break;
    }
  }

  if (!answers) {
    return buildCodeFallbackBatch(
      date,
      subjects,
      openSituations,
      briefing,
      errorNotice ?? 'fallback, Gemini not used',
    );
  }

  const outcomes = new Map<string, WatcherSubjectOutcome>();
  const { raiseMinConfidence, explainedMaxProbability, mergeMinProbability } =
    GEMINI_SETTINGS.watcherThresholds;

  for (const subj of subjects) {
    const keys = keyMap.get(subj.key)!;
    const choiceAns = answers[keys.choiceKey];
    const explAns = answers[keys.explainedKey];
    const actAns = answers[keys.actionableKey];
    const urgAns = answers[keys.urgencyKey];

    const choice = (choiceAns?.choice as 'raise_now' | 'keep_watching' | 'stay_quiet') ?? 'keep_watching';
    const confidence = choiceAns?.confidence ?? 0.5;
    const explainedProb = explAns?.noul ?? 0.5;
    const actionableProb = actAns?.noul ?? 0.5;
    const urgencyIndex = highestProbabilityKey(urgAns?.probabilities);
    const urgencyLevel = URGENCY_LEVELS[urgencyIndex] ?? 'this week';

    const modelWantsRaise =
      choice === 'raise_now' &&
      confidence >= raiseMinConfidence &&
      explainedProb < explainedMaxProbability &&
      !subj.alreadyHandled;

    let action: WatcherSubjectOutcome['action'];
    let reason: string;

    if (modelWantsRaise && subj.hasCodeSilenceExplanation) {
      action = 'disagree_keep_watching';
      reason = `Instinct and calendar check disagree: instinct chose raise_now (confidence ${confidence.toFixed(2)}, explained ${explainedProb.toFixed(2)}) while code silence check says ${subj.codeSilenceReason ?? 'explained'}. Keeping watch.`;
    } else if (modelWantsRaise) {
      action = 'raise';
      reason = `Raised by instinct, confidence ${confidence.toFixed(2)}, decided in ${latencyMs} ms.`;
    } else if (choice === 'stay_quiet' || (subj.hasCodeSilenceExplanation && explainedProb >= explainedMaxProbability)) {
      action = 'let_go';
      reason = subj.hasCodeSilenceExplanation
        ? subj.codeSilenceReason ?? 'Explained by calendar or opening ramp in briefing.'
        : `Let go by instinct (stay_quiet, confidence ${confidence.toFixed(2)}): change is explained or too small to interrupt.`;
    } else {
      action = 'keep_watching';
      reason = `Watching closely (${choice}, confidence ${confidence.toFixed(2)}, explained ${explainedProb.toFixed(2)}).`;
    }

    outcomes.set(subj.key, {
      key: subj.key,
      action,
      choice,
      confidence,
      explainedProb,
      actionableProb,
      urgencyIndex,
      urgencyLevel,
      reason,
      evalRecord: {
        date,
        situationId: subj.key,
        groundTruth: subj.primaryCandidate.groundTruth,
        decisionChoice: choice,
        confidence,
        explainedProb,
        actionableProb,
        urgencyIndex,
        latencyMs,
        model: answeredModel,
        mode: answeredMode,
        outcome:
          action === 'raise'
            ? 'raised'
            : action === 'let_go'
              ? 'let_go'
              : action === 'disagree_keep_watching'
                ? 'disagree_keep_watching'
                : 'keep_watching',
      },
    });
  }

  const merges: WatcherMergeDecision[] = [];
  for (const p of pairDefs) {
    const ans = answers[p.key];
    const prob = ans?.noul ?? 0;
    merges.push({
      situationAId: p.sitA.candidateId,
      situationBId: p.sitB.candidateId,
      probability: prob,
      merged: prob > mergeMinProbability,
    });
  }

  return {
    questionCount,
    latencyMs,
    model: answeredModel,
    mode: answeredMode,
    errorNotice,
    briefing,
    outcomes,
    merges,
  };
}

export function buildSubjectTitle(primary: Candidate, members: Candidate[]): string {
  if (primary.kind === 'stock_running_out' && primary.groupId) {
    const grpName = primary.groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
    const names = Array.from(
      new Set(
        members
          .map((m) => (m.storeId ? STORE_MAP[m.storeId as StoreId].name : undefined))
          .filter((n): n is string => Boolean(n)),
      ),
    );
    return names.length > 0 ? `${grpName} running short — ${names.join(', ')}` : `${grpName} running short`;
  }
  return primary.title;
}
