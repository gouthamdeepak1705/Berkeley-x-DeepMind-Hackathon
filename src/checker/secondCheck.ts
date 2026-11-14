import { addDays, getIsoWeekdayIndex } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { ESTABLISHED_STORES } from '../engine/stores';
import {
  callInteractionRaw,
  formatGeminiError,
  getApiKey,
  getUnavailableModelReason,
  InteractionStep,
  isCapReached,
  isModelUnavailableError,
  recordGeminiCall,
} from '../gemini/client';
import { GEMINI_SETTINGS } from '../gemini/settings';
import { Fact, RaisedItem, SecondCheckResult, StoreId } from '../types/domain';

function extractCodeExecutionStdout(steps: InteractionStep[], outputText: string): {
  stdout: string;
  pythonCode?: string;
} {
  let pythonCode: string | undefined;
  const chunks: string[] = [];

  for (const s of steps) {
    if (s.type === 'code_execution_call' && s.arguments) {
      const argCode = (s.arguments as { code?: unknown }).code;
      if (typeof argCode === 'string') {
        pythonCode = argCode;
      }
    }
    if (s.type === 'code_execution_result') {
      if (typeof s.result === 'string') {
        chunks.push(s.result);
      } else if (Array.isArray(s.result)) {
        for (const item of s.result) {
          if (item && typeof item === 'object' && 'text' in item) {
            chunks.push(String((item as { text?: unknown }).text ?? ''));
          }
        }
      } else if (s.result && typeof s.result === 'object') {
        const obj = s.result as { output?: unknown; stdout?: unknown; result?: unknown };
        const str = obj.output ?? obj.stdout ?? obj.result;
        if (typeof str === 'string') chunks.push(str);
      }
    }
  }

  const combined = chunks.join('\n').trim();
  return {
    stdout: combined || outputText.trim(),
    pythonCode,
  };
}

function parseFinalNumericLine(text: string): number | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const cleaned = lines[i].replace(/[$,\s]/g, '');
    const match = cleaned.match(/^-?\d+(?:\.\d+)?$/);
    if (match) {
      const val = Number(cleaned);
      if (Number.isFinite(val)) return val;
    }
    const inlineMatch = lines[i].match(/(-?\d[\d,]*(?:\.\d+)?)/g);
    if (inlineMatch && inlineMatch.length > 0) {
      const lastNum = Number(inlineMatch[inlineMatch.length - 1].replace(/,/g, ''));
      if (Number.isFinite(lastNum)) return lastNum;
    }
  }
  return null;
}

function buildCsvAndTaskForSituation(params: {
  situation: RaisedItem;
  sim: SimulationRun;
  date: string;
}): { csv: string; formulaTask: string; rowCount: number } {
  const { situation, sim, date } = params;
  const dateIdx = sim.dates.indexOf(date);
  const safeIdx = dateIdx >= 0 ? dateIdx : sim.dates.length - 1;
  const safeDate = sim.dates[safeIdx];

  if (situation.detectorKind === 'stock_running_out') {
    const grpId = situation.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
    const storeIds: StoreId[] = (situation.stores ?? []).map((s) => s.storeId);
    const startIdx = Math.max(0, safeIdx - 6);
    const lines = ['date,store_id,group_id,potential_sales,actual_sales,expected_store_sales'];
    for (let k = startIdx; k <= safeIdx; k++) {
      const d = sim.dates[k];
      const recs = sim.storeRecordsByDate[d];
      for (const sid of storeIds) {
        const g = recs[sid].groups[grpId];
        lines.push(
          `${d},${sid},${grpId},${g.potentialSales.toFixed(4)},${g.actualSales.toFixed(4)},${(recs[sid].expectedSales ?? 0).toFixed(4)}`,
        );
      }
    }
    return {
      csv: lines.join('\n'),
      rowCount: lines.length - 1,
      formulaTask:
        `Using ONLY rows on the latest date (${safeDate}) across the affected stores (${storeIds.join(', ')}), compute the combined weekly loss if nothing is done in USD: sum(potential_sales * 7) on date == "${safeDate}".`,
    };
  }

  if (situation.detectorKind === 'refunds_out_of_line') {
    const targetStore = situation.stores?.[0]?.storeId ?? 'walnut_creek';
    const startIdx = Math.max(0, safeIdx - 27);
    const lines = ['date,store_id,actual_sales,expected_sales,refund_amount'];
    for (let k = startIdx; k <= safeIdx; k++) {
      const d = sim.dates[k];
      const recs = sim.storeRecordsByDate[d];
      for (const st of ESTABLISHED_STORES) {
        const r = recs[st.id];
        if (!r.isOpen) continue;
        lines.push(
          `${d},${st.id},${r.actualSales.toFixed(4)},${(r.expectedSales ?? 0).toFixed(4)},${r.refundAmount.toFixed(4)}`,
        );
      }
    }
    return {
      csv: lines.join('\n'),
      rowCount: lines.length - 1,
      formulaTask:
        `For each store_id in the 28-day CSV (${sim.dates[startIdx]} to ${safeDate}), compute rate = sum(refund_amount) / sum(actual_sales). Compute other_median = median(rate) across all stores where store_id != "${targetStore}". Compute weekly excess refunds at "${targetStore}" in USD as: (target_rate - other_median) * sum_actual_sales("${targetStore}") / 4.`,
    };
  }

  if (situation.detectorKind === 'lfl_break') {
    const weekdayIdx = getIsoWeekdayIndex(safeDate);
    const endIdx = Math.max(6, safeIdx - (weekdayIdx + 1));
    const startIdx = Math.max(0, endIdx - 6);
    const lines = ['date,store_id,actual_sales,expected_sales'];
    for (let k = startIdx; k <= endIdx; k++) {
      const d = sim.dates[k];
      const recs = sim.storeRecordsByDate[d];
      for (const st of ESTABLISHED_STORES) {
        const r = recs[st.id];
        lines.push(`${d},${st.id},${r.actualSales.toFixed(4)},${(r.expectedSales ?? 0).toFixed(4)}`);
      }
    }
    return {
      csv: lines.join('\n'),
      rowCount: lines.length - 1,
      formulaTask:
        'Compute sum(expected_sales) - sum(actual_sales) across all rows in the CSV.',
    };
  }

  if (situation.detectorKind === 'store_out_of_line') {
    const targetStore = situation.stores?.[0]?.storeId ?? 'union_square';
    const startIdx = Math.max(0, safeIdx - 27);
    const lines = ['date,store_id,actual_sales,expected_sales'];
    for (let k = startIdx; k <= safeIdx; k++) {
      const d = sim.dates[k];
      const recs = sim.storeRecordsByDate[d];
      for (const st of ESTABLISHED_STORES) {
        const r = recs[st.id];
        lines.push(`${d},${st.id},${r.actualSales.toFixed(4)},${(r.expectedSales ?? 0).toFixed(4)}`);
      }
    }
    return {
      csv: lines.join('\n'),
      rowCount: lines.length - 1,
      formulaTask:
        `For each store_id, compute perf = sum(actual_sales) / sum(expected_sales) - 1. Compute med_perf = median(perf) across the 8 established stores. Compute weekly shortfall for "${targetStore}" in USD: max(0, (sum_expected("${targetStore}") * (1 + med_perf) - sum_actual("${targetStore}")) / 4).`,
    };
  }

  // drop_or_jump / day_out_of_line
  const startDate = addDays(safeDate, -34);
  const startIdx = Math.max(0, sim.dates.indexOf(startDate));
  const lines = ['date,store_id,actual_sales,expected_sales'];
  const storeList = situation.stores && situation.stores.length > 0
    ? situation.stores.map((s) => s.storeId)
    : ESTABLISHED_STORES.map((s) => s.id);
  for (let k = startIdx; k <= safeIdx; k++) {
    const d = sim.dates[k];
    const recs = sim.storeRecordsByDate[d];
    for (const sid of storeList) {
      const r = recs[sid];
      lines.push(`${d},${sid},${r.actualSales.toFixed(4)},${(r.expectedSales ?? 0).toFixed(4)}`);
    }
  }
  return {
    csv: lines.join('\n'),
    rowCount: lines.length - 1,
    formulaTask:
      situation.detectorKind === 'day_out_of_line'
        ? `Compute abs(sum(actual_sales on "${safeDate}") - sum(expected_sales on "${safeDate}")) in USD.`
        : 'Using the last 7 dates as recent_week and the prior 28 dates before those as prev28, compute abs(sum_actual(recent_week) - sum_actual(prev28) / 4) in USD.',
  };
}

/**
 * Second Check: cross-check the headline weekly loss figure using Gemini's
 * Python code_execution tool on raw daily CSV rows (<= date).
 */
export async function runSecondCheck(params: {
  situation: RaisedItem;
  sim: SimulationRun;
  date: string;
  firstValueFact: Fact;
  bypassCache?: boolean;
}): Promise<SecondCheckResult> {
  const { situation, sim, date, firstValueFact, bypassCache } = params;
  const cfg = GEMINI_SETTINGS.jobs.code_execution;

  if (!getApiKey() || isCapReached(cfg.capBucket)) {
    const reason = !getApiKey() ? 'No GEMINI_API_KEY configured' : 'Daily cap reached';
    recordGeminiCall({
      feature: `second_check:${situation.candidateId}`,
      job: 'code_execution',
      model: 'code',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: reason,
    });
    return {
      status: 'unavailable',
      label: 'Second check not available',
      firstValueFact,
      model: 'code (fallback, Gemini not used)',
      mode: 'fallback',
      latencyMs: 0,
      error: reason,
    };
  }

  const { csv, formulaTask, rowCount } = buildCsvAndTaskForSituation({
    situation,
    sim,
    date,
  });

  const prompt = [
    'Use Python (code_execution tool) to verify the exact weekly money figure from this daily CSV data.',
    `Task: ${formulaTask}`,
    'Instructions: Read the CSV string in Python using io.StringIO and csv/pandas/statistics, compute the exact float result, and print ONLY that single numeric value (no $ sign, no commas, no words) on the final line of stdout.',
    '',
    'CSV:',
    csv,
  ].join('\n');

  let lastError = 'Unknown error';
  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx < cfg.models.length - 1) continue;

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    try {
      const resp = await callInteractionRaw({
        job: 'code_execution',
        feature: `second_check:${situation.candidateId}`,
        model,
        input: prompt,
        tools: [{ type: 'code_execution' }],
        thinkingLevel: cfg.thinkingLevel,
        timeoutMs,
        bypassCache,
        store: false,
      });

      const { stdout, pythonCode } = extractCodeExecutionStdout(resp.steps, resp.output_text);
      const parsedVal = parseFinalNumericLine(stdout);
      if (parsedVal === null) {
        lastError = `Could not parse numeric value from code execution output: ${stdout.slice(0, 120)}`;
        continue;
      }

      const secondFact = createFact(
        `second_check:${situation.candidateId}:${date}`,
        'Second check (Python code execution)',
        parsedVal,
        firstValueFact.unit,
        `Independent Python calculation on ${rowCount} daily CSV rows up to ${date} via ${model} code_execution.`,
      );

      const denom = Math.max(1, Math.abs(firstValueFact.value));
      const diffPct = (Math.abs(parsedVal - firstValueFact.value) / denom) * 100;
      const matched = diffPct <= 1.0;

      return {
        status: matched ? 'matched' : 'disagreed',
        label: matched ? 'Checked two ways' : 'The two checks disagree',
        firstValueFact,
        secondValueFact: secondFact,
        diffPct: Math.round(diffPct * 100) / 100,
        model,
        mode: resp.mode,
        latencyMs: resp.latencyMs,
        pythonCode,
      };
    } catch (err) {
      lastError = formatGeminiError(err);
      if (isModelUnavailableError(err) && mIdx < cfg.models.length - 1) {
        continue;
      }
      if (mIdx === 0 && cfg.models.length > 1) {
        continue;
      }
      break;
    }
  }

  return {
    status: 'unavailable',
    label: 'Second check not available',
    firstValueFact,
    model: 'fallback',
    mode: 'fallback',
    latencyMs: 0,
    error: lastError,
  };
}
