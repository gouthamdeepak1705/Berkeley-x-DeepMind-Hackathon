import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { GEMINI_SETTINGS, GeminiJobKey, ThinkingLevelSetting } from './settings';

export type CallMode = 'live' | 'replayed' | 'fallback';

export interface GeminiCallRecord {
  id: string;
  timestamp: string;
  feature: string;
  job: GeminiJobKey;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  mode: CallMode;
  estimatedCostUsd: number;
  error?: string;
}

export interface GeminiUsageSummary {
  dayKey: string;
  decisionCap: number;
  otherCap: number;
  uncachedDecisionCalls: number;
  uncachedOtherCalls: number;
  decisionCapReached: boolean;
  otherCapReached: boolean;
  totalCalls: number;
  liveCalls: number;
  replayedCalls: number;
  fallbackCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCostUsd: number;
  hasApiKey: boolean;
  unavailableModels: Record<string, string>;
  recentCalls: GeminiCallRecord[];
}

export interface ConnectionAttempt {
  model: string;
  ok: boolean;
  latencyMs: number;
  errorText?: string;
}

export interface ConnectionTestJobResult {
  job: GeminiJobKey;
  label: string;
  firstChoiceModel: string;
  answeredModel: string | null;
  usedFallback: boolean;
  ok: boolean;
  latencyMs: number;
  detail: string;
  attempts: ConnectionAttempt[];
}

export interface ConnectionTestReport {
  timestamp: string;
  hasApiKey: boolean;
  allFirstChoiceAnswered: boolean;
  results: ConnectionTestJobResult[];
}

export type DecisionQuestionInput =
  | {
      type: 'noul';
      instructions: string;
      criteria?: {
        true_description?: string;
        false_description?: string;
      };
    }
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: 'score';
      instructions: string;
      criteria: string[];
    };

export interface DecisionAnswerResult {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
  legend?: Record<string, string>;
  confidence: number;
}

export interface DecisionResponsePayload {
  answers: Record<string, DecisionAnswerResult>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_tokens?: number;
  };
}

export type InteractionToolDecl =
  | {
      type: 'function';
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: 'code_execution';
    };

export interface InteractionResponseFormat {
  type: 'text';
  mime_type: 'application/json' | 'text/plain';
  schema?: Record<string, unknown>;
}

export interface InteractionStep {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  call_id?: string;
  result?: unknown;
  text?: string;
}

export interface InteractionCallResult {
  id: string;
  model: string;
  mode: CallMode;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  output_text: string;
  steps: InteractionStep[];
}

// Module-level server state (never written to disk)
let cachedClient: GoogleGenAI | null = null;
let cachedClientKey: string | undefined;

const responseCache = new Map<string, unknown>();
const unavailableModels = new Map<string, string>();
const callRecords: GeminiCallRecord[] = [];
let nextCallRecordSeq = 1;
let currentCapDay = getUtcDayKey();
let uncachedDecisionCount = 0;
let uncachedOtherCount = 0;

function getUtcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyCountersIfNewDay(): void {
  const today = getUtcDayKey();
  if (today !== currentCapDay) {
    currentCapDay = today;
    uncachedDecisionCount = 0;
    uncachedOtherCount = 0;
  }
}

export function getApiKey(): string | undefined {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw || raw.trim() === '' || raw === 'MY_GEMINI_API_KEY') {
    return undefined;
  }
  return raw.trim();
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (cachedClient && cachedClientKey === apiKey) {
    return cachedClient;
  }
  cachedClient = new GoogleGenAI({
    apiKey,
    apiVersion: GEMINI_SETTINGS.apiVersion,
    httpOptions: {
      apiVersion: GEMINI_SETTINGS.apiVersion,
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
  cachedClientKey = apiKey;
  return cachedClient;
}

export function clearGeminiMemoryCache(): void {
  responseCache.clear();
  unavailableModels.clear();
  callRecords.length = 0;
  uncachedDecisionCount = 0;
  uncachedOtherCount = 0;
}

export function getUnavailableModelReason(model: string): string | undefined {
  return unavailableModels.get(model);
}

export function isCapReached(bucket: 'decision' | 'other'): boolean {
  resetDailyCountersIfNewDay();
  if (bucket === 'decision') {
    return uncachedDecisionCount >= GEMINI_SETTINGS.dailyCaps.decision;
  }
  return uncachedOtherCount >= GEMINI_SETTINGS.dailyCaps.other;
}

function incrementUncachedCount(bucket: 'decision' | 'other'): void {
  resetDailyCountersIfNewDay();
  if (bucket === 'decision') {
    uncachedDecisionCount += 1;
  } else {
    uncachedOtherCount += 1;
  }
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = GEMINI_SETTINGS.pricingPerMillionUsd[model] ?? { input: 0.5, output: 3.0 };
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function recordGeminiCall(entry: Omit<GeminiCallRecord, 'id' | 'timestamp' | 'estimatedCostUsd'>): void {
  const cost =
    entry.mode === 'live'
      ? estimateCostUsd(entry.model, entry.inputTokens, entry.outputTokens)
      : 0;
  callRecords.push({
    ...entry,
    id: `gcall:${Date.now()}:${nextCallRecordSeq++}`,
    timestamp: new Date().toISOString(),
    estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
  });
  if (callRecords.length > 500) {
    callRecords.splice(0, callRecords.length - 500);
  }
}

export function getGeminiUsageSummary(): GeminiUsageSummary {
  resetDailyCountersIfNewDay();
  let liveCalls = 0;
  let replayedCalls = 0;
  let fallbackCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let estimatedCostUsd = 0;

  for (const r of callRecords) {
    if (r.mode === 'live') liveCalls += 1;
    else if (r.mode === 'replayed') replayedCalls += 1;
    else fallbackCalls += 1;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    estimatedCostUsd += r.estimatedCostUsd;
  }

  return {
    dayKey: currentCapDay,
    decisionCap: GEMINI_SETTINGS.dailyCaps.decision,
    otherCap: GEMINI_SETTINGS.dailyCaps.other,
    uncachedDecisionCalls: uncachedDecisionCount,
    uncachedOtherCalls: uncachedOtherCount,
    decisionCapReached: uncachedDecisionCount >= GEMINI_SETTINGS.dailyCaps.decision,
    otherCapReached: uncachedOtherCount >= GEMINI_SETTINGS.dailyCaps.other,
    totalCalls: callRecords.length,
    liveCalls,
    replayedCalls,
    fallbackCalls,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    hasApiKey: Boolean(getApiKey()),
    unavailableModels: Object.fromEntries(unavailableModels.entries()),
    recentCalls: callRecords.slice(-50).reverse(),
  };
}

function hashRequest(kind: string, model: string, payload: unknown): string {
  const json = JSON.stringify({ kind, model, payload });
  return crypto.createHash('sha256').update(json).digest('hex');
}

export function formatGeminiError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: number; code?: unknown; cause?: unknown; response?: unknown };
    const parts: string[] = [];
    if (anyErr.status !== undefined) parts.push(`HTTP ${anyErr.status}`);
    if (anyErr.code !== undefined) parts.push(`code=${String(anyErr.code)}`);
    parts.push(anyErr.message);
    if (anyErr.cause) {
      parts.push(`cause=${anyErr.cause instanceof Error ? anyErr.cause.message : JSON.stringify(anyErr.cause)}`);
    }
    return parts.join(' | ');
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isModelUnavailableError(err: unknown): boolean {
  const msg = formatGeminiError(err);
  const anyErr = err as { status?: number; code?: number | string } | null;
  const status = anyErr?.status;
  if (status === 404 || status === 403 || status === 401 || status === 429) {
    return true;
  }
  return /\b(404|403|401|429)\b|NOT_FOUND|PERMISSION_DENIED|UNAUTHENTICATED|RESOURCE_EXHAUSTED|not found|not supported|unavailable/i.test(
    msg,
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs} ms (${label})`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function callDecisionsRaw(params: {
  model: string;
  input: string;
  questions: Record<string, DecisionQuestionInput>;
  timeoutMs: number;
  feature: string;
  bypassCache?: boolean;
}): Promise<{
  payload: DecisionResponsePayload;
  mode: CallMode;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const cacheKey = hashRequest('decisions', params.model, {
    input: params.input,
    questions: params.questions,
  });

  if (!params.bypassCache && responseCache.has(cacheKey)) {
    const cached = responseCache.get(cacheKey) as {
      payload: DecisionResponsePayload;
      originalLatencyMs: number;
    };
    const inputTokens = cached.payload.usage?.total_input_tokens ?? 0;
    const outputTokens = cached.payload.usage?.total_output_tokens ?? 0;
    recordGeminiCall({
      feature: params.feature,
      job: 'watcher',
      model: params.model,
      latencyMs: cached.originalLatencyMs,
      inputTokens,
      outputTokens,
      mode: 'replayed',
    });
    return {
      payload: cached.payload,
      mode: 'replayed',
      latencyMs: cached.originalLatencyMs,
      inputTokens,
      outputTokens,
    };
  }

  const apiKey = getApiKey();
  const client = getGeminiClient();
  if (!apiKey || !client) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  if (isCapReached('decision')) {
    throw new Error(`Daily uncached call cap (${GEMINI_SETTINGS.dailyCaps.decision}) reached for decision model.`);
  }

  const start = Date.now();
  try {
    let rawResp: DecisionResponsePayload;
    const clientAny = client as unknown as {
      decisions?: {
        create: (body: {
          model: string;
          input: string;
          questions: Record<string, DecisionQuestionInput>;
        }) => Promise<DecisionResponsePayload>;
      };
    };

    if (clientAny.decisions && typeof clientAny.decisions.create === 'function') {
      rawResp = await withTimeout(
        (
          clientAny.decisions.create as (
            body: {
              model: string;
              input: string;
              questions: Record<string, DecisionQuestionInput>;
            },
            api_version?: string,
            options?: { timeout_ms?: number; retries?: { strategy: 'none' } },
          ) => Promise<DecisionResponsePayload>
        )(
          {
            model: params.model,
            input: params.input,
            questions: params.questions,
          },
          undefined,
          { timeout_ms: params.timeoutMs, retries: { strategy: 'none' } },
        ),
        params.timeoutMs + 500,
        `decisions:${params.model}`,
      );
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/${GEMINI_SETTINGS.apiVersion}/decisions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
              'User-Agent': 'aistudio-build',
            },
            body: JSON.stringify({
              model: params.model,
              input: params.input,
              questions: params.questions,
            }),
            signal: controller.signal,
          },
        );
        const text = await res.text();
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}: ${text}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        rawResp = JSON.parse(text) as DecisionResponsePayload;
      } finally {
        clearTimeout(timer);
      }
    }

    const latencyMs = Math.max(1, Date.now() - start);
    incrementUncachedCount('decision');
    const inputTokens = rawResp.usage?.total_input_tokens ?? 0;
    const outputTokens = rawResp.usage?.total_output_tokens ?? 0;

    if (!params.bypassCache) {
      responseCache.set(cacheKey, {
        payload: rawResp,
        originalLatencyMs: latencyMs,
      });
    }

    recordGeminiCall({
      feature: params.feature,
      job: 'watcher',
      model: params.model,
      latencyMs,
      inputTokens,
      outputTokens,
      mode: 'live',
    });

    return { payload: rawResp, mode: 'live', latencyMs, inputTokens, outputTokens };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - start);
    const errText = formatGeminiError(err);
    if (isModelUnavailableError(err) && !unavailableModels.has(params.model)) {
      unavailableModels.set(params.model, errText);
    }
    recordGeminiCall({
      feature: params.feature,
      job: 'watcher',
      model: params.model,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: errText,
    });
    throw err;
  }
}

export async function callInteractionRaw(params: {
  job: GeminiJobKey;
  feature: string;
  model: string;
  input: string | InteractionStep[];
  systemInstruction?: string;
  tools?: InteractionToolDecl[];
  previousInteractionId?: string;
  responseFormat?: InteractionResponseFormat;
  thinkingLevel?: ThinkingLevelSetting;
  timeoutMs: number;
  bypassCache?: boolean;
  store?: boolean;
}): Promise<InteractionCallResult> {
  const thinkingLevel = params.thinkingLevel ?? GEMINI_SETTINGS.jobs[params.job].thinkingLevel;
  const cachePayload = {
    model: params.model,
    input: params.input,
    system_instruction: params.systemInstruction,
    tools: params.tools,
    previous_interaction_id: params.previousInteractionId,
    response_format: params.responseFormat,
    thinking_level: thinkingLevel,
    store: params.store,
  };
  const cacheKey = hashRequest('interactions', params.model, cachePayload);

  if (!params.bypassCache && responseCache.has(cacheKey)) {
    const cached = responseCache.get(cacheKey) as Omit<InteractionCallResult, 'mode'>;
    recordGeminiCall({
      feature: params.feature,
      job: params.job,
      model: params.model,
      latencyMs: cached.latencyMs,
      inputTokens: cached.inputTokens,
      outputTokens: cached.outputTokens,
      mode: 'replayed',
    });
    return {
      ...cached,
      mode: 'replayed',
    };
  }

  const client = getGeminiClient();
  if (!client) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  const bucket = GEMINI_SETTINGS.jobs[params.job].capBucket;
  if (isCapReached(bucket)) {
    throw new Error(
      `Daily uncached call cap (${GEMINI_SETTINGS.dailyCaps[bucket]}) reached for ${bucket} models.`,
    );
  }

  const start = Date.now();
  try {
    const requestBody: Record<string, unknown> = {
      model: params.model,
      input: params.input,
      generation_config: {
        thinking_level: thinkingLevel,
      },
    };
    if (params.systemInstruction) {
      requestBody.system_instruction = params.systemInstruction;
    }
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }
    if (params.previousInteractionId) {
      requestBody.previous_interaction_id = params.previousInteractionId;
    }
    if (params.responseFormat) {
      requestBody.response_format = params.responseFormat;
    }
    if (params.store !== undefined) {
      requestBody.store = params.store;
    }

    const interactionsApi = client.interactions as unknown as {
      create: (
        body: Record<string, unknown>,
        options?: { timeout_ms?: number; retries?: { strategy: 'none' } },
      ) => Promise<{
        id: string;
        output_text?: string;
        steps?: InteractionStep[];
        usage?: {
          total_input_tokens?: number;
          total_output_tokens?: number;
        };
      }>;
    };

    const resp = await withTimeout(
      interactionsApi.create(requestBody, {
        timeout_ms: params.timeoutMs,
        retries: { strategy: 'none' },
      }),
      params.timeoutMs + 1000,
      `interactions:${params.model}`,
    );

    const latencyMs = Math.max(1, Date.now() - start);
    incrementUncachedCount(bucket);

    const inputTokens = resp.usage?.total_input_tokens ?? 0;
    const outputTokens = resp.usage?.total_output_tokens ?? 0;
    const steps: InteractionStep[] = Array.isArray(resp.steps) ? resp.steps : [];
    const outputText =
      resp.output_text ??
      steps
        .filter((s) => s.type === 'text' && typeof s.text === 'string')
        .map((s) => s.text)
        .join('\n');

    const result: InteractionCallResult = {
      id: resp.id,
      model: params.model,
      mode: 'live',
      latencyMs,
      inputTokens,
      outputTokens,
      output_text: outputText,
      steps,
    };

    if (!params.bypassCache) {
      responseCache.set(cacheKey, {
        id: result.id,
        model: result.model,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        output_text: result.output_text,
        steps: result.steps,
      });
    }

    recordGeminiCall({
      feature: params.feature,
      job: params.job,
      model: params.model,
      latencyMs,
      inputTokens,
      outputTokens,
      mode: 'live',
    });

    return result;
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - start);
    const errText = formatGeminiError(err);
    if (isModelUnavailableError(err) && !unavailableModels.has(params.model)) {
      unavailableModels.set(params.model, errText);
    }
    recordGeminiCall({
      feature: params.feature,
      job: params.job,
      model: params.model,
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: errText,
    });
    throw err;
  }
}

export async function runConnectionTests(): Promise<ConnectionTestReport> {
  const hasApiKey = Boolean(getApiKey());
  const results: ConnectionTestJobResult[] = [];

  // 1. Watcher job: 1-question decision request (with structured-output fallback if gemini-decision-1 fails)
  {
    const cfg = GEMINI_SETTINGS.jobs.watcher;
    const attempts: ConnectionAttempt[] = [];
    let answeredModel: string | null = null;
    let totalMs = 0;
    let detail = '';

    for (let idx = 0; idx < cfg.models.length; idx++) {
      const model = cfg.models[idx];
      const timeoutMs = idx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
      const start = Date.now();
      try {
        if (model === 'gemini-decision-1') {
          const res = await callDecisionsRaw({
            model,
            input:
              'Linden & Rye California womenswear chain. Briefing: On Tuesday 11 August 2026, established-store sales were $34,200 vs $34,000 expected, well within normal daily noise. No issues open.',
            questions: {
              normal_day: {
                type: 'noul',
                instructions:
                  'According to the briefing, is today within normal trading expectations?',
              },
            },
            timeoutMs,
            feature: 'connection_test:watcher',
            bypassCache: true,
          });
          const ans = res.payload.answers?.normal_day;
          const elapsed = res.latencyMs;
          totalMs += elapsed;
          attempts.push({ model, ok: true, latencyMs: elapsed });
          answeredModel = model;
          detail = `Answer noul=${ans?.noul ?? 'n/a'} (confidence=${ans?.confidence ?? 'n/a'}).`;
          break;
        } else {
          const res = await callInteractionRaw({
            job: 'watcher',
            feature: 'connection_test:watcher_fallback',
            model,
            input:
              'Briefing: On Tuesday 11 August 2026, sales were $34,200 vs $34,000 expected. Answer whether this is normal.',
            responseFormat: {
              type: 'text',
              mime_type: 'application/json',
              schema: {
                type: 'object',
                properties: {
                  is_normal: { type: 'boolean' },
                  reason: { type: 'string' },
                },
                required: ['is_normal', 'reason'],
                additionalProperties: false,
              },
            },
            timeoutMs,
            bypassCache: true,
            store: false,
          });
          const elapsed = res.latencyMs;
          totalMs += elapsed;
          attempts.push({ model, ok: true, latencyMs: elapsed });
          answeredModel = model;
          detail = `Structured fallback JSON: ${res.output_text.slice(0, 140)}`;
          break;
        }
      } catch (err) {
        const elapsed = Math.max(1, Date.now() - start);
        totalMs += elapsed;
        attempts.push({
          model,
          ok: false,
          latencyMs: elapsed,
          errorText: formatGeminiError(err),
        });
      }
    }

    results.push({
      job: cfg.key,
      label: cfg.label,
      firstChoiceModel: cfg.models[0],
      answeredModel,
      usedFallback: answeredModel !== null && answeredModel !== cfg.models[0],
      ok: answeredModel !== null,
      latencyMs: totalMs,
      detail: detail || attempts[attempts.length - 1]?.errorText || 'Failed',
      attempts,
    });
  }

  // 2 & 3. Investigation jobs: 1-tool function call
  const toolJobs: GeminiJobKey[] = ['investigate_large', 'investigate_routine'];
  const testTool: InteractionToolDecl = {
    type: 'function',
    name: 'get_store_cover_fact',
    description: 'Returns computed weeks of cover for a store and product group.',
    parameters: {
      type: 'object',
      properties: {
        store_id: { type: 'string', description: 'Store identifier, e.g. union_square' },
        group_id: { type: 'string', description: 'Product group, e.g. best_sellers' },
      },
      required: ['store_id', 'group_id'],
    },
  };

  for (const jobKey of toolJobs) {
    const cfg = GEMINI_SETTINGS.jobs[jobKey];
    const attempts: ConnectionAttempt[] = [];
    let answeredModel: string | null = null;
    let totalMs = 0;
    let detail = '';

    for (let idx = 0; idx < cfg.models.length; idx++) {
      const model = cfg.models[idx];
      const timeoutMs = idx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
      const start = Date.now();
      try {
        const step1 = await callInteractionRaw({
          job: jobKey,
          feature: `connection_test:${jobKey}`,
          model,
          systemInstruction:
            'You are a retail data scientist. Always call get_store_cover_fact first to inspect the fact before answering.',
          input: 'Check Best-sellers cover at union_square using the tool, then state the fact id returned.',
          tools: [testTool],
          timeoutMs,
          bypassCache: true,
        });
        const fnCalls = step1.steps.filter((s) => s.type === 'function_call');
        if (fnCalls.length > 0 && fnCalls[0].id) {
          const fc = fnCalls[0];
          const step2 = await callInteractionRaw({
            job: jobKey,
            feature: `connection_test:${jobKey}:tool_result`,
            model,
            previousInteractionId: step1.id,
            tools: [testTool],
            input: [
              {
                type: 'function_result',
                call_id: fc.id,
                name: fc.name ?? 'get_store_cover_fact',
                result: JSON.stringify({
                  fact_id: 'test:union_square:best_sellers:cover',
                  weeks_of_cover: 2.4,
                  unit: 'weeks',
                }),
              },
            ],
            timeoutMs,
            bypassCache: true,
          });
          const elapsed = step1.latencyMs + step2.latencyMs;
          totalMs += elapsed;
          attempts.push({ model, ok: true, latencyMs: elapsed });
          answeredModel = model;
          detail = `Tool called: ${fc.name}(${JSON.stringify(fc.arguments ?? {})}) -> "${step2.output_text.slice(0, 120)}"`;
          break;
        } else {
          const elapsed = step1.latencyMs;
          totalMs += elapsed;
          attempts.push({ model, ok: true, latencyMs: elapsed });
          answeredModel = model;
          detail = `Answered directly (0 tool calls): "${step1.output_text.slice(0, 120)}"`;
          break;
        }
      } catch (err) {
        const elapsed = Math.max(1, Date.now() - start);
        totalMs += elapsed;
        attempts.push({
          model,
          ok: false,
          latencyMs: elapsed,
          errorText: formatGeminiError(err),
        });
      }
    }

    results.push({
      job: cfg.key,
      label: cfg.label,
      firstChoiceModel: cfg.models[0],
      answeredModel,
      usedFallback: answeredModel !== null && answeredModel !== cfg.models[0],
      ok: answeredModel !== null,
      latencyMs: totalMs,
      detail: detail || attempts[attempts.length - 1]?.errorText || 'Failed',
      attempts,
    });
  }

  // 4. Day One description job: small structured-output Interactions call
  {
    const cfg = GEMINI_SETTINGS.jobs.day_one_description;
    const attempts: ConnectionAttempt[] = [];
    let answeredModel: string | null = null;
    let totalMs = 0;
    let detail = '';

    for (let idx = 0; idx < cfg.models.length; idx++) {
      const model = cfg.models[idx];
      const timeoutMs = idx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
      const start = Date.now();
      try {
        const res = await callInteractionRaw({
          job: 'day_one_description',
          feature: 'connection_test:day_one',
          model,
          input:
            'Write one calm sentence describing a chain with {{chain:store_count}} stores where {{chain:established_count}} are established. Use the exact {{...}} placeholders and write zero digits.',
          responseFormat: {
            type: 'text',
            mime_type: 'application/json',
            schema: {
              type: 'object',
              properties: {
                sentence: { type: 'string' },
              },
              required: ['sentence'],
              additionalProperties: false,
            },
          },
          timeoutMs,
          bypassCache: true,
          store: false,
        });
        const parsed = JSON.parse(res.output_text) as { sentence?: string };
        const elapsed = res.latencyMs;
        totalMs += elapsed;
        attempts.push({ model, ok: true, latencyMs: elapsed });
        answeredModel = model;
        detail = `Structured output: "${parsed.sentence ?? res.output_text}"`;
        break;
      } catch (err) {
        const elapsed = Math.max(1, Date.now() - start);
        totalMs += elapsed;
        attempts.push({
          model,
          ok: false,
          latencyMs: elapsed,
          errorText: formatGeminiError(err),
        });
      }
    }

    results.push({
      job: cfg.key,
      label: cfg.label,
      firstChoiceModel: cfg.models[0],
      answeredModel,
      usedFallback: answeredModel !== null && answeredModel !== cfg.models[0],
      ok: answeredModel !== null,
      latencyMs: totalMs,
      detail: detail || attempts[attempts.length - 1]?.errorText || 'Failed',
      attempts,
    });
  }

  // 5. Code execution job: run tiny Python check via Interactions API code_execution tool
  {
    const cfg = GEMINI_SETTINGS.jobs.code_execution;
    const attempts: ConnectionAttempt[] = [];
    let answeredModel: string | null = null;
    let totalMs = 0;
    let detail = '';

    for (let idx = 0; idx < cfg.models.length; idx++) {
      const model = cfg.models[idx];
      const timeoutMs = idx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
      const start = Date.now();
      try {
        const res = await callInteractionRaw({
          job: 'code_execution',
          feature: 'connection_test:code_execution',
          model,
          input:
            'Use Python code_execution to sum [1200, 1500, 1800] and print ONLY the integer sum on the final line of stdout.',
          tools: [{ type: 'code_execution' }],
          timeoutMs,
          bypassCache: true,
          store: false,
        });
        const codeSteps = res.steps.filter((s) => s.type === 'code_execution_result');
        const execText = codeSteps
          .map((s) => {
            if (typeof s.result === 'string') return s.result;
            if (Array.isArray(s.result)) {
              return s.result
                .map((b) =>
                  b && typeof b === 'object' && 'text' in b ? String((b as { text?: unknown }).text ?? '') : '',
                )
                .join('\n');
            }
            if (s.result && typeof s.result === 'object') {
              const r = s.result as { output?: unknown; stdout?: unknown };
              return String(r.output ?? r.stdout ?? '');
            }
            return '';
          })
          .join('\n')
          .trim();
        const elapsed = res.latencyMs;
        totalMs += elapsed;
        attempts.push({ model, ok: true, latencyMs: elapsed });
        answeredModel = model;
        detail = `Code execution (${codeSteps.length} result step(s)): "${(execText || res.output_text).slice(0, 120)}"`;
        break;
      } catch (err) {
        const elapsed = Math.max(1, Date.now() - start);
        totalMs += elapsed;
        attempts.push({
          model,
          ok: false,
          latencyMs: elapsed,
          errorText: formatGeminiError(err),
        });
      }
    }

    results.push({
      job: cfg.key,
      label: cfg.label,
      firstChoiceModel: cfg.models[0],
      answeredModel,
      usedFallback: answeredModel !== null && answeredModel !== cfg.models[0],
      ok: answeredModel !== null,
      latencyMs: totalMs,
      detail: detail || attempts[attempts.length - 1]?.errorText || 'Failed',
      attempts,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    hasApiKey,
    allFirstChoiceAnswered: results.every((r) => r.ok && !r.usedFallback),
    results,
  };
}
