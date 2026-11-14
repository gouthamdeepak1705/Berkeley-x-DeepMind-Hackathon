import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { DayState, DismissReason, Fact, TextSegment } from '../types/domain';
import { formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { FactValue } from './FactValue';

export interface ActiveInvestigationBanner {
  situationId: string;
  title: string;
  headline: string;
  steps: string[];
}

interface OwnerFeedProps {
  dayState: DayState;
  activeInvestigation?: ActiveInvestigationBanner | null;
  actionBusyId?: string | null;
  onInspectFact: (fact: Fact) => void;
  onApproveCard?: (candidateId: string) => void;
  onNotNowCard?: (candidateId: string) => void;
  onDismissCard?: (candidateId: string, reason: DismissReason) => void;
  onLookAgainCard?: (candidateId: string) => void;
}

const DISMISS_REASONS: Array<{ value: DismissReason; label: string }> = [
  { value: 'not_important', label: 'Not important' },
  { value: 'already_known', label: 'Already known' },
  { value: 'wrong', label: 'Wrong' },
  { value: 'not_mine', label: 'Not mine' },
];

function renderSegments(segments: TextSegment[], onInspectFact: (fact: Fact) => void) {
  return segments.map((seg, idx) =>
    seg.type === 'text' ? (
      <span key={`seg-t-${idx}`}>{seg.text}</span>
    ) : (
      <FactValue key={`seg-f-${seg.fact.id}-${idx}`} fact={seg.fact} onInspect={onInspectFact} />
    ),
  );
}

export function OwnerFeed({
  dayState,
  activeInvestigation,
  actionBusyId,
  onInspectFact,
  onApproveCard,
  onNotNowCard,
  onDismissCard,
  onLookAgainCard,
}: OwnerFeedProps) {
  const [letGoExpanded, setLetGoExpanded] = useState(false);
  const [openEvidenceIds, setOpenEvidenceIds] = useState<Record<string, boolean>>({});
  const [openLetGoGroupIds, setOpenLetGoGroupIds] = useState<Record<string, boolean>>({});
  const [collapsedCardIds, setCollapsedCardIds] = useState<Record<string, boolean>>({});
  const [dismissPickerId, setDismissPickerId] = useState<string | null>(null);

  const letGoCountFact = createFact(
    `feed:let_go_count:${dayState.date}`,
    'Candidates noticed and let go',
    dayState.noticedAndLetGo.length,
    'count',
    'Detector candidates explained by silence checks or let go by Gemini Decision through this date.',
  );

  const groupedLetGo = dayState.groupedLetGo;
  const visibleLetGo = letGoExpanded ? groupedLetGo : groupedLetGo.slice(0, 5);
  const inProgress = dayState.inProgress ?? [];
  const doneForYou = dayState.doneForYou ?? [];

  const toggleEvidence = (id: string) => {
    setOpenEvidenceIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLetGoGroup = (id: string) => {
    setOpenLetGoGroupIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCard = (id: string) => {
    setCollapsedCardIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mt-6 space-y-6">
      {/* 1. Needs you */}
      <section aria-labelledby="section-needs-you">
        <div className="flex items-baseline justify-between">
          <h2 id="section-needs-you" className="text-sm font-semibold text-[#171717]">
            Needs you
          </h2>
          {dayState.raised.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-[#B45309] font-medium">
              {dayState.raised.length} open
            </span>
          )}
        </div>

        {/* Live investigation checking banner */}
        {activeInvestigation && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 bg-white border border-[#C7D2FE] rounded-xl p-4 space-y-2"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#312E81]">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{activeInvestigation.headline}</span>
            </div>
            {activeInvestigation.steps.length > 0 && (
              <ul className="space-y-1 pl-6 text-xs text-[#57534E] list-disc">
                {activeInvestigation.steps.map((s, idx) => (
                  <li key={`step-${idx}`}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {dayState.raised.length === 0 && !activeInvestigation ? (
          <p className="mt-2 text-sm text-[#57534E]">Nothing needs you today.</p>
        ) : dayState.raised.length > 0 ? (
          <div className="mt-2 bg-white border border-[#E6E1D8] rounded-xl divide-y divide-[#E6E1D8]">
            {dayState.raised.map((item) => {
              const evOpen = !!openEvidenceIds[item.candidateId];
              const isCardOpen = !collapsedCardIds[item.candidateId];
              const isBusy = actionBusyId === item.candidateId;
              const isDismissOpen = dismissPickerId === item.candidateId;
              const hasToday =
                !!item.todayDate &&
                !!item.todayActual &&
                !!item.todayExpected &&
                !!item.todayStakePerWeek;
              const multiStore = item.stores && item.stores.length > 1;
              const evidenceList = item.evidence ?? [];
              const inv = item.investigation;
              const sc = item.secondCheck ?? inv?.secondCheck;
              const plan = item.transferPlan ?? inv?.transferPlan;
              const checksDisagree = sc?.status === 'disagreed';

              return (
                <div key={item.candidateId} className="p-4" data-card-id={item.candidateId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleCard(item.candidateId)}
                      aria-expanded={isCardOpen}
                      className="text-left flex items-baseline gap-1.5 text-sm font-semibold text-[#B45309] hover:underline cursor-pointer"
                    >
                      <span>{item.title}</span>
                      {isCardOpen ? (
                        <ChevronUp className="w-3.5 h-3.5 shrink-0 translate-y-0.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 shrink-0 translate-y-0.5" />
                      )}
                    </button>
                    <span className="text-xs font-mono text-[#78716C] shrink-0">
                      {formatShortDate(item.firstDetectedOn)}
                    </span>
                  </div>

                  {/* Re-raised notice & cost of delay so far */}
                  {item.reRaisedOn && (
                    <div className="mt-2 p-2.5 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs space-y-1">
                      <p className="text-[#92400E] font-medium">
                        First raised {formatShortDate(item.firstDetectedOn)} · Deferred{' '}
                        {item.deferredOn ? formatShortDate(item.deferredOn) : ''} · Re-raised{' '}
                        {formatShortDate(item.reRaisedOn)} ({item.reRaiseReason})
                      </p>
                      {item.costOfDelayFact && (
                        <p className="text-[#171717]">
                          Cost of delay so far:{' '}
                          <FactValue fact={item.costOfDelayFact} onInspect={onInspectFact} />
                        </p>
                      )}
                    </div>
                  )}

                  {/* Rollout summary or Investigation Finding */}
                  {item.isRollout ? (
                    <p className="mt-2 text-sm text-[#171717] leading-relaxed">{item.summary}</p>
                  ) : inv ? (
                    <p className="mt-2 text-sm text-[#171717] leading-relaxed">
                      {renderSegments(inv.findingSegments, onInspectFact)}
                    </p>
                  ) : null}

                  {/* Expected and actual side by side */}
                  <div className="mt-2.5 grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#F3F0EA] text-xs">
                    <div>
                      <p className="text-[11px] text-[#78716C]">Expected</p>
                      <p className="mt-0.5 font-medium text-[#171717]">
                        <FactValue fact={item.expected} onInspect={onInspectFact} />
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#78716C]">
                        Actual ({formatShortDate(item.firstDetectedOn)})
                      </p>
                      <p className="mt-0.5 font-medium text-[#171717]">
                        <FactValue fact={item.actual} onInspect={onInspectFact} />
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#78716C]">At stake / wk</p>
                      <p className="mt-0.5 font-medium text-[#171717]">
                        <FactValue fact={item.stakePerWeek} onInspect={onInspectFact} />
                      </p>
                    </div>
                  </div>

                  {/* Separate Today figures when still open on a later day */}
                  {hasToday && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#171717]">
                      <span className="font-medium text-[#57534E]">
                        Today ({formatShortDate(item.todayDate!)}):
                      </span>
                      <span>
                        Actual: <FactValue fact={item.todayActual!} onInspect={onInspectFact} />
                      </span>
                      <span>
                        Expected:{' '}
                        <FactValue fact={item.todayExpected!} onInspect={onInspectFact} />
                      </span>
                      <span>
                        At stake / wk:{' '}
                        <FactValue fact={item.todayStakePerWeek!} onInspect={onInspectFact} />
                      </span>
                    </div>
                  )}

                  {/* Second Check status pill (plain text status row) */}
                  {sc && (
                    <div
                      className={`mt-2 px-2.5 py-1.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                        sc.status === 'matched'
                          ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                          : sc.status === 'disagreed'
                            ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                            : 'bg-[#FAF8F5] border-[#E6E1D8] text-[#57534E]'
                      }`}
                    >
                      <span className="font-medium">{sc.label}</span>
                      {sc.secondValueFact && (
                        <span className="font-mono text-[11px]">
                          Code: <FactValue fact={sc.firstValueFact} onInspect={onInspectFact} /> ·
                          Python: <FactValue fact={sc.secondValueFact} onInspect={onInspectFact} />
                        </span>
                      )}
                    </div>
                  )}

                  {isCardOpen && (
                    <>
                      {/* Per-store breakdown for multi-store stock situations */}
                      {multiStore && item.stores && (
                        <ul className="mt-2.5 pt-2 border-t border-[#F3F0EA] space-y-1 text-xs text-[#57534E]">
                          {item.stores.map((st) => (
                            <li
                              key={st.storeId}
                              className="flex items-baseline justify-between gap-2"
                            >
                              <span className="font-medium text-[#171717]">{st.storeName}</span>
                              <span className="text-right">
                                First ({formatShortDate(st.firstDetectedOn)}):{' '}
                                <FactValue fact={st.initialActual} onInspect={onInspectFact} />
                                {st.todayActual && (
                                  <>
                                    {' · '}Today:{' '}
                                    <FactValue fact={st.todayActual} onInspect={onInspectFact} />
                                  </>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Investigation details: Ruled out, Cause, Options, Outcome (single paragraph) */}
                      {inv && !item.isRollout && (
                        <div className="mt-3 pt-3 border-t border-[#F3F0EA] space-y-3 text-xs">
                          {/* Ruled out */}
                          <div>
                            <p className="font-semibold text-[#57534E]">Ruled out</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {inv.ruledOut.map((ro) => (
                                <li key={ro.kind} className="flex items-start gap-1.5 text-[#57534E]">
                                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-0.5" />
                                  <span>
                                    {ro.summarySegments && ro.summarySegments.length > 0
                                      ? renderSegments(ro.summarySegments, onInspectFact)
                                      : ro.summary}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Cause */}
                          <div>
                            <p className="font-semibold text-[#57534E]">Cause</p>
                            <p className="mt-1 text-[#171717] leading-relaxed">
                              {renderSegments(inv.causeSegments, onInspectFact)}
                            </p>
                          </div>

                          {/* Options */}
                          <div>
                            <p className="font-semibold text-[#57534E]">Options</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {inv.options.map((opt) => (
                                <li
                                  key={opt.id}
                                  className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]"
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-medium text-[#171717]">{opt.label}</span>
                                    {opt.weeklyEffectFact && (
                                      <span className="font-mono text-[11px] shrink-0">
                                        <FactValue
                                          fact={opt.weeklyEffectFact}
                                          onInspect={onInspectFact}
                                        />
                                        /wk
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[#57534E]">{opt.description}</p>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Outcome (one paragraph only) */}
                          <div>
                            <p className="font-semibold text-[#57534E]">Outcome</p>
                            <p className="mt-1 text-[#171717] leading-relaxed">
                              {renderSegments(inv.proposalSegments, onInspectFact)}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Exact Transfer Plan preview & Gateway limits */}
                      {plan && (
                        <div className="mt-3 p-3 rounded-lg bg-[#F5F7FF] border border-[#C7D2FE] text-xs space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-[#312E81]">
                              Planned action ({plan.transferLines.length} transfer
                              {plan.transferLines.length === 1 ? '' : 's'})
                            </span>
                            <span className="font-mono text-[11px] text-[#312E81]">
                              Arrives {formatShortDate(plan.arrivalDate)}
                            </span>
                          </div>
                          <p className="text-[#171717]">
                            Move <FactValue fact={plan.totalUnitsFact} onInspect={onInspectFact} />{' '}
                            (worth{' '}
                            <FactValue fact={plan.weeklyRecoveryFact} onInspect={onInspectFact} />
                            /wk):
                          </p>
                          <ul className="space-y-0.5 text-[#57534E]">
                            {plan.transferLines.map((l, idx) => (
                              <li key={`${l.fromStoreId}-${l.toStoreId}-${idx}`}>
                                {l.fromStoreName} → {l.toStoreName}:{' '}
                                <span className="font-mono tabular-nums text-[#171717]">
                                  {l.units} units
                                </span>
                              </li>
                            ))}
                          </ul>
                          {plan.holdoutSentence && (
                            <p className="text-[#312E81] font-medium">{plan.holdoutSentence}</p>
                          )}
                          <p className="text-[#57534E]">{plan.limitSentence}</p>
                          {plan.shortfallUnitsFact && (
                            <p className="text-[#B45309] font-medium">
                              Shortfall:{' '}
                              <FactValue
                                fact={plan.shortfallUnitsFact}
                                onInspect={onInspectFact}
                              />{' '}
                              cannot be covered above donor limits.
                            </p>
                          )}
                          <p className="text-[11px] text-[#57534E] pt-1 border-t border-[#E0E7FF]">
                            Measure: {plan.measure}
                          </p>
                        </div>
                      )}

                      {/* Raised by instinct provenance line (with original latency + replayed) */}
                      {item.instinctMeta && (
                        <p className="mt-3 pt-2 border-t border-[#F3F0EA] text-[11px] font-mono text-[#78716C]">
                          Raised by instinct, confidence{' '}
                          {item.instinctMeta.confidence.toFixed(2)}, decided in{' '}
                          {item.instinctMeta.latencyMs} ms
                          {item.instinctMeta.mode === 'replayed' ? ' (replayed)' : ''} · urgency:{' '}
                          {item.instinctMeta.urgencyLevel}
                          {inv
                            ? ` · checked by ${inv.model} (${inv.mode}, ${inv.latencyMs} ms${inv.mode === 'replayed' ? ' replayed' : ''})`
                            : ''}
                        </p>
                      )}

                      {/* Action Buttons: Approve (or Look again if checks disagree), Not now, Dismiss */}
                      <div className="mt-3 pt-3 border-t border-[#F3F0EA] space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {checksDisagree ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onLookAgainCard?.(item.candidateId)}
                              className="px-3.5 py-1.5 bg-[#B45309] hover:bg-[#92400E] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                            >
                              {isBusy ? 'Rechecking...' : 'Look again'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => onApproveCard?.(item.candidateId)}
                              className="px-3.5 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                            >
                              {isBusy ? 'Working...' : 'Approve'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onNotNowCard?.(item.candidateId)}
                            className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-60 text-[#171717] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Not now
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setDismissPickerId(isDismissOpen ? null : item.candidateId)
                            }
                            className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-60 text-[#57534E] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>

                        {isDismissOpen && (
                          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8] flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-[#57534E] mr-1">Why?</span>
                            {DISMISS_REASONS.map((r) => (
                              <button
                                key={r.value}
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setDismissPickerId(null);
                                  onDismissCard?.(item.candidateId, r.value);
                                }}
                                className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-[#F3F0EA] border border-[#E6E1D8] rounded text-[#171717] cursor-pointer"
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Linked supporting evidence */}
                      {evidenceList.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-[#F3F0EA]">
                          <button
                            type="button"
                            onClick={() => toggleEvidence(item.candidateId)}
                            aria-expanded={evOpen}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#312E81] hover:underline cursor-pointer"
                          >
                            <span>
                              {evOpen
                                ? `Hide supporting evidence (${evidenceList.length})`
                                : `Supporting evidence (${evidenceList.length})`}
                            </span>
                            {evOpen ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {evOpen && (
                            <ul className="mt-2 space-y-2 text-xs text-[#57534E] bg-[#FAF8F5] border border-[#E6E1D8] rounded-lg p-2.5">
                              {evidenceList.map((ev) => (
                                <li key={ev.candidateId} className="space-y-0.5">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-medium text-[#171717]">{ev.title}</span>
                                    <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                                      {formatShortDate(ev.firstDetectedOn)}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    {ev.candidateId.startsWith('chain_total_note:') ? (
                                      <>
                                        <span>
                                          Total 28d YoY:{' '}
                                          <FactValue fact={ev.actual} onInspect={onInspectFact} />
                                        </span>
                                        <span>
                                          LFL 28d vs exp:{' '}
                                          <FactValue fact={ev.expected} onInspect={onInspectFact} />
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span>
                                          Actual:{' '}
                                          <FactValue fact={ev.actual} onInspect={onInspectFact} />
                                        </span>
                                        <span>
                                          Expected:{' '}
                                          <FactValue fact={ev.expected} onInspect={onInspectFact} />
                                        </span>
                                        {ev.todayActual && ev.todayExpected && (
                                          <span className="text-[#171717]">
                                            Today:{' '}
                                            <FactValue
                                              fact={ev.todayActual}
                                              onInspect={onInspectFact}
                                            />{' '}
                                            vs{' '}
                                            <FactValue
                                              fact={ev.todayExpected}
                                              onInspect={onInspectFact}
                                            />
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* 2. In progress (Stage 3: running approved actions before proof closes) */}
      <section aria-labelledby="section-in-progress" className="pt-5 border-t border-[#E6E1D8]">
        <div className="flex items-baseline justify-between">
          <h2 id="section-in-progress" className="text-sm font-semibold text-[#171717]">
            In progress
          </h2>
          {inProgress.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-[#312E81]">
              {inProgress.length} active
            </span>
          )}
        </div>
        {inProgress.length === 0 ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing in progress.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {inProgress.map((act) => (
              <li
                key={act.decisionId}
                className="bg-white border border-[#E6E1D8] rounded-lg px-3.5 py-2.5 text-xs space-y-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[#171717]">{act.title}</span>
                  <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                    Ends {formatShortDate(act.endDate)}
                  </span>
                </div>
                <p className="text-[#57534E]">{act.measure}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#312E81]">
                  <span>{act.statusText}</span>
                  <span className="font-mono text-[#78716C]">{act.nextCheckpoint}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Done for you (proven / closed outcomes) */}
      <section aria-labelledby="section-done-for-you" className="pt-5 border-t border-[#E6E1D8]">
        <h2 id="section-done-for-you" className="text-sm font-semibold text-[#171717]">
          Done for you
        </h2>
        {doneForYou.length === 0 ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {doneForYou.map((item) => (
              <li
                key={item.decisionId}
                className="bg-white border border-[#E6E1D8] rounded-lg px-3.5 py-2.5 text-xs space-y-1"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[#171717]">{item.title}</span>
                  <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                    {formatShortDate(item.closedOn)}
                  </span>
                </div>
                <p
                  className={`font-medium ${
                    item.verdict === 'worked_proven'
                      ? 'text-[#15803D]'
                      : item.verdict === 'did_not_work'
                        ? 'text-[#991B1B]'
                        : 'text-[#57534E]'
                  }`}
                >
                  {item.verdictSentence}
                </p>
                {item.provenMoneyFact && (
                  <p className="text-[#57534E]">
                    Proven gain:{' '}
                    <FactValue fact={item.provenMoneyFact} onInspect={onInspectFact} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Noticed and let go */}
      <section aria-labelledby="section-let-go" className="pt-5 border-t border-[#E6E1D8]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 id="section-let-go" className="text-sm font-semibold text-[#171717]">
              Noticed and let go
            </h2>
            <span className="text-xs text-[#78716C]">
              (<FactValue fact={letGoCountFact} onInspect={onInspectFact} />)
            </span>
          </div>

          {groupedLetGo.length > 5 && (
            <button
              type="button"
              onClick={() => setLetGoExpanded((v) => !v)}
              aria-expanded={letGoExpanded}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#312E81] hover:underline cursor-pointer"
            >
              <span>{letGoExpanded ? 'Show latest 5' : `Show all ${groupedLetGo.length}`}</span>
              {letGoExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {groupedLetGo.length === 0 ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {visibleLetGo.map((group) => {
              const isOpen = !!openLetGoGroupIds[group.id];
              const storeNames = group.items
                .map((it) => it.storeName)
                .filter((name): name is string => !!name);

              return (
                <li
                  key={group.id}
                  className="bg-white border border-[#E6E1D8] rounded-lg overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleLetGoGroup(group.id)}
                    aria-expanded={isOpen}
                    className="w-full text-left px-3.5 py-2.5 flex items-baseline justify-between gap-3 hover:bg-[#FAF8F5] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-[#57534E]">{group.headline}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#78716C]">
                        {storeNames.length > 1 && <span>{storeNames.join(', ')}</span>}
                        {typeof group.confidence === 'number' && (
                          <span className="font-mono text-[11px]">
                            confidence {group.confidence.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-[#78716C] shrink-0 inline-flex items-center gap-1">
                      {formatShortDate(group.date)}
                      {isOpen ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-3.5 pb-3 pt-2 border-t border-[#F3F0EA] bg-[#FAF8F5] space-y-2 text-xs text-[#57534E]">
                      {group.items.map((item) => (
                        <div
                          key={item.candidateId}
                          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-1.5 border-b border-[#E6E1D8] last:border-b-0 last:pb-0"
                        >
                          <div className="font-medium text-[#171717]">
                            {item.storeName ?? 'Established chain'}
                            <span className="ml-2 font-mono text-[11px] font-normal text-[#78716C]">
                              {formatShortDate(item.date)}
                            </span>
                            {typeof item.confidence === 'number' && (
                              <span className="ml-2 font-mono text-[11px] font-normal text-[#78716C]">
                                conf {item.confidence.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3">
                            <span>
                              Actual:{' '}
                              <FactValue fact={item.actual} onInspect={onInspectFact} />
                            </span>
                            <span>
                              Expected:{' '}
                              <FactValue fact={item.expected} onInspect={onInspectFact} />
                            </span>
                          </div>
                          {group.items.length === 1 && (
                            <p className="w-full text-[#78716C]">{item.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 5. Tools I built */}
      <section aria-labelledby="section-tools" className="pt-5 border-t border-[#E6E1D8]">
        <h2 id="section-tools" className="text-sm font-semibold text-[#171717]">
          Tools I built
        </h2>
        <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
      </section>

      {/* 6. Record */}
      <section aria-labelledby="section-record" className="pt-5 border-t border-[#E6E1D8]">
        <h2 id="section-record" className="text-sm font-semibold text-[#171717]">
          Record
        </h2>
        <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
      </section>
    </div>
  );
}
