import { useState } from 'react';
import { ArrowLeft, Check, Download, Play, X } from 'lucide-react';
import { BuilderRequirement, DiagnosticReport, RefundRecord, ToolTestCaseResult } from '../types/domain';
import { runSandboxedToolTests } from '../builder/tester';

interface ConnectionAttempt {
  model: string;
  ok: boolean;
  latencyMs: number;
  errorText?: string;
}

interface ConnectionTestJobResult {
  job: string;
  label: string;
  firstChoiceModel: string;
  answeredModel: string | null;
  usedFallback: boolean;
  ok: boolean;
  latencyMs: number;
  detail: string;
  attempts: ConnectionAttempt[];
}

interface ConnectionTestReport {
  timestamp: string;
  hasApiKey: boolean;
  allFirstChoiceAnswered: boolean;
  results: ConnectionTestJobResult[];
}

interface DevDiagnosticsPageProps {
  report: DiagnosticReport;
  onBack: () => void;
}

interface GatewayTestCase {
  id: string;
  label: string;
  ok: boolean;
  refusedAsExpected: boolean;
  reason: string;
}

interface GatewayTestReport {
  date: string;
  allRefused: boolean;
  cases: GatewayTestCase[];
}

interface BrokenToolRepairReport {
  initialPassed: boolean;
  initialResults: ToolTestCaseResult[];
  repairModel: string;
  repairMode: string;
  repairLatencyMs: number;
  repairSizeKb: string;
  usedFallbackCopy: boolean;
  repairedPassed: boolean;
  repairedResults: ToolTestCaseResult[];
  finalNotice: string;
}

export function DevDiagnosticsPage({ report, onBack }: DevDiagnosticsPageProps) {
  const [testing, setTesting] = useState(false);
  const [connReport, setConnReport] = useState<ConnectionTestReport | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  const [gwTesting, setGwTesting] = useState(false);
  const [gwReport, setGwReport] = useState<GatewayTestReport | null>(null);

  const [repairTesting, setRepairTesting] = useState(false);
  const [repairReport, setRepairReport] = useState<BrokenToolRepairReport | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const handleRunConnectionTests = async () => {
    setTesting(true);
    setConnError(null);
    try {
      const res = await fetch('/api/dev/connection-test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setConnError(data.error ?? `HTTP ${res.status}`);
      } else {
        setConnReport(data as ConnectionTestReport);
      }
    } catch (err) {
      setConnError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleRunGatewayTests = async () => {
    setGwTesting(true);
    try {
      const res = await fetch('/api/dev/gateway-test', { method: 'POST' });
      if (res.ok) {
        setGwReport((await res.json()) as GatewayTestReport);
      }
    } finally {
      setGwTesting(false);
    }
  };

  const handleRunBrokenToolTest = async () => {
    setRepairTesting(true);
    setRepairError(null);
    try {
      const res = await fetch('/api/dev/broken-tool-test', { method: 'POST' });
      const data = (await res.json()) as {
        ok: boolean;
        brokenHtml: string;
        rows: RefundRecord[];
        requirement: BuilderRequirement;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setRepairError(data.error ?? `HTTP ${res.status}`);
        return;
      }

      const initialSuite = await runSandboxedToolTests(data.brokenHtml, data.rows);
      const repairRes = await fetch('/api/builder/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: report.seed,
          dayIndex: 63,
          requirement: data.requirement,
          brokenHtml: data.brokenHtml,
          failureReasons: initialSuite.failureReasons,
        }),
      });
      const repairData = await repairRes.json();
      if (!repairRes.ok || !repairData.ok) {
        setRepairError(repairData.error ?? `HTTP ${repairRes.status}`);
        return;
      }

      const r = repairData.repairResult as {
        html: string;
        model: string;
        mode: string;
        latencyMs: number;
        byteSize: number;
        usedFallbackCopy: boolean;
      };
      const repairedSuite = await runSandboxedToolTests(r.html, data.rows);

      setRepairReport({
        initialPassed: initialSuite.allPassed,
        initialResults: initialSuite.results,
        repairModel: r.model,
        repairMode: r.mode,
        repairLatencyMs: r.latencyMs,
        repairSizeKb: (r.byteSize / 1024).toFixed(1),
        usedFallbackCopy: r.usedFallbackCopy,
        repairedPassed: repairedSuite.allPassed,
        repairedResults: repairedSuite.results,
        finalNotice: repairedSuite.allPassed
          ? 'Broken draft caught by sandbox tests, repaired once, and all 3 checks passed.'
          : 'I could not build this to standard. Here is what failed.',
      });
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairTesting(false);
    }
  };

  const handleSaveRecordedRun = () => {
    const a = document.createElement('a');
    a.href = '/api/recorded-run/export';
    a.download = 'recorded_run.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#171717] px-4 py-8 sm:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4 pb-5 border-b border-[#E6E1D8]">
          <div>
            <p className="text-xs font-mono text-[#78716C]">
              Developer verification · Seed {report.seed}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-[#171717]">
              Gemini Connection Tests &amp; Live Window Timeline
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveRecordedRun}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#312E81] hover:bg-[#26236B] text-white rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save this run</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-[#E6E1D8] rounded-lg hover:bg-[#F3F0EA] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to clock</span>
            </button>
          </div>
        </div>

        {/* Stage 2 Connection Test Panel */}
        <section
          aria-labelledby="connection-test-heading"
          className="mt-6 bg-white border border-[#E6E1D8] rounded-xl p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="connection-test-heading" className="text-base font-semibold text-[#171717]">
                Gemini Connection Test (v1beta · Decisions, Interactions &amp; Code Execution)
              </h2>
              <p className="mt-1 text-xs text-[#57534E]">
                Runs one tiny real call for each job in settings: Decisions API, function calling on
                large &amp; routine models, structured JSON output, and Python code execution.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunConnectionTests}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{testing ? 'Running live calls...' : 'Run connection test'}</span>
            </button>
          </div>

          {connError && (
            <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-mono text-[#991B1B] whitespace-pre-wrap">
              Request error: {connError}
            </div>
          )}

          {connReport && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E] pb-2 border-b border-[#F3F0EA]">
                <span>
                  API key on server:{' '}
                  <strong className="text-[#171717]">
                    {connReport.hasApiKey ? 'Configured' : 'Missing (GEMINI_API_KEY unset)'}
                  </strong>
                </span>
                <span className="font-mono text-[#78716C]">{connReport.timestamp}</span>
              </div>

              {connReport.results.map((r) => (
                <div
                  key={r.job}
                  className="p-3.5 rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] space-y-2"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#171717]">{r.label}</p>
                      <p className="text-xs font-mono text-[#78716C]">
                        First choice: {r.firstChoiceModel} · Answered by:{' '}
                        <span className="text-[#171717] font-medium">
                          {r.answeredModel ?? 'none'}
                        </span>
                        {r.usedFallback ? ' (fallback)' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                      <span className="text-[#57534E]">{r.latencyMs} ms</span>
                      {r.ok && !r.usedFallback ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#15803D]">
                          <Check className="w-3.5 h-3.5" />
                          First choice OK
                        </span>
                      ) : r.ok ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#B45309]">
                          <Check className="w-3.5 h-3.5" />
                          Fallback OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#991B1B]">
                          <X className="w-3.5 h-3.5" />
                          Failed
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-[#57534E]">{r.detail}</p>

                  {r.attempts.some((a) => !a.ok) && (
                    <div className="mt-2 space-y-1">
                      {r.attempts.map((a, idx) => (
                        <div
                          key={`${r.job}:${a.model}:${idx}`}
                          className="text-[11px] font-mono p-2 rounded bg-white border border-[#E6E1D8] text-[#171717] whitespace-pre-wrap break-all"
                        >
                          <span className="font-semibold">{a.model}</span> ({a.latencyMs} ms):{' '}
                          {a.ok ? 'OK' : a.errorText}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Stage 3 Gateway Forbidden-Actions Self-Test Panel */}
        <section
          aria-labelledby="gateway-test-heading"
          className="mt-6 bg-white border border-[#E6E1D8] rounded-xl p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="gateway-test-heading" className="text-base font-semibold text-[#171717]">
                Action Gateway Limits Check
              </h2>
              <p className="mt-1 text-xs text-[#57534E]">
                Attempts 3 forbidden actions (donor left at 2 weeks cover, 900-unit transfer with no
                approval, and direct stock bypass) and verifies every one is refused and logged.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunGatewayTests}
              disabled={gwTesting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{gwTesting ? 'Running...' : 'Run gateway limits test'}</span>
            </button>
          </div>

          {gwReport && (
            <div className="mt-4 space-y-2">
              {gwReport.cases.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[#171717]">{c.label}</p>
                    <p className="mt-0.5 text-[#57534E]">{c.reason}</p>
                  </div>
                  <span
                    className={`font-mono font-semibold shrink-0 ${
                      c.refusedAsExpected ? 'text-[#15803D]' : 'text-[#991B1B]'
                    }`}
                  >
                    {c.refusedAsExpected ? 'Refused' : 'Allowed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Stage 4 Broken-Tool & Single Repair Check Panel */}
        <section
          aria-labelledby="broken-tool-test-heading"
          className="mt-6 bg-white border border-[#E6E1D8] rounded-xl p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 id="broken-tool-test-heading" className="text-base font-semibold text-[#171717]">
                Check 5: Broken Tool + Single Repair Gate
              </h2>
              <p className="mt-1 text-xs text-[#57534E]">
                Runs a deliberately broken Refund exceptions desk draft inside{' '}
                <code>&lt;iframe sandbox=&quot;allow-scripts&quot;&gt;</code>, verifies the 3
                checks catch its math/interaction bugs, asks Gemini to repair once, and re-tests.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunBrokenToolTest}
              disabled={repairTesting}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{repairTesting ? 'Testing & repairing...' : 'Run broken-tool repair test'}</span>
            </button>
          </div>

          {repairError && (
            <div className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-mono text-[#991B1B]">
              {repairError}
            </div>
          )}

          {repairReport && (
            <div className="mt-4 space-y-3 text-xs">
              <div className="p-3 rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] space-y-1.5">
                <p className="font-semibold text-[#171717]">
                  Step 1 · Deliberately broken draft:{' '}
                  <span className={repairReport.initialPassed ? 'text-[#B45309]' : 'text-[#15803D]'}>
                    {repairReport.initialPassed ? 'Unexpectedly passed' : 'Caught as broken'}
                  </span>
                </p>
                <ul className="space-y-1">
                  {repairReport.initialResults.map((r) => (
                    <li key={`init-${r.id}`} className="text-[#57534E]">
                      <span className={r.passed ? 'text-[#15803D]' : 'text-[#991B1B] font-medium'}>
                        {r.passed ? 'passed' : 'failed'}
                      </span>{' '}
                      · {r.label} — {r.detail}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-lg border border-[#E6E1D8] bg-[#FAF8F5] space-y-1.5">
                <p className="font-semibold text-[#171717]">
                  Step 2 · Single repair ({repairReport.repairModel}, {repairReport.repairMode},{' '}
                  {repairReport.repairLatencyMs} ms, {repairReport.repairSizeKb} KB
                  {repairReport.usedFallbackCopy ? ' · Fallback copy, not built live.' : ''}):{' '}
                  <span className={repairReport.repairedPassed ? 'text-[#15803D]' : 'text-[#991B1B]'}>
                    {repairReport.finalNotice}
                  </span>
                </p>
                <ul className="space-y-1">
                  {repairReport.repairedResults.map((r) => (
                    <li key={`rep-${r.id}`} className="text-[#57534E]">
                      <span className={r.passed ? 'text-[#15803D] font-medium' : 'text-[#991B1B] font-medium'}>
                        {r.passed ? 'passed' : 'failed'}
                      </span>{' '}
                      · {r.label} — {r.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <div className="mt-6 bg-white border border-[#E6E1D8] rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E6E1D8] bg-[#F3F0EA]/60 text-xs font-semibold text-[#57534E]">
                <th className="py-3 px-4">Event</th>
                <th className="py-3 px-4">Target (2026)</th>
                <th className="py-3 px-4">Actual first date</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E1D8]">
              {report.targets.map((t) => (
                <tr key={t.key} className="hover:bg-[#FAF8F5]">
                  <td className="py-3 px-4">
                    <p className="font-medium text-[#171717]">{t.label}</p>
                    <p className="text-xs text-[#78716C] mt-0.5">{t.detail}</p>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-[#57534E] whitespace-nowrap">
                    {t.targetWindow}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#171717]">
                    {t.actualDate ?? 'Not triggered'}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    {t.withinFiveDays ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">
                        <Check className="w-3.5 h-3.5" />
                        Within 5d
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#B45309]">
                        <X className="w-3.5 h-3.5" />
                        Missed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 bg-white border border-[#E6E1D8] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[#171717]">
              Mid-October divergence check ({report.midOctoberCheck.date}, no action taken)
            </h2>
            <p className="mt-1 text-sm text-[#57534E]">
              Like-for-like sales are{' '}
              <span className="font-mono tabular-nums font-semibold text-[#171717]">
                {report.midOctoberCheck.lflPointsBelowExpectation} points
              </span>{' '}
              below expectation (target 10 to 20 points), while total all-store 28-day sales vs last year are{' '}
              <span className="font-mono tabular-nums font-semibold text-[#171717]">
                +{report.midOctoberCheck.total28dVsLastYearPct}%
              </span>{' '}
              (target &gt; 0%).
            </p>
          </div>
          <span
            className={`text-sm font-semibold ${
              report.midOctoberCheck.passed ? 'text-[#15803D]' : 'text-[#B45309]'
            }`}
          >
            {report.midOctoberCheck.passed ? 'Passed' : 'Failed'}
          </span>
        </div>
      </div>
    </div>
  );
}
