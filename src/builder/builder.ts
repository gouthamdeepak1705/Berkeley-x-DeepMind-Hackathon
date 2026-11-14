import {
  callInteractionRaw,
  formatGeminiError,
  getUnavailableModelReason,
  isGeminiCallBlocked,
  isModelUnavailableError,
  recordGeminiCall,
} from '../gemini/client';
import { GEMINI_SETTINGS } from '../gemini/settings';
import { BuilderRequirement, RefundRecord } from '../types/domain';
import { FALLBACK_REFUND_DESK_HTML } from './fallbackTool';
export {
  computeExpectedFlaggedStats,
  injectSandboxCsp,
  type FlaggedRefundStats,
} from './sandboxUtils';

export function stripHtmlFences(raw: string): string {
  let s = raw.trim();
  const fenceStart = /^```(?:html|htm)?\s*\n?/i;
  const fenceEnd = /\n?```\s*$/i;
  if (fenceStart.test(s)) {
    s = s.replace(fenceStart, '');
    s = s.replace(fenceEnd, '');
  }
  const docIdx = s.search(/<!doctype\s+html/i);
  if (docIdx > 0 && docIdx < 200) {
    s = s.slice(docIdx);
  }
  return s.trim();
}

export interface BuildToolHtmlResult {
  html: string;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  byteSize: number;
  usedFallbackCopy: boolean;
  errorNote?: string;
}

function buildToolSystemInstruction(): string {
  return [
    'You build single-file, zero-dependency HTML/CSS/JS operational mini-apps that run inside a strict <iframe sandbox="allow-scripts">.',
    'Output ONLY complete valid HTML starting with <!DOCTYPE html>. Do NOT wrap in markdown fences or include prose.',
    'Security & CSP requirements:',
    '- Zero external URLs, scripts, fonts, stylesheets, images, fetch(), or XMLHttpRequest.',
    '- Do NOT access window.parent.document, window.top, localStorage, sessionStorage, or cookies.',
    '- Communicate with the parent app EXCLUSIVELY via window.parent.postMessage(..., "*") and window.addEventListener("message", ...).',
  ].join('\n');
}

function buildToolPrompt(requirement: BuilderRequirement, sampleRows: RefundRecord[]): string {
  return [
    'Build the "Refund exceptions desk" single-file HTML/CSS/JS mini-app for Linden & Rye.',
    '',
    'Approved requirement:',
    `- Purpose: ${requirement.plainSummary.purpose}`,
    `- Users: ${requirement.plainSummary.users}`,
    `- Shows: ${requirement.plainSummary.shows}`,
    `- Actions: ${requirement.plainSummary.actions}`,
    `- Verification: ${requirement.plainSummary.verification}`,
    '',
    'Data shape (RefundRecord):',
    '  { id: string, storeId: string, date: string (YYYY-MM-DD), time: string (HH:MM 24h), till: number, operatorNumber: number, amount: number, method: "cash" | "card", linkedOrder: boolean }',
    '5 sample rows:',
    JSON.stringify(sampleRows.slice(0, 5), null, 2),
    '',
    'Exact flagging rule:',
    '  r.method === "cash" && r.time >= "20:00" && !r.linkedOrder && Number(r.till) === 2 && Number(r.operatorNumber) === 14',
    '',
    'Required postMessage contract:',
    '1. On load (as soon as listeners are registered), send: window.parent.postMessage({ type: "loaded" }, "*")',
    '2. Attach window.addEventListener("error", ev => window.parent.postMessage({ type: "script_error", message: ev.message || "Script error" }, "*"))',
    '3. Handle incoming { type: "init", rows, storeName, switchEnabled, reviewedIds }:',
    '   - Store rows, render all 35-day refunds (with a filter tab for Flagged only vs All 35 days), highlight flagged rows, render Flagged count, Flagged dollar total (rounded to cents via Math.round(sum * 100) / 100), and Unreviewed count.',
    '   - Immediately post { type: "flagged_summary", count, total, unreviewedFlaggedCount } to window.parent.',
    '4. Let user click "Mark reviewed" on any row; toggle reviewed state, recompute unreviewedFlaggedCount, re-render, and post { type: "mark_reviewed", refundId, reviewed: boolean, unreviewedFlaggedCount }.',
    '5. Handle incoming { type: "test_mark_reviewed", refundId }: mark that row reviewed, re-render, and post { type: "mark_reviewed", refundId, reviewed: true, unreviewedFlaggedCount }.',
    '6. Include one toggle switch labeled "Require manager approval for cash refunds over $50 at this store". When clicked, post { type: "switch_toggle", enabled: !currentSwitchEnabled }.',
    '',
    'Visual design palette (match the main app):',
    '- Warm stone canvas background #FAF8F5, white #FFFFFF cards, border #E6E1D8, ink #171717, muted #57534E, indigo accent #312E81, flagged amber #B45309 on #FFFBEB, reviewed green #15803D on #ECFDF5, tabular-nums for all figures.',
    '- Output ONLY complete HTML starting with <!DOCTYPE html>.',
  ].join('\n');
}

export async function buildRefundDeskHtml(params: {
  requirement: BuilderRequirement;
  sampleRows: RefundRecord[];
}): Promise<BuildToolHtmlResult> {
  const { requirement, sampleRows } = params;
  const cfg = GEMINI_SETTINGS.jobs.builder_tool;

  const blockReason = isGeminiCallBlocked(cfg.capBucket);
  if (blockReason) {
    recordGeminiCall({
      feature: 'builder:tool:refund_exceptions_desk',
      job: cfg.key,
      model: 'code',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      mode: 'fallback',
      error: blockReason,
    });
    const byteSize = Buffer.byteLength(FALLBACK_REFUND_DESK_HTML, 'utf8');
    return {
      html: FALLBACK_REFUND_DESK_HTML,
      model: 'code (fallback copy)',
      mode: 'fallback',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      byteSize,
      usedFallbackCopy: true,
    };
  }

  const systemInstruction = buildToolSystemInstruction();
  const prompt = buildToolPrompt(requirement, sampleRows);
  let lastErr = '';

  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx < cfg.models.length - 1) continue;

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    try {
      const res = await callInteractionRaw({
        job: cfg.key,
        feature: 'builder:tool:refund_exceptions_desk',
        model,
        systemInstruction,
        input: prompt,
        thinkingLevel: cfg.thinkingLevel,
        store: true,
        timeoutMs,
      });

      const cleaned = stripHtmlFences(res.output_text);
      if (!cleaned.toLowerCase().includes('<html') && !cleaned.toLowerCase().includes('<script')) {
        lastErr = `${model} returned non-HTML output`;
        continue;
      }

      return {
        html: cleaned,
        model: res.model,
        mode: res.mode,
        latencyMs: res.latencyMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        byteSize: Buffer.byteLength(cleaned, 'utf8'),
        usedFallbackCopy: false,
      };
    } catch (err) {
      lastErr = formatGeminiError(err);
      if (isModelUnavailableError(err) && mIdx < cfg.models.length - 1) continue;
      if (mIdx < cfg.models.length - 1) continue;
    }
  }

  const byteSize = Buffer.byteLength(FALLBACK_REFUND_DESK_HTML, 'utf8');
  return {
    html: FALLBACK_REFUND_DESK_HTML,
    model: 'code (fallback copy)',
    mode: 'fallback',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    byteSize,
    usedFallbackCopy: true,
    errorNote: lastErr || 'All build models unavailable or timed out.',
  };
}

export async function repairRefundDeskHtml(params: {
  brokenHtml: string;
  failureReasons: string[];
  requirement: BuilderRequirement;
  sampleRows: RefundRecord[];
}): Promise<BuildToolHtmlResult> {
  const { brokenHtml, failureReasons, requirement, sampleRows } = params;
  const cfg = GEMINI_SETTINGS.jobs.builder_tool;

  if (isGeminiCallBlocked(cfg.capBucket)) {
    const byteSize = Buffer.byteLength(FALLBACK_REFUND_DESK_HTML, 'utf8');
    return {
      html: FALLBACK_REFUND_DESK_HTML,
      model: 'code (fallback copy)',
      mode: 'fallback',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      byteSize,
      usedFallbackCopy: true,
      errorNote: 'No GEMINI_API_KEY or daily cap reached during repair.',
    };
  }

  const repairPrompt = [
    buildToolPrompt(requirement, sampleRows),
    '',
    'The previous HTML draft FAILED automated sandbox tests with these exact failure reasons:',
    ...failureReasons.map((r) => `- ${r}`),
    '',
    'Previous HTML draft to repair:',
    brokenHtml,
    '',
    'Fix EVERY listed test failure now. Output ONLY the repaired complete HTML document starting with <!DOCTYPE html>.',
  ].join('\n');

  for (let mIdx = 0; mIdx < cfg.models.length; mIdx++) {
    const model = cfg.models[mIdx];
    const priorUnavail = getUnavailableModelReason(model);
    if (priorUnavail && mIdx < cfg.models.length - 1) continue;

    const timeoutMs = mIdx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    try {
      const res = await callInteractionRaw({
        job: cfg.key,
        feature: 'builder:repair:refund_exceptions_desk',
        model,
        systemInstruction: buildToolSystemInstruction(),
        input: repairPrompt,
        thinkingLevel: cfg.thinkingLevel,
        store: true,
        timeoutMs,
      });

      const cleaned = stripHtmlFences(res.output_text);
      if (!cleaned.toLowerCase().includes('<html') && !cleaned.toLowerCase().includes('<script')) {
        continue;
      }

      return {
        html: cleaned,
        model: res.model,
        mode: res.mode,
        latencyMs: res.latencyMs,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        byteSize: Buffer.byteLength(cleaned, 'utf8'),
        usedFallbackCopy: false,
      };
    } catch (err) {
      if (isModelUnavailableError(err) && mIdx < cfg.models.length - 1) continue;
      if (mIdx < cfg.models.length - 1) continue;
      return {
        html: brokenHtml,
        model,
        mode: 'fallback',
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        byteSize: Buffer.byteLength(brokenHtml, 'utf8'),
        usedFallbackCopy: false,
        errorNote: formatGeminiError(err),
      };
    }
  }

  return {
    html: brokenHtml,
    model: cfg.models[0],
    mode: 'fallback',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    byteSize: Buffer.byteLength(brokenHtml, 'utf8'),
    usedFallbackCopy: false,
    errorNote: 'Repair request failed on all configured models.',
  };
}

/**
 * Deliberately broken draft for Stage 4 Check 5 (/dev verification):
 * Reports wrong flagged count/total (and omits test_mark_reviewed handler) so automated tests catch it
 * and trigger the single repair pass.
 */
export function createDeliberatelyBrokenToolHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Refund exceptions desk (broken draft)</title>
</head>
<body>
  <h1>Walnut Creek — Refund exceptions desk</h1>
  <p>Loading refunds...</p>
  <script>
    (function () {
      function post(m) {
        if (window.parent && window.parent !== window) window.parent.postMessage(m, '*');
      }
      window.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'init') {
          // Deliberate bug: reports wrong count (0) and wrong total (0), and ignores test_mark_reviewed
          post({ type: 'flagged_summary', count: 0, total: 0, unreviewedFlaggedCount: 0 });
        }
      });
      post({ type: 'loaded' });
    })();
  </script>
</body>
</html>`;
}
