import { RefundRecord, ToolTestCaseResult } from '../types/domain';
import { computeExpectedFlaggedStats, injectSandboxCsp } from './builder';

export interface SandboxTestSuiteResult {
  allPassed: boolean;
  results: ToolTestCaseResult[];
  failureReasons: string[];
  reportedCount?: number;
  reportedTotal?: number;
  expectedCount: number;
  expectedTotal: number;
}

export function evaluateSandboxOutcome(params: {
  loaded: boolean;
  scriptError?: string;
  reportedCount?: number;
  reportedTotal?: number;
  markReviewedAcked: boolean;
  expectedCount: number;
  expectedTotal: number;
}): SandboxTestSuiteResult {
  const {
    loaded,
    scriptError,
    reportedCount,
    reportedTotal,
    markReviewedAcked,
    expectedCount,
    expectedTotal,
  } = params;

  const test1Passed = loaded && !scriptError;
  const test1: ToolTestCaseResult = {
    id: 'loads_cleanly',
    label: 'Loads with no script error (5 s limit)',
    passed: test1Passed,
    detail: test1Passed
      ? 'Loaded cleanly inside sandboxed iframe with zero script errors.'
      : scriptError
        ? `Script error reported: ${scriptError}`
        : 'Tool did not post { type: "loaded" } within 5 seconds.',
  };

  const countOk = typeof reportedCount === 'number' && reportedCount === expectedCount;
  const totalOk =
    typeof reportedTotal === 'number' && Math.abs(reportedTotal - expectedTotal) < 0.01;
  const test2Passed = countOk && totalOk;
  const test2: ToolTestCaseResult = {
    id: 'flagged_math_matches',
    label: 'Flagged count and dollar total match app calculation',
    passed: test2Passed,
    detail: test2Passed
      ? `Matched exact expected figures: ${expectedCount} flagged totaling $${expectedTotal.toFixed(2)}.`
      : `Mismatch: tool reported count=${reportedCount ?? 'missing'}, total=${typeof reportedTotal === 'number' ? '$' + reportedTotal.toFixed(2) : 'missing'}, expected count=${expectedCount}, total=$${expectedTotal.toFixed(2)}.`,
  };

  const test3: ToolTestCaseResult = {
    id: 'mark_reviewed_responds',
    label: 'Mark-reviewed interaction responds to test message',
    passed: markReviewedAcked,
    detail: markReviewedAcked
      ? 'Tool handled { type: "test_mark_reviewed" } and acknowledged update.'
      : 'Tool did not reply with { type: "mark_reviewed" } after { type: "test_mark_reviewed" }.',
  };

  const results = [test1, test2, test3];
  const failureReasons = results.filter((r) => !r.passed).map((r) => r.detail);

  return {
    allPassed: results.every((r) => r.passed),
    results,
    failureReasons,
    reportedCount,
    reportedTotal,
    expectedCount,
    expectedTotal,
  };
}

/**
 * Runs the 3 mandatory behavioral tests inside a hidden <iframe sandbox="allow-scripts">
 * in the real browser before handing the tool over to the owner.
 */
export async function runSandboxedToolTests(
  rawHtml: string,
  rows: RefundRecord[],
): Promise<SandboxTestSuiteResult> {
  const expected = computeExpectedFlaggedStats(rows);
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return evaluateSandboxOutcome({
      loaded: false,
      scriptError: 'No browser DOM available for iframe verification.',
      markReviewedAcked: false,
      expectedCount: expected.count,
      expectedTotal: expected.total,
    });
  }

  const cspHtml = injectSandboxCsp(rawHtml);
  const testTargetRow = expected.flaggedRows[0] ?? rows[0];
  const testRefundId = testTargetRow?.id ?? 'ref:test:sample';

  return new Promise<SandboxTestSuiteResult>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.position = 'fixed';
    iframe.style.width = '380px';
    iframe.style.height = '480px';
    iframe.style.left = '-9999px';
    iframe.style.top = '-9999px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.title = 'Refund exceptions desk verification sandbox';

    let loaded = false;
    let scriptError: string | undefined;
    let reportedCount: number | undefined;
    let reportedTotal: number | undefined;
    let markReviewedAcked = false;
    let settled = false;
    let initSent = false;
    let reviewTestSent = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(overallTimer);
      window.clearTimeout(loadTimer);
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        evaluateSandboxOutcome({
          loaded,
          scriptError,
          reportedCount,
          reportedTotal,
          markReviewedAcked,
          expectedCount: expected.count,
          expectedTotal: expected.total,
        }),
      );
    };

    const maybeFinishEarly = () => {
      if (loaded && reportedCount !== undefined && markReviewedAcked) {
        window.setTimeout(finish, 60);
      }
    };

    const loadTimer = window.setTimeout(() => {
      if (!loaded) {
        finish();
      }
    }, 5000);

    const overallTimer = window.setTimeout(() => {
      finish();
    }, 7500);

    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'script_error') {
        scriptError = String(data.message ?? 'Unknown script error');
        finish();
        return;
      }

      if (data.type === 'loaded') {
        loaded = true;
        if (!initSent) {
          initSent = true;
          iframe.contentWindow?.postMessage(
            {
              type: 'init',
              storeName: 'Walnut Creek',
              rows,
              switchEnabled: false,
              reviewedIds: [],
            },
            '*',
          );
        }
      } else if (data.type === 'flagged_summary') {
        reportedCount = typeof data.count === 'number' ? data.count : Number(data.count);
        reportedTotal = typeof data.total === 'number' ? data.total : Number(data.total);
        if (!reviewTestSent) {
          reviewTestSent = true;
          iframe.contentWindow?.postMessage(
            {
              type: 'test_mark_reviewed',
              refundId: testRefundId,
            },
            '*',
          );
        }
        maybeFinishEarly();
      } else if (data.type === 'mark_reviewed') {
        if (!data.refundId || data.refundId === testRefundId) {
          markReviewedAcked = true;
          maybeFinishEarly();
        }
      }
    };

    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    iframe.srcdoc = cspHtml;
  });
}
