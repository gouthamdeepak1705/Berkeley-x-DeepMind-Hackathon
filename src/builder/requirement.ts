import { executeCheckerTool } from '../checker/tools';
import { addDays } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import {
  callInteractionRaw,
  formatGeminiError,
  getUnavailableModelReason,
  isGeminiCallBlocked,
  isModelUnavailableError,
  recordGeminiCall,
} from '../gemini/client';
import {
  sanitizeSegmentsWithFallback,
  validateAndResolvePlaceholders,
} from '../gemini/placeholders';
import { GEMINI_SETTINGS } from '../gemini/settings';
import { BuilderRequirement, Fact, RaisedItem, TextSegment } from '../types/domain';
import { computeExpectedFlaggedStats } from './builder';

interface RequirementPayload {
  purpose_template: string;
  users_template: string;
  shows_template: string;
  actions_template: string;
  verification_template: string;
}

const REQUIREMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    purpose_template: { type: 'string' },
    users_template: { type: 'string' },
    shows_template: { type: 'string' },
    actions_template: { type: 'string' },
    verification_template: { type: 'string' },
  },
  required: [
    'purpose_template',
    'users_template',
    'shows_template',
    'actions_template',
    'verification_template',
  ],
};

function segmentsToText(segments: TextSegment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.text : s.fact.formatted)).join('');
}

function buildFallbackRequirement(params: {
  situationId: string;
  date: string;
  factsById: Record<string, Fact>;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  usedFallbackWording: boolean;
}): BuilderRequirement {
  const {
    situationId,
    date,
    factsById,
    model,
    mode,
    latencyMs,
    inputTokens,
    outputTokens,
    usedFallbackWording,
  } = params;

  const storeRate = Object.values(factsById).find((f) => f.id.includes('refund_bd:store_rate'));
  const op14Count = Object.values(factsById).find((f) => f.id.includes('refund_bd:op14_count'));
  const op14Usd = Object.values(factsById).find((f) => f.id.includes('refund_bd:op14_usd'));
  const windowDaysFact = factsById[`req:window_days:${date}`];
  const thresholdFact = factsById[`req:cash_threshold:${date}`];

  const purpose: TextSegment[] = storeRate
    ? [
        { type: 'text', text: 'Isolate and review unusual Walnut Creek cash refunds driving a ' },
        { type: 'fact', fact: storeRate },
        { type: 'text', text: ' refund rate.' },
      ]
    : [{ type: 'text', text: 'Isolate and stop unusual late-evening unlinked cash refunds at Walnut Creek.' }];

  const users: TextSegment[] = [
    { type: 'text', text: 'The finance lead reviews flagged entries daily; the owner turns on the approval switch.' },
  ];

  const shows: TextSegment[] =
    op14Count && op14Usd && windowDaysFact
      ? [
          { type: 'text', text: 'Last ' },
          { type: 'fact', fact: windowDaysFact },
          { type: 'text', text: ' of Walnut Creek refunds, highlighting ' },
          { type: 'fact', fact: op14Count },
          { type: 'text', text: ' unlinked evening Till two operator fourteen cash refunds totaling ' },
          { type: 'fact', fact: op14Usd },
          { type: 'text', text: '.' },
        ]
      : [{ type: 'text', text: 'All Walnut Creek refund records from the trailing window with unusual Till two cash items highlighted.' }];

  const actions: TextSegment[] = thresholdFact
    ? [
        { type: 'text', text: 'Mark individual refund records as reviewed and toggle manager approval for cash refunds over ' },
        { type: 'fact', fact: thresholdFact },
        { type: 'text', text: ' through the gateway.' },
      ]
    : [{ type: 'text', text: 'Mark refund records as reviewed and toggle the cash refund approval rule through the gateway.' }];

  const verification: TextSegment[] = [
    { type: 'text', text: 'Test in a sandboxed frame that it loads cleanly, matches flagged count and dollar total, and responds to mark-reviewed messages.' },
  ];

  return {
    situationId,
    title: 'Refund exceptions desk',
    generatedOn: date,
    purpose,
    users,
    shows,
    actions,
    verification,
    plainSummary: {
      purpose: segmentsToText(purpose),
      users: segmentsToText(users),
      shows: segmentsToText(shows),
      actions: segmentsToText(actions),
      verification: segmentsToText(verification),
    },
    factsById,
    model,
    mode,
    latencyMs,
    inputTokens,
    outputTokens,
    usedFallbackWording,
  };
}

export async function generateRefundDeskRequirement(params: {
  situation: RaisedItem;
  sim: SimulationRun;
  date: string;
}): Promise<BuilderRequirement> {
  const { situation, sim, date } = params;
  const cfg = GEMINI_SETTINGS.jobs.builder_requirement;

  const bd = executeCheckerTool(
    'get_refund_breakdown',
    { store_id: 'walnut_creek', window_days: 28 },
    sim,
    date,
    situation,
  );
  const factsById: Record<string, Fact> = {};
  for (const f of bd.facts) {
    factsById[f.id] = f;
  }

  const windowStart = addDays(date, -34);
  const rows35d = sim.walnutCreekRefunds.filter((r) => r.date >= windowStart && r.date <= date);
  const stats = computeExpectedFlaggedStats(rows35d);

  const fWindow = createFact(
    `req:window_days:${date}`,
    'Refund history window',
    35,
    'days',
    'Rolling 35-day refund log window shown in the Refund exceptions desk.',
  );
  const fThreshold = createFact(
    `req:cash_threshold:${date}`,
    'Cash refund approval threshold',
    50,
    'USD',
    'Dollar threshold above which cash refunds at Walnut Creek require manager approval.',
  );
  const fFlaggedCount = createFact(
    `req:flagged_count:${date}`,
    'Flagged unusual refund records (35d)',
    stats.count,
    'count',
    `Cash refunds on Till 2, operator 14, at or after 20:00 with no linked order in the last 35 days through ${date}.`,
  );
  const fFlaggedTotal = createFact(
    `req:flagged_total:${date}`,
    'Flagged unusual cash refund total (35d)',
    stats.total,
    'USD',
    `Exact dollar sum of those ${stats.count} flagged refund records through ${date}.`,
  );

  factsById[fWindow.id] = fWindow;
  factsById[fThreshold.id] = fThreshold;
  factsById[fFlaggedCount.id] = fFlaggedCount;
  factsById[fFlaggedTotal.id] = fFlaggedTotal;
  factsById[situation.actual.id] = situation.actual;
  factsById[situation.expected.id] = situation.expected;
  factsById[situation.stakePerWeek.id] = situation.stakePerWeek;

  const blockReason = isGeminiCallBlocked(cfg.capBucket);
  if (blockReason) {
    recordGeminiCall({
      feature: `builder:req:${situation.candidateId}`,
      job: cfg.key,
      model: 'code',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: blockReason,
    });
    return buildFallbackRequirement({
      situationId: situation.candidateId,
      date,
      factsById,
      model: 'code (fallback, Gemini not used)',
      mode: 'fallback',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      usedFallbackWording: true,
    });
  }

  const factCatalog = Object.values(factsById)
    .map((f) => `- {{${f.id}}}: ${f.label} = ${f.formatted}`)
    .join('\n');

  const systemInstruction = [
    'You write concise, plain-English software requirements for small internal operational tools at Linden & Rye.',
    'Write 5 short one-sentence fields describing a Refund exceptions desk tool for Walnut Creek.',
    'RULES:',
    '- NEVER type any digits (0-9) anywhere in any template string; reference every number strictly via {{fact_id}} from the catalog.',
    '- Keep each field under 25 words, clear and practical for a shop owner.',
  ].join('\n');

  const basePrompt = [
    `Date: ${date}. Situation: ${situation.title}.`,
    'Write the 5 requirement fields for building the "Refund exceptions desk":',
    '1. purpose_template: what the tool is for',
    '2. users_template: who uses it (finance lead + owner)',
    '3. shows_template: what it shows (last window of Walnut Creek refunds + flagged Till two operator fourteen after eight pm cash items)',
    '4. actions_template: what it lets them do (mark reviewed + toggle manager approval switch over the dollar threshold)',
    '5. verification_template: how it is tested before handover (sandboxed load, exact flagged count/total match, mark reviewed response)',
    '',
    'Fact Catalog:',
    factCatalog,
  ].join('\n');

  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx < cfg.models.length - 1) continue;

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    try {
      let extraRetry = '';
      for (let attempt = 0; attempt <= 1; attempt++) {
        const res = await callInteractionRaw({
          job: cfg.key,
          feature: `builder:req:${situation.candidateId}`,
          model,
          systemInstruction,
          input: extraRetry ? `${basePrompt}\n\nFix: ${extraRetry}` : basePrompt,
          responseFormat: {
            type: 'text',
            mime_type: 'application/json',
            schema: REQUIREMENT_SCHEMA,
          },
          timeoutMs,
        });

        const parsed = JSON.parse(res.output_text) as RequirementPayload;
        const pVal = validateAndResolvePlaceholders(parsed.purpose_template, factsById);
        const uVal = validateAndResolvePlaceholders(parsed.users_template, factsById);
        const sVal = validateAndResolvePlaceholders(parsed.shows_template, factsById);
        const aVal = validateAndResolvePlaceholders(parsed.actions_template, factsById);
        const vVal = validateAndResolvePlaceholders(parsed.verification_template, factsById);

        if (pVal.ok && uVal.ok && sVal.ok && aVal.ok && vVal.ok) {
          const fallbackReq = buildFallbackRequirement({
            situationId: situation.candidateId,
            date,
            factsById,
            model: res.model,
            mode: res.mode,
            latencyMs: res.latencyMs,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            usedFallbackWording: false,
          });
          const cP = sanitizeSegmentsWithFallback(pVal.segments, factsById, fallbackReq.purpose);
          const cU = sanitizeSegmentsWithFallback(uVal.segments, factsById, fallbackReq.users);
          const cS = sanitizeSegmentsWithFallback(sVal.segments, factsById, fallbackReq.shows);
          const cA = sanitizeSegmentsWithFallback(aVal.segments, factsById, fallbackReq.actions);
          const cV = sanitizeSegmentsWithFallback(vVal.segments, factsById, fallbackReq.verification);
          return {
            situationId: situation.candidateId,
            title: 'Refund exceptions desk',
            generatedOn: date,
            purpose: cP.segments,
            users: cU.segments,
            shows: cS.segments,
            actions: cA.segments,
            verification: cV.segments,
            plainSummary: {
              purpose: segmentsToText(cP.segments),
              users: segmentsToText(cU.segments),
              shows: segmentsToText(cS.segments),
              actions: segmentsToText(cA.segments),
              verification: segmentsToText(cV.segments),
            },
            factsById,
            model: res.model,
            mode: res.mode,
            latencyMs: res.latencyMs,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            usedFallbackWording:
              cP.usedFallback || cU.usedFallback || cS.usedFallback || cA.usedFallback || cV.usedFallback,
          };
        }

        const missing = [
          ...pVal.missingIds,
          ...uVal.missingIds,
          ...sVal.missingIds,
          ...aVal.missingIds,
          ...vVal.missingIds,
        ];
        extraRetry = [
          pVal.hasTypedDigits || uVal.hasTypedDigits || sVal.hasTypedDigits || aVal.hasTypedDigits || vVal.hasTypedDigits
            ? 'Remove ALL digits 0-9 outside {{fact_id}} placeholders (write "eight pm", "two", "fourteen" in words).'
            : '',
          missing.length > 0 ? `Use only valid fact IDs from the catalog instead of [${missing.join(', ')}].` : '',
        ]
          .filter(Boolean)
          .join(' ');
      }
    } catch (err) {
      if (isModelUnavailableError(err) && mIdx < cfg.models.length - 1) continue;
      if (mIdx < cfg.models.length - 1) continue;
      const errMsg = formatGeminiError(err);
      return buildFallbackRequirement({
        situationId: situation.candidateId,
        date,
        factsById,
        model: `code (fallback: ${errMsg})`,
        mode: 'fallback',
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        usedFallbackWording: true,
      });
    }
  }

  return buildFallbackRequirement({
    situationId: situation.candidateId,
    date,
    factsById,
    model: 'code (fallback, Gemini not used)',
    mode: 'fallback',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    usedFallbackWording: true,
  });
}
