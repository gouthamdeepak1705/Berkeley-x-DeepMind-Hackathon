import { Fact, TraceEntry } from '../types/domain';
import { formatShortDate } from '../engine/calendar';
import { FactValue } from './FactValue';

export interface GeminiTelemetrySnapshot {
  uncachedDecisionCalls: number;
  decisionCap: number;
  uncachedOtherCalls: number;
  otherCap: number;
  liveCalls: number;
  replayedCalls: number;
  fallbackCalls: number;
  estimatedCostUsd: number;
  recentCalls: Array<{
    id: string;
    feature: string;
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    mode: 'live' | 'replayed' | 'fallback';
    estimatedCostUsd: number;
    error?: string;
  }>;
}

interface TracePanelProps {
  trace: TraceEntry[];
  telemetry?: GeminiTelemetrySnapshot | null;
  onInspectFact: (fact: Fact) => void;
  onOpenDevPage: () => void;
}

function ModeTag({ mode }: { mode?: 'live' | 'replayed' | 'fallback' }) {
  if (!mode) return null;
  const styles =
    mode === 'replayed'
      ? 'bg-[#EEF2FF] text-[#312E81] border-[#C7D2FE]'
      : mode === 'fallback'
        ? 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]'
        : 'bg-[#ECFDF5] text-[#15803D] border-[#BBF7D0]';
  const label = mode === 'fallback' ? 'fallback, Gemini not used' : mode;
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border ${styles}`}>
      {label}
    </span>
  );
}

function DecisionChoiceTag({ choice }: { choice: 'raise_now' | 'keep_watching' | 'stay_quiet' }) {
  const styles =
    choice === 'raise_now'
      ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
      : choice === 'keep_watching'
        ? 'bg-[#EEF2FF] text-[#312E81] border-[#C7D2FE]'
        : 'bg-[#F3F0EA] text-[#57534E] border-[#E6E1D8]';
  const label =
    choice === 'raise_now'
      ? 'raise'
      : choice === 'keep_watching'
        ? 'keep watching'
        : 'stay quiet';
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-mono rounded border ${styles}`}>
      {label}
    </span>
  );
}

export function TracePanel({ trace, telemetry, onInspectFact, onOpenDevPage }: TracePanelProps) {
  const managerEntries = trace.filter((t) => t.lane === 'manager');
  const dsEntries = trace.filter((t) => t.lane === 'data_scientist');
  const devEntries = trace.filter((t) => t.lane === 'developer');

  return (
    <aside aria-label="Behind the screen live trace" className="hidden lg:flex flex-col">
      <div className="pb-4 border-b border-[#E6E1D8] flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-[#171717]">
            Behind the screen
          </h2>
          <p className="mt-0.5 text-xs text-[#78716C]">
            Live instinct decisions, data scientist checks, and developer telemetry
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDevPage}
          className="text-xs font-mono text-[#312E81] hover:underline underline-offset-4 shrink-0 cursor-pointer"
        >
          Connection &amp; timeline check
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {/* Lane 1: Manager */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="flex items-baseline justify-between pb-3 border-b border-[#E6E1D8]">
            <h3 className="text-xs font-semibold text-[#171717]">Manager</h3>
            <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
              {managerEntries.length} events
            </span>
          </div>

          {managerEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-3 max-h-[620px] overflow-y-auto pr-1">
              {managerEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="pb-3 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`font-semibold ${
                        entry.outcome === 'raised'
                          ? 'text-[#B45309]'
                          : entry.outcome === 'let_go'
                            ? 'text-[#57534E]'
                            : 'text-[#171717]'
                      }`}
                    >
                      {entry.headline}
                    </span>
                    <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                      {formatShortDate(entry.date)}
                    </span>
                  </div>
                  {entry.meta && (entry.meta.model || entry.meta.mode) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#78716C]">
                      {entry.meta.model && <span>{entry.meta.model}</span>}
                      <ModeTag mode={entry.meta.mode} />
                      {typeof entry.meta.latencyMs === 'number' && (
                        <span>
                          {entry.meta.latencyMs} ms
                          {entry.meta.mode === 'replayed' ? ' (replayed)' : ''}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-[#57534E] leading-relaxed">{entry.detail}</p>

                  {entry.decisionRows && entry.decisionRows.length > 0 && (
                    <ul className="mt-2 space-y-1.5 bg-[#FAF8F5] border border-[#F3F0EA] rounded-lg p-2">
                      {entry.decisionRows.map((row) => (
                        <li
                          key={row.candidateId}
                          className="flex flex-col gap-0.5 text-[11px] pb-1 border-b border-[#E6E1D8] last:border-b-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-[#171717] truncate">
                              {row.title}
                            </span>
                            <DecisionChoiceTag choice={row.choice} />
                          </div>
                          <span className="font-mono text-[10px] text-[#78716C] tabular-nums">
                            conf {row.confidence.toFixed(2)} · explained{' '}
                            {row.explainedProb.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {entry.facts && entry.facts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#78716C]">
                      {entry.facts.map((f) => (
                        <span key={f.id}>
                          {f.label}: <FactValue fact={f} onInspect={onInspectFact} />
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lane 2: Data scientist */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="flex items-baseline justify-between pb-3 border-b border-[#E6E1D8]">
            <h3 className="text-xs font-semibold text-[#171717]">Data scientist</h3>
            <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
              {dsEntries.length} events
            </span>
          </div>
          {dsEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-3 max-h-[620px] overflow-y-auto pr-1">
              {dsEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="pb-3 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#171717]">{entry.headline}</span>
                    <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                      {formatShortDate(entry.date)}
                    </span>
                  </div>
                  {entry.meta && (entry.meta.model || entry.meta.mode) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#78716C]">
                      {entry.meta.model && <span>{entry.meta.model}</span>}
                      <ModeTag mode={entry.meta.mode} />
                      {typeof entry.meta.latencyMs === 'number' && (
                        <span>
                          {entry.meta.latencyMs} ms
                          {entry.meta.mode === 'replayed' ? ' (replayed)' : ''}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-[#57534E] leading-relaxed">{entry.detail}</p>
                  {entry.facts && entry.facts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#78716C]">
                      {entry.facts.map((f) => (
                        <span key={f.id}>
                          {f.label}: <FactValue fact={f} onInspect={onInspectFact} />
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Lane 3: Developer */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="flex items-baseline justify-between pb-3 border-b border-[#E6E1D8]">
            <h3 className="text-xs font-semibold text-[#171717]">Developer</h3>
            <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
              {telemetry
                ? `${telemetry.liveCalls} live · ${telemetry.replayedCalls} replayed`
                : `${devEntries.length} events`}
            </span>
          </div>

          {telemetry && (
            <div className="mt-3 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8] text-[11px] font-mono text-[#57534E] space-y-1">
              <div className="flex justify-between">
                <span>Decisions cap:</span>
                <span className="text-[#171717] tabular-nums">
                  {telemetry.uncachedDecisionCalls} / {telemetry.decisionCap}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Interactions cap:</span>
                <span className="text-[#171717] tabular-nums">
                  {telemetry.uncachedOtherCalls} / {telemetry.otherCap}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Est. cost (session):</span>
                <span className="text-[#171717] tabular-nums">
                  ${telemetry.estimatedCostUsd.toFixed(4)}
                </span>
              </div>
            </div>
          )}

          {(!telemetry || telemetry.recentCalls.length === 0) && devEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {(telemetry?.recentCalls ?? []).map((call) => (
                <li
                  key={call.id}
                  className="pb-2.5 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-[11px]"
                >
                  <div className="flex items-baseline justify-between gap-2 font-mono">
                    <span className="font-semibold text-[#171717] truncate">{call.model}</span>
                    <ModeTag mode={call.mode} />
                  </div>
                  <p className="mt-0.5 text-[#57534E] font-mono truncate">{call.feature}</p>
                  <p className="mt-0.5 text-[#78716C] font-mono tabular-nums">
                    {call.latencyMs} ms · in {call.inputTokens} / out {call.outputTokens} · $
                    {call.estimatedCostUsd.toFixed(5)}
                  </p>
                  {call.error && (
                    <p className="mt-0.5 text-[#B45309] break-words">{call.error}</p>
                  )}
                </li>
              ))}
              {devEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="pb-2.5 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[#171717]">{entry.headline}</span>
                    <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                      {formatShortDate(entry.date)}
                    </span>
                  </div>
                  <p className="mt-1 text-[#57534E] leading-relaxed">{entry.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
