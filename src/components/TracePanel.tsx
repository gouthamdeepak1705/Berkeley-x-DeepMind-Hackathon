import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
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
  geminiMode?: 'replay' | 'live';
  capBanner?: string | null;
  recordedCount?: number;
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
  geminiMode: 'replay' | 'live';
  capBanner?: string | null;
  switchingMode?: boolean;
  inDrawer?: boolean;
  onChangeGeminiMode: (mode: 'replay' | 'live') => void;
  onCloseDrawer?: () => void;
  onInspectFact: (fact: Fact) => void;
}

function formatSeconds(ms?: number): string {
  if (typeof ms !== 'number' || ms <= 0) return '0.1 seconds';
  return `${Math.max(0.1, ms / 1000).toFixed(1)} seconds`;
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
    <span
      className={`inline-block shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-mono rounded border ${styles}`}
    >
      {label}
    </span>
  );
}

function summarizeManagerEntry(entry: TraceEntry): string {
  const modelName = entry.meta?.model ?? 'Gemini Decision';
  const sec = entry.meta?.latencyMs !== undefined ? `, ${formatSeconds(entry.meta.latencyMs)}` : '';
  if (entry.kind === 'decision' && entry.decisionRows && entry.decisionRows.length > 0) {
    const raised = entry.decisionRows.filter((r) => r.choice === 'raise_now');
    const top = raised[0] ?? entry.decisionRows[0];
    const pct = Math.round((top?.confidence ?? 0.5) * 100);
    if (raised.length > 0) {
      return `${modelName}: raise ${raised[0].title}, ${pct}% sure${sec}`;
    }
    const watching = entry.decisionRows.some((r) => r.choice === 'keep_watching');
    return `${modelName}: ${watching ? 'keep watching' : 'stay quiet'}, ${pct}% sure${sec}`;
  }
  return entry.headline;
}

function summarizeDsEntry(entry: TraceEntry): string {
  const modelName = entry.meta?.model;
  const isRoutine = entry.detail.toLowerCase().includes('routine kind, fast model');
  const sec = entry.meta?.latencyMs !== undefined ? `, ${formatSeconds(entry.meta.latencyMs)}` : '';
  if (entry.kind === 'investigation' && modelName) {
    const tag = isRoutine ? ' · routine kind, fast model' : '';
    return `${modelName}${tag}: checked the calendar, store mix, and data${sec}`;
  }
  if (modelName) {
    return `${modelName}: ${entry.headline}${sec}`;
  }
  return entry.headline;
}

function summarizeDevEntry(entry: TraceEntry): string {
  const modelName = entry.meta?.model;
  if (modelName) {
    return `${modelName}: ${entry.headline}`;
  }
  return entry.headline;
}

export function TracePanel({
  trace,
  telemetry,
  geminiMode,
  capBanner,
  switchingMode = false,
  inDrawer = false,
  onChangeGeminiMode,
  onCloseDrawer,
  onInspectFact,
}: TracePanelProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const toggleRow = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const managerEntries = trace.filter((t) => t.lane === 'manager');
  const dsEntries = trace.filter((t) => t.lane === 'data_scientist');
  const devEntries = trace.filter((t) => t.lane === 'developer');

  return (
    <aside
      aria-label="Behind the screen live trace"
      className={inDrawer ? 'flex flex-col' : 'hidden lg:flex flex-col'}
    >
      <div className="pb-4 border-b border-[#E6E1D8] flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-[#171717]">
            Behind the screen
          </h2>
          <p className="mt-0.5 text-xs text-[#78716C]">
            How OpsCien decides, checks its work, and builds tools. Tap any line for detail.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Gemini playback mode"
            className="inline-flex items-center p-0.5 bg-[#F3F0EA] rounded-lg border border-[#E6E1D8]"
          >
            <button
              type="button"
              disabled={switchingMode}
              onClick={() => onChangeGeminiMode('replay')}
              aria-pressed={geminiMode === 'replay'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                geminiMode === 'replay'
                  ? 'bg-white text-[#312E81] shadow-xs font-semibold'
                  : 'text-[#57534E] hover:text-[#171717]'
              }`}
            >
              Recorded, live when needed
            </button>
            <button
              type="button"
              disabled={switchingMode}
              onClick={() => onChangeGeminiMode('live')}
              aria-pressed={geminiMode === 'live'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                geminiMode === 'live'
                  ? 'bg-white text-[#15803D] shadow-xs font-semibold'
                  : 'text-[#57534E] hover:text-[#171717]'
              }`}
            >
              Always live
            </button>
          </div>

          {inDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              aria-label="Close behind the screen panel"
              className="p-1.5 rounded-lg border border-[#E6E1D8] bg-white hover:bg-[#F3F0EA] text-[#57534E] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {capBanner && (
        <div
          role="status"
          className="mt-3 px-3 py-2 rounded-lg bg-[#FEF3C7] border border-[#FDE68A] text-xs text-[#92400E] font-medium"
        >
          {capBanner}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {/* Lane 1: Manager */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="pb-3 border-b border-[#E6E1D8]">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#171717]">Manager</h3>
              <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
                {managerEntries.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#78716C]">
              Decides every day what to raise and what to let go.
            </p>
          </div>

          {managerEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-2.5 space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {managerEntries.map((entry) => {
                const open = !!expandedIds[entry.id];
                const oneLine = summarizeManagerEntry(entry);
                return (
                  <li
                    key={entry.id}
                    className="pb-2 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => toggleRow(entry.id)}
                      aria-expanded={open}
                      className="w-full text-left flex items-start justify-between gap-2 hover:text-[#312E81] cursor-pointer"
                    >
                      <span className="flex items-start gap-1 min-w-0">
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        )}
                        <span
                          className={`leading-snug ${
                            entry.outcome === 'raised'
                              ? 'text-[#B45309] font-medium'
                              : 'text-[#171717]'
                          }`}
                        >
                          {oneLine}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-[#78716C] shrink-0 mt-0.5">
                        {formatShortDate(entry.date)}
                      </span>
                    </button>

                    {open && (
                      <div className="mt-1.5 pl-4 space-y-1.5 text-[11px] text-[#57534E]">
                        {entry.meta && (entry.meta.model || entry.meta.mode) && (
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[#78716C]">
                            {entry.meta.model && <span>{entry.meta.model}</span>}
                            <ModeTag mode={entry.meta.mode} />
                          </div>
                        )}
                        <p className="leading-relaxed">{entry.detail}</p>
                        {entry.decisionRows && entry.decisionRows.length > 0 && (
                          <ul className="space-y-1 bg-[#FAF8F5] border border-[#F3F0EA] rounded p-2">
                            {entry.decisionRows.map((row) => (
                              <li
                                key={row.candidateId}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="text-[#171717] truncate">{row.title}</span>
                                <span className="font-mono text-[10px] text-[#78716C] shrink-0">
                                  {row.choice.replace(/_/g, ' ')} ({Math.round(row.confidence * 100)}%)
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {entry.facts && entry.facts.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {entry.facts.map((f) => (
                              <span key={f.id}>
                                {f.label}: <FactValue fact={f} onInspect={onInspectFact} />
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Lane 2: Data scientist */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="pb-3 border-b border-[#E6E1D8]">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#171717]">Data scientist</h3>
              <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
                {dsEntries.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#78716C]">
              Checks the cause, runs numbers two ways, and plans safe moves.
            </p>
          </div>

          {dsEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-2.5 space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {dsEntries.map((entry) => {
                const open = !!expandedIds[entry.id];
                const oneLine = summarizeDsEntry(entry);
                return (
                  <li
                    key={entry.id}
                    className="pb-2 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => toggleRow(entry.id)}
                      aria-expanded={open}
                      className="w-full text-left flex items-start justify-between gap-2 hover:text-[#312E81] cursor-pointer"
                    >
                      <span className="flex items-start gap-1 min-w-0">
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        )}
                        <span className="text-[#171717] leading-snug">{oneLine}</span>
                      </span>
                      <span className="font-mono text-[10px] text-[#78716C] shrink-0 mt-0.5">
                        {formatShortDate(entry.date)}
                      </span>
                    </button>

                    {open && (
                      <div className="mt-1.5 pl-4 space-y-1.5 text-[11px] text-[#57534E]">
                        {entry.meta && (entry.meta.model || entry.meta.mode) && (
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[#78716C]">
                            {entry.meta.model && <span>{entry.meta.model}</span>}
                            <ModeTag mode={entry.meta.mode} />
                          </div>
                        )}
                        <p className="leading-relaxed">{entry.detail}</p>
                        {entry.facts && entry.facts.length > 0 && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {entry.facts.map((f) => (
                              <span key={f.id}>
                                {f.label}: <FactValue fact={f} onInspect={onInspectFact} />
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Lane 3: Developer */}
        <div className="bg-white border border-[#E6E1D8] rounded-xl p-4">
          <div className="pb-3 border-b border-[#E6E1D8]">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-[#171717]">Developer</h3>
              <span className="text-[11px] font-mono tabular-nums text-[#78716C]">
                {telemetry
                  ? `${telemetry.liveCalls} live · ${telemetry.replayedCalls} replayed`
                  : devEntries.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[#78716C]">
              Builds store tools in a sandbox and tracks Gemini calls.
            </p>
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
                <span>Other calls cap:</span>
                <span className="text-[#171717] tabular-nums">
                  {telemetry.uncachedOtherCalls} / {telemetry.otherCap}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Session cost:</span>
                <span className="text-[#171717] tabular-nums">
                  ${telemetry.estimatedCostUsd.toFixed(4)}
                </span>
              </div>
            </div>
          )}

          {(!telemetry || telemetry.recentCalls.length === 0) && devEntries.length === 0 ? (
            <p className="mt-3 text-xs text-[#78716C]">Nothing yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {devEntries.map((entry) => {
                const open = !!expandedIds[entry.id];
                const oneLine = summarizeDevEntry(entry);
                return (
                  <li
                    key={entry.id}
                    className="pb-2 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => toggleRow(entry.id)}
                      aria-expanded={open}
                      className="w-full text-left flex items-start justify-between gap-2 hover:text-[#312E81] cursor-pointer"
                    >
                      <span className="flex items-start gap-1 min-w-0">
                        {open ? (
                          <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#78716C]" />
                        )}
                        <span className="text-[#171717] leading-snug">{oneLine}</span>
                      </span>
                      <span className="font-mono text-[10px] text-[#78716C] shrink-0 mt-0.5">
                        {formatShortDate(entry.date)}
                      </span>
                    </button>

                    {open && (
                      <div className="mt-1.5 pl-4 space-y-1 text-[11px] text-[#57534E]">
                        {entry.meta && (entry.meta.model || entry.meta.mode) && (
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[#78716C]">
                            {entry.meta.model && <span>{entry.meta.model}</span>}
                            <ModeTag mode={entry.meta.mode} />
                          </div>
                        )}
                        <p className="leading-relaxed">{entry.detail}</p>
                      </div>
                    )}
                  </li>
                );
              })}

              {(telemetry?.recentCalls ?? []).map((call) => {
                const open = !!expandedIds[call.id];
                return (
                  <li
                    key={call.id}
                    className="pb-2 border-b border-[#F3F0EA] last:border-b-0 last:pb-0 text-[11px]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleRow(call.id)}
                      aria-expanded={open}
                      className="w-full text-left flex flex-wrap items-center justify-between gap-x-2 gap-y-1 hover:text-[#312E81] cursor-pointer"
                    >
                      <span className="flex items-center gap-1 min-w-0">
                        {open ? (
                          <ChevronDown className="w-3 h-3 shrink-0 text-[#78716C]" />
                        ) : (
                          <ChevronRight className="w-3 h-3 shrink-0 text-[#78716C]" />
                        )}
                        <span className="font-mono font-medium text-[#171717]">
                          {call.model}: {formatSeconds(call.latencyMs)}
                        </span>
                      </span>
                      <ModeTag mode={call.mode} />
                    </button>

                    {open && (
                      <div className="mt-1 pl-4 font-mono text-[10px] text-[#78716C] space-y-0.5">
                        <p>{call.feature}</p>
                        <p>
                          in {call.inputTokens} / out {call.outputTokens} · $
                          {call.estimatedCostUsd.toFixed(5)}
                        </p>
                        {call.error && <p className="text-[#B45309] break-words">{call.error}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
