import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, RotateCcw, ShieldCheck, Wrench, X } from 'lucide-react';
import {
  BuilderRequirement,
  DayState,
  DismissReason,
  Fact,
  RaisedItem,
  TextSegment,
} from '../types/domain';
import { formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { FactValue } from './FactValue';

export interface ActiveInvestigationBanner {
  situationId: string;
  title: string;
  headline: string;
  steps: string[];
}

export interface BuilderErrorState {
  message: string;
  failures: string[];
}

export interface DemoHighlightState {
  actionKey: string;
  label: string;
}

interface OwnerFeedProps {
  dayState: DayState;
  activeInvestigation?: ActiveInvestigationBanner | null;
  actionBusyId?: string | null;
  isRequestInFlight?: boolean;
  pendingRequirements?: Record<string, BuilderRequirement>;
  builderProgressByCandidate?: Record<string, string>;
  builderErrorByCandidate?: Record<string, BuilderErrorState>;
  demoHighlight?: DemoHighlightState | null;
  onInspectFact: (fact: Fact) => void;
  onApproveCard?: (candidateId: string) => void;
  onNotNowCard?: (candidateId: string) => void;
  onDismissCard?: (candidateId: string, reason: DismissReason) => void;
  onLookAgainCard?: (candidateId: string) => void;
  onStartBuildRequirement?: (candidateId: string) => void;
  onConfirmBuildTool?: (candidateId: string) => void;
  onCancelRequirement?: (candidateId: string) => void;
  onAskStoreManager?: (candidateId: string) => void;
  onOpenBuiltTool?: (toolId: string) => void;
  onRespondAutonomy?: (offerId: string, reaction: 'enable_autonomy' | 'keep_asking') => void;
  onUndoAction?: (decisionId: string) => void;
}

const DISMISS_REASONS: Array<{ value: DismissReason; label: string }> = [
  { value: 'not_important', label: 'Not important' },
  { value: 'already_known', label: 'Already known' },
  { value: 'wrong', label: 'Wrong' },
  { value: 'not_mine', label: 'Not mine' },
];

export function toPlainOwnerWords(raw: string): string {
  return raw
    .replace(/\bdonor stores\b/gi, 'stores with stock to spare')
    .replace(/\bDonor stores\b/g, 'Stores with stock to spare')
    .replace(/\bdonor store\b/gi, 'store with stock to spare')
    .replace(/\bdonor\b/gi, 'spare-stock')
    .replace(/\bwks of cover\b/gi, 'weeks of stock left')
    .replace(/\bweeks of cover\b/gi, 'weeks of stock left')
    .replace(/\bwks\b/gi, 'weeks')
    .replace(/\bLFL\b/g, 'comparable stores')
    .replace(/\bTool to build:\s*/i, '');
}

function formatSecondsFromMs(ms: number): string {
  const sec = Math.max(0.1, ms / 1000);
  return `${sec.toFixed(1)} seconds`;
}

function renderSegments(segments: TextSegment[], onInspectFact: (fact: Fact) => void) {
  return segments.map((seg, idx) =>
    seg.type === 'text' ? (
      <span key={`seg-t-${idx}`}>{toPlainOwnerWords(seg.text)}</span>
    ) : (
      <FactValue key={`seg-f-${seg.fact.id}-${idx}`} fact={seg.fact} onInspect={onInspectFact} />
    ),
  );
}

function describeProposedActionOneLine(item: RaisedItem): string {
  const sc = item.secondCheck ?? item.investigation?.secondCheck;
  if (sc?.status === 'disagreed') {
    return 'Two checks disagreed — double-check these store figures first.';
  }
  const plan = item.transferPlan ?? item.investigation?.transferPlan;
  if (plan) {
    const dest =
      plan.treatedStoreIds.length === 1
        ? plan.transferLines[0]?.toStoreName ?? 'the short store'
        : `${plan.treatedStoreIds.length} short stores`;
    const holdoutSuffix = plan.holdoutStoreName
      ? `, holding ${plan.holdoutStoreName} out to compare`
      : '';
    return `Move ${plan.totalUnitsFact.formatted} from stores with stock to spare to ${dest}${holdoutSuffix}.`;
  }
  if (item.investigation?.outcomeKind === 'tool_to_build') {
    return 'Build a Walnut Creek refund review screen and turn on the $50 approval switch.';
  }
  if (item.isRollout) {
    return 'Send the remaining Best-sellers stock to Santana Row.';
  }
  return toPlainOwnerWords(
    item.investigation?.outcomeDetail ?? 'Review this issue and decide the next step.',
  );
}

export function OwnerFeed({
  dayState,
  activeInvestigation,
  actionBusyId,
  isRequestInFlight = false,
  pendingRequirements = {},
  builderProgressByCandidate = {},
  builderErrorByCandidate = {},
  demoHighlight = null,
  onInspectFact,
  onApproveCard,
  onNotNowCard,
  onDismissCard,
  onLookAgainCard,
  onStartBuildRequirement,
  onConfirmBuildTool,
  onCancelRequirement,
  onAskStoreManager,
  onOpenBuiltTool,
  onRespondAutonomy,
  onUndoAction,
}: OwnerFeedProps) {
  const [letGoExpanded, setLetGoExpanded] = useState(false);
  const [openEvidenceIds, setOpenEvidenceIds] = useState<Record<string, boolean>>({});
  const [openLetGoGroupIds, setOpenLetGoGroupIds] = useState<Record<string, boolean>>({});
  const [openWhyIds, setOpenWhyIds] = useState<Record<string, boolean>>({});
  const [dismissPickerId, setDismissPickerId] = useState<string | null>(null);

  const letGoCountFact = createFact(
    `feed:let_go_count:${dayState.date}`,
    'Items noticed and let go',
    dayState.noticedAndLetGo.length,
    'count',
    'Unusual patterns checked against the calendar, store mix, and safety rules and safely let go through this date.',
  );

  const groupedLetGo = dayState.groupedLetGo;
  const visibleLetGo = letGoExpanded ? groupedLetGo : groupedLetGo.slice(0, 5);
  const inProgress = dayState.inProgress ?? [];
  const doneForYou = dayState.doneForYou ?? [];
  const pendingAutonomyOffer =
    dayState.autonomyRecord?.offerCard?.status === 'pending'
      ? dayState.autonomyRecord.offerCard
      : null;
  const needsYouCount = dayState.raised.length + (pendingAutonomyOffer ? 1 : 0);

  const toggleEvidence = (id: string) => {
    setOpenEvidenceIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLetGoGroup = (id: string) => {
    setOpenLetGoGroupIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleWhy = (id: string) => {
    setOpenWhyIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const highlightRing = (key: string) =>
    demoHighlight?.actionKey === key
      ? 'ring-2 ring-offset-2 ring-[#312E81] shadow-md'
      : '';

  return (
    <div className="mt-6 space-y-6">
      {/* 1. Needs you */}
      <section aria-labelledby="section-needs-you">
        <div className="flex items-baseline justify-between">
          <h2 id="section-needs-you" className="text-sm font-semibold text-[#171717]">
            Needs you
          </h2>
          {needsYouCount > 0 && (
            <span className="text-xs font-mono tabular-nums text-[#B45309] font-medium">
              {needsYouCount} waiting
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
                  <li key={`step-${idx}`}>{toPlainOwnerWords(s)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Indigo Offer Card: Earn the right to act alone (Part A) */}
        {pendingAutonomyOffer && (
          <div
            data-testid="autonomy-offer-card"
            className="mt-2 bg-[#EEF2FF] border-2 border-[#312E81] rounded-xl p-4 space-y-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#312E81]">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{pendingAutonomyOffer.headline}</span>
              </div>
              <span className="text-xs font-mono text-[#4338CA] shrink-0">
                {formatShortDate(pendingAutonomyOffer.offeredOn)}
              </span>
            </div>

            <p className="text-sm text-[#1E1B4B] leading-relaxed">{pendingAutonomyOffer.body}</p>

            {demoHighlight?.actionKey === 'autonomy_yes' && (
              <p className="text-[11px] font-medium text-[#312E81] bg-white/80 px-2.5 py-1 rounded border border-[#C7D2FE]">
                the demo is choosing for you
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isRequestInFlight}
                onClick={() => onRespondAutonomy?.(pendingAutonomyOffer.id, 'enable_autonomy')}
                className={`px-3.5 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                  'autonomy_yes',
                )}`}
              >
                Yes, within those limits
              </button>
              <button
                type="button"
                disabled={isRequestInFlight}
                onClick={() => onRespondAutonomy?.(pendingAutonomyOffer.id, 'keep_asking')}
                className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-50 text-[#171717] border border-[#C7D2FE] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Keep asking me
              </button>
            </div>
          </div>
        )}

        {dayState.raised.length === 0 && !activeInvestigation && !pendingAutonomyOffer ? (
          <p className="mt-2 text-sm text-[#57534E]">Nothing needs you today.</p>
        ) : dayState.raised.length > 0 ? (
          <div className="mt-2 bg-white border border-[#E6E1D8] rounded-xl divide-y divide-[#E6E1D8]">
            {dayState.raised.map((item) => {
              const evOpen = !!openEvidenceIds[item.candidateId];
              const whyOpen = !!openWhyIds[item.candidateId];
              const isBusy = actionBusyId === item.candidateId;
              const buttonsDisabled = isBusy || isRequestInFlight;
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
              const isToolToBuild = inv?.outcomeKind === 'tool_to_build';
              const pendingReq = pendingRequirements[item.candidateId];
              const buildProgress = builderProgressByCandidate[item.candidateId];
              const buildErr = builderErrorByCandidate[item.candidateId];
              const askedManagerAct = (dayState.inProgress ?? []).find(
                (a) => a.candidateId === item.candidateId && a.isSimulatedTask,
              );
              const doneManagerAct = (dayState.doneForYou ?? []).find(
                (d) => d.candidateId === item.candidateId,
              );
              const stakeFact = item.todayStakePerWeek ?? item.stakePerWeek;
              const approveBtnKey = `approve:${item.candidateId}`;
              const buildBtnKey = `build:${item.candidateId}`;
              const buildItBtnKey = `build_it:${item.candidateId}`;

              return (
                <div key={item.candidateId} className="p-4 space-y-2.5" data-card-id={item.candidateId}>
                  {/* 1. Title + date */}
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[#B45309]">{item.title}</h3>
                    <span className="text-xs font-mono text-[#78716C] shrink-0">
                      {formatShortDate(item.firstDetectedOn)}
                    </span>
                  </div>

                  {/* Brief re-raised notice when deferred previously */}
                  {item.reRaisedOn && (
                    <div className="p-2.5 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs space-y-1">
                      <p className="text-[#92400E] font-medium">
                        Put aside earlier ({item.deferredOn ? formatShortDate(item.deferredOn) : ''}) · Back{' '}
                        {formatShortDate(item.reRaisedOn)} ({item.reRaiseReason})
                      </p>
                      {item.costOfDelayFact && (
                        <p className="text-[#171717]">
                          Cost of waiting so far:{' '}
                          <FactValue fact={item.costOfDelayFact} onInspect={onInspectFact} />
                        </p>
                      )}
                    </div>
                  )}

                  {/* 2. One plain sentence */}
                  {item.isRollout ? (
                    <p className="text-sm text-[#171717] leading-relaxed">
                      {toPlainOwnerWords(item.summary)}
                    </p>
                  ) : inv ? (
                    <p className="text-sm text-[#171717] leading-relaxed">
                      {renderSegments(inv.findingSegments, onInspectFact)}
                    </p>
                  ) : (
                    <p className="text-sm text-[#171717] leading-relaxed">
                      {toPlainOwnerWords(item.summary)}
                    </p>
                  )}

                  {/* 3. Money at stake per week */}
                  <p className="text-xs text-[#57534E]">
                    At stake per week:{' '}
                    <FactValue
                      fact={stakeFact}
                      onInspect={onInspectFact}
                      className="font-semibold text-[#171717]"
                    />
                  </p>

                  {/* 4. Proposed action in one line */}
                  <p className="text-xs font-medium text-[#312E81] bg-[#F5F7FF] border border-[#E0E7FF] rounded-lg px-3 py-2">
                    {describeProposedActionOneLine(item)}
                  </p>

                  {/* Builder Requirement sheet & progress when Build was clicked */}
                  {isToolToBuild && pendingReq && (
                    <div
                      data-testid="builder-requirement-panel"
                      className="mt-2 p-3.5 rounded-lg bg-[#F5F7FF] border border-[#C7D2FE] text-xs space-y-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold text-[#312E81]">
                          Plan for tool: {pendingReq.title}
                        </span>
                        <span className="font-mono text-[11px] text-[#57534E]">
                          {pendingReq.model} · {formatSecondsFromMs(pendingReq.latencyMs)}
                          {pendingReq.mode === 'replayed' ? ' (replayed)' : ''}
                          {pendingReq.usedFallbackWording ? ' · Fallback copy' : ''}
                        </span>
                      </div>
                      <dl className="space-y-1.5 text-[#171717]">
                        <div>
                          <dt className="font-semibold text-[#57534E]">Purpose</dt>
                          <dd className="leading-relaxed">
                            {renderSegments(pendingReq.purpose, onInspectFact)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[#57534E]">Who uses it</dt>
                          <dd className="leading-relaxed">
                            {renderSegments(pendingReq.users, onInspectFact)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[#57534E]">What it shows</dt>
                          <dd className="leading-relaxed">
                            {renderSegments(pendingReq.shows, onInspectFact)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[#57534E]">Actions inside tool</dt>
                          <dd className="leading-relaxed">
                            {renderSegments(pendingReq.actions, onInspectFact)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold text-[#57534E]">Checks before handover</dt>
                          <dd className="leading-relaxed">
                            {renderSegments(pendingReq.verification, onInspectFact)}
                          </dd>
                        </div>
                      </dl>

                      {buildProgress && (
                        <div className="flex items-center gap-2 p-2 rounded bg-white border border-[#C7D2FE] text-[#312E81] font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          <span>{buildProgress}</span>
                        </div>
                      )}

                      {buildErr && (
                        <div
                          role="alert"
                          className="p-2.5 rounded bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] space-y-1"
                        >
                          <p className="font-semibold">{buildErr.message}</p>
                          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                            {buildErr.failures.map((f, i) => (
                              <li key={`bfail-${i}`}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {demoHighlight?.actionKey === buildItBtnKey && (
                        <p className="text-[11px] font-medium text-[#312E81] bg-white/80 px-2.5 py-1 rounded border border-[#C7D2FE]">
                          the demo is choosing for you
                        </p>
                      )}

                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={buttonsDisabled}
                          onClick={() => onConfirmBuildTool?.(item.candidateId)}
                          className={`px-3.5 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                            buildItBtnKey,
                          )}`}
                        >
                          {buildProgress ? 'Building & testing...' : 'Build it'}
                        </button>
                        <button
                          type="button"
                          disabled={buttonsDisabled}
                          onClick={() => onCancelRequirement?.(item.candidateId)}
                          className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-50 text-[#171717] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                        >
                          Not now
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Demo helper label if scripted button is highlighted */}
                  {demoHighlight &&
                    (demoHighlight.actionKey === approveBtnKey ||
                      demoHighlight.actionKey === buildBtnKey) && (
                      <p className="text-[11px] font-medium text-[#312E81] bg-[#EEF2FF] px-2.5 py-1 rounded border border-[#C7D2FE]">
                        the demo is choosing for you
                      </p>
                    )}

                  {/* 5. Action Buttons + See why link */}
                  {!(isToolToBuild && pendingReq) && (
                    <div className="pt-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {checksDisagree ? (
                            <button
                              type="button"
                              disabled={buttonsDisabled}
                              onClick={() => onLookAgainCard?.(item.candidateId)}
                              className="px-3.5 py-1.5 bg-[#B45309] hover:bg-[#92400E] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                            >
                              {isBusy ? 'Rechecking...' : 'Look again'}
                            </button>
                          ) : isToolToBuild ? (
                            <>
                              <button
                                type="button"
                                disabled={buttonsDisabled}
                                onClick={() => onStartBuildRequirement?.(item.candidateId)}
                                className={`px-3.5 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                                  buildBtnKey,
                                )}`}
                              >
                                {isBusy ? 'Preparing...' : 'Build'}
                              </button>

                              {askedManagerAct ? (
                                <span className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#E6E1D8] text-[#57534E] text-[11px] font-medium rounded-lg">
                                  Asked store manager · due {formatShortDate(askedManagerAct.endDate)}{' '}
                                  (simulated)
                                </span>
                              ) : doneManagerAct ? (
                                <span className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#E6E1D8] text-[#57534E] text-[11px] font-medium rounded-lg">
                                  Store manager check finished
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={buttonsDisabled}
                                  onClick={() => onAskStoreManager?.(item.candidateId)}
                                  className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-50 text-[#171717] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                                >
                                  Ask store manager
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={buttonsDisabled}
                              onClick={() => onApproveCard?.(item.candidateId)}
                              className={`px-3.5 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                                approveBtnKey,
                              )}`}
                            >
                              {isBusy ? 'Working...' : 'Approve'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={buttonsDisabled}
                            onClick={() => onNotNowCard?.(item.candidateId)}
                            className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-50 text-[#171717] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Not now
                          </button>

                          <button
                            type="button"
                            disabled={buttonsDisabled}
                            onClick={() =>
                              setDismissPickerId(isDismissOpen ? null : item.candidateId)
                            }
                            className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] disabled:opacity-50 text-[#57534E] border border-[#E6E1D8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleWhy(item.candidateId)}
                          aria-expanded={whyOpen}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#312E81] hover:underline shrink-0 cursor-pointer"
                        >
                          <span>{whyOpen ? 'Hide why' : 'See why'}</span>
                          {whyOpen ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {isDismissOpen && (
                        <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8] flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-[#57534E] mr-1">Why?</span>
                          {DISMISS_REASONS.map((r) => (
                            <button
                              key={r.value}
                              type="button"
                              disabled={buttonsDisabled}
                              onClick={() => {
                                setDismissPickerId(null);
                                onDismissCard?.(item.candidateId, r.value);
                              }}
                              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-[#F3F0EA] disabled:opacity-50 border border-[#E6E1D8] rounded text-[#171717] cursor-pointer"
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* "See why" expandable section */}
                  {whyOpen && (
                    <div className="mt-3 pt-3 border-t border-[#E6E1D8] space-y-3">
                      {/* Expected and actual side by side */}
                      <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#F3F0EA] text-xs">
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
                          <p className="text-[11px] text-[#78716C]">At stake / week</p>
                          <p className="mt-0.5 font-medium text-[#171717]">
                            <FactValue fact={item.stakePerWeek} onInspect={onInspectFact} />
                          </p>
                        </div>
                      </div>

                      {hasToday && (
                        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[#171717]">
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
                            At stake / week:{' '}
                            <FactValue fact={item.todayStakePerWeek!} onInspect={onInspectFact} />
                          </span>
                        </div>
                      )}

                      {/* Two-way check */}
                      {sc && (
                        <div
                          className={`px-2.5 py-1.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
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
                              Main check: <FactValue fact={sc.firstValueFact} onInspect={onInspectFact} /> ·
                              Second check:{' '}
                              <FactValue fact={sc.secondValueFact} onInspect={onInspectFact} />
                            </span>
                          )}
                        </div>
                      )}

                      {/* Per-store breakdown */}
                      {multiStore && item.stores && (
                        <ul className="space-y-1 text-xs text-[#57534E]">
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

                      {/* Investigation details */}
                      {inv && !item.isRollout && (
                        <div className="space-y-3 text-xs">
                          <div>
                            <p className="font-semibold text-[#57534E]">Ruled out</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {inv.ruledOut.map((ro) => (
                                <li key={ro.kind} className="flex items-start gap-1.5 text-[#57534E]">
                                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-0.5" />
                                  <span>
                                    {ro.summarySegments && ro.summarySegments.length > 0
                                      ? renderSegments(ro.summarySegments, onInspectFact)
                                      : toPlainOwnerWords(ro.summary)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="font-semibold text-[#57534E]">Cause</p>
                            <p className="mt-1 text-[#171717] leading-relaxed">
                              {renderSegments(inv.causeSegments, onInspectFact)}
                            </p>
                          </div>

                          <div>
                            <p className="font-semibold text-[#57534E]">Options</p>
                            <ul className="mt-1.5 space-y-1.5">
                              {inv.options.map((opt) => (
                                <li
                                  key={opt.id}
                                  className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]"
                                >
                                  <div className="flex items-baseline justify-between gap-2">
                                    <span className="font-medium text-[#171717]">
                                      {toPlainOwnerWords(opt.label)}
                                    </span>
                                    {opt.weeklyEffectFact && (
                                      <span className="font-mono text-[11px] shrink-0">
                                        <FactValue
                                          fact={opt.weeklyEffectFact}
                                          onInspect={onInspectFact}
                                        />
                                        /week
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[#57534E]">
                                    {toPlainOwnerWords(opt.description)}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="font-semibold text-[#57534E]">Recommendation</p>
                            <p className="mt-1 text-[#171717] leading-relaxed">
                              {renderSegments(inv.proposalSegments, onInspectFact)}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Exact Transfer Plan preview */}
                      {plan && (
                        <div className="p-3 rounded-lg bg-[#F5F7FF] border border-[#C7D2FE] text-xs space-y-1.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-[#312E81]">
                              Plan ({plan.transferLines.length}{' '}
                              {plan.transferLines.length === 1 ? 'transfer' : 'transfers'})
                            </span>
                            <span className="font-mono text-[11px] text-[#312E81]">
                              Arrives {formatShortDate(plan.arrivalDate)}
                            </span>
                          </div>
                          <p className="text-[#171717]">
                            Move <FactValue fact={plan.totalUnitsFact} onInspect={onInspectFact} />{' '}
                            (worth{' '}
                            <FactValue fact={plan.weeklyRecoveryFact} onInspect={onInspectFact} />
                            /week):
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
                          <p className="text-[#57534E]">{toPlainOwnerWords(plan.limitSentence)}</p>
                          {plan.shortfallUnitsFact && (
                            <p className="text-[#B45309] font-medium">
                              Shortfall:{' '}
                              <FactValue
                                fact={plan.shortfallUnitsFact}
                                onInspect={onInspectFact}
                              />{' '}
                              cannot be covered above spare-stock store limits.
                            </p>
                          )}
                          <p className="text-[11px] text-[#57534E] pt-1 border-t border-[#E0E7FF]">
                            Measure: {plan.measure}
                          </p>
                        </div>
                      )}

                      {/* Supporting evidence */}
                      {evidenceList.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => toggleEvidence(item.candidateId)}
                            aria-expanded={evOpen}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#312E81] hover:underline cursor-pointer"
                          >
                            <span>
                              {evOpen
                                ? `Hide related signs (${evidenceList.length})`
                                : `Related signs (${evidenceList.length})`}
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
                                          All stores 28-day vs last year:{' '}
                                          <FactValue fact={ev.actual} onInspect={onInspectFact} />
                                        </span>
                                        <span>
                                          Comparable stores vs expected:{' '}
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
                                      </>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Plain-words model details */}
                      {item.instinctMeta && (
                        <p className="pt-2 border-t border-[#F3F0EA] text-[11px] text-[#78716C]">
                          {Math.round(item.instinctMeta.confidence * 100)}% sure · decided in{' '}
                          {formatSecondsFromMs(item.instinctMeta.latencyMs)}
                          {item.instinctMeta.mode === 'replayed' ? ' (replayed)' : ''}
                          {inv
                            ? ` · checked in ${formatSecondsFromMs(inv.latencyMs)} using ${
                                inv.jobKey === 'investigate_routine'
                                  ? 'routine kind, fast model'
                                  : inv.model
                              }`
                            : ''}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* 2. In progress */}
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
                  <span className="font-semibold text-[#171717]">
                    {act.title}
                    {act.isSimulatedTask && (
                      <span className="ml-1.5 font-normal text-[#78716C]">(simulated)</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                    Ends {formatShortDate(act.endDate)}
                  </span>
                </div>
                <p className="text-[#57534E]">{toPlainOwnerWords(act.measure)}</p>
                {(act.beforeRefundRateFact || act.afterRefundRateFact) && (
                  <p className="text-[#57534E]">
                    {act.beforeRefundRateFact && (
                      <>
                        Before:{' '}
                        <FactValue fact={act.beforeRefundRateFact} onInspect={onInspectFact} />
                      </>
                    )}
                    {act.afterRefundRateFact && (
                      <>
                        {' · '}After:{' '}
                        <FactValue fact={act.afterRefundRateFact} onInspect={onInspectFact} />
                      </>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#312E81]">
                  <span>{act.statusText}</span>
                  <span className="font-mono text-[#78716C]">{act.nextCheckpoint}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Done for you */}
      <section aria-labelledby="section-done-for-you" className="pt-5 border-t border-[#E6E1D8]">
        <h2 id="section-done-for-you" className="text-sm font-semibold text-[#171717]">
          Done for you
        </h2>

        {dayState.lostAutonomyReason && (
          <div className="mt-2 p-3 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E]">
            {dayState.lostAutonomyReason}
          </div>
        )}

        {doneForYou.length === 0 ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {doneForYou.map((item) => (
              <li
                key={item.decisionId}
                data-done-id={item.decisionId}
                className="bg-white border border-[#E6E1D8] rounded-lg px-3.5 py-2.5 text-xs space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="font-semibold text-[#171717]">{item.title}</span>
                    {item.isAutonomous && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#EEF2FF] text-[#312E81] border border-[#C7D2FE]">
                        Acted within limits
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-[#78716C] shrink-0">
                    {formatShortDate(item.closedOn)}
                  </span>
                </div>

                {item.movedSummary && <p className="text-[#171717] font-medium">{item.movedSummary}</p>}
                {item.whySummary && <p className="text-[#57534E]">{item.whySummary}</p>}

                <p
                  className={`font-medium ${
                    item.verdict === 'worked_proven' ||
                    item.verdict === 'worked_before_after' ||
                    item.verdict === 'worked_single_store'
                      ? 'text-[#15803D]'
                      : item.verdict === 'did_not_work' || item.verdict === 'undone'
                        ? 'text-[#991B1B]'
                        : 'text-[#57534E]'
                  }`}
                >
                  {item.verdictSentence}
                </p>

                {item.detailSentence && (
                  <p className="text-[#57534E]">{toPlainOwnerWords(item.detailSentence)}</p>
                )}

                {(item.beforeRefundRateFact || item.afterRefundRateFact) && (
                  <p className="text-[#57534E]">
                    {item.beforeRefundRateFact && (
                      <>
                        Before:{' '}
                        <FactValue fact={item.beforeRefundRateFact} onInspect={onInspectFact} />
                      </>
                    )}
                    {item.afterRefundRateFact && (
                      <>
                        {' · '}After:{' '}
                        <FactValue fact={item.afterRefundRateFact} onInspect={onInspectFact} />
                      </>
                    )}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-3 text-[#57534E]">
                    {item.expectedWorthFact && (
                      <span>
                        Expected worth:{' '}
                        <FactValue fact={item.expectedWorthFact} onInspect={onInspectFact} />
                      </span>
                    )}
                    {item.provenMoneyFact && (
                      <span>
                        Proven gain:{' '}
                        <FactValue fact={item.provenMoneyFact} onInspect={onInspectFact} />
                      </span>
                    )}
                    {item.unitsReturnedFact && (
                      <span>
                        Returned:{' '}
                        <FactValue fact={item.unitsReturnedFact} onInspect={onInspectFact} />
                      </span>
                    )}
                  </div>

                  {item.canUndo && (
                    <button
                      type="button"
                      disabled={isRequestInFlight}
                      onClick={() => onUndoAction?.(item.decisionId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white hover:bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
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
                      <p className="text-sm text-[#57534E]">{toPlainOwnerWords(group.headline)}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#78716C]">
                        {storeNames.length > 1 && <span>{storeNames.join(', ')}</span>}
                        {typeof group.confidence === 'number' && (
                          <span className="font-mono text-[11px]">
                            {Math.round(group.confidence * 100)}% sure
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
                            {item.storeName ?? 'Comparable stores'}
                            <span className="ml-2 font-mono text-[11px] font-normal text-[#78716C]">
                              {formatShortDate(item.date)}
                            </span>
                            {typeof item.confidence === 'number' && (
                              <span className="ml-2 font-mono text-[11px] font-normal text-[#78716C]">
                                {Math.round(item.confidence * 100)}% sure
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
                            <p className="w-full text-[#78716C]">{toPlainOwnerWords(item.reason)}</p>
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
        <div className="flex items-baseline justify-between">
          <h2 id="section-tools" className="text-sm font-semibold text-[#171717]">
            Tools I built
          </h2>
          {(dayState.builtTools?.length ?? 0) > 0 && (
            <span className="text-xs font-mono tabular-nums text-[#312E81]">
              {dayState.builtTools!.length} installed
            </span>
          )}
        </div>
        {!dayState.builtTools || dayState.builtTools.length === 0 ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-2.5">
            {dayState.builtTools.map((tool) => (
              <li
                key={tool.id}
                className="bg-white border border-[#E6E1D8] rounded-xl p-3.5 text-xs space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-[#171717]">
                      <Wrench className="w-3.5 h-3.5 text-[#312E81] shrink-0" />
                      <span>{tool.title}</span>
                    </div>
                    <p className="mt-0.5 text-[#57534E]">
                      {tool.storeName} · Installed {formatShortDate(tool.installedOn)} ·{' '}
                      <span className="font-mono">
                        {tool.model} · {formatSecondsFromMs(tool.latencyMs)}
                        {tool.mode === 'replayed' ? ' (replayed)' : ''}
                      </span>
                    </p>
                    {tool.usedFallbackCopy && (
                      <p className="mt-1 inline-block px-1.5 py-0.5 rounded bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] font-medium">
                        Fallback copy, not built live.
                      </p>
                    )}
                    {tool.repairedOnce && (
                      <p className="mt-0.5 text-[#B45309]">Repaired once and passed</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenBuiltTool?.(tool.id)}
                    className={`px-3 py-1.5 bg-[#312E81] hover:bg-[#26236B] text-white text-xs font-semibold rounded-lg transition-colors shrink-0 cursor-pointer ${highlightRing(
                      `open_tool:${tool.id}`,
                    )}`}
                  >
                    Open tool
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1 text-[#57534E]">
                  {dayState.toolUnreviewedFact && (
                    <span>
                      Unreviewed flagged:{' '}
                      <FactValue fact={dayState.toolUnreviewedFact} onInspect={onInspectFact} />
                    </span>
                  )}
                  <span>
                    Approval rule:{' '}
                    <strong className="text-[#171717]">
                      {dayState.refundSwitchEnabled ? 'Active' : 'Off'}
                    </strong>
                  </span>
                </div>

                <ul className="pt-1.5 border-t border-[#F3F0EA] space-y-1">
                  {tool.testResults.map((tr) => (
                    <li key={tr.id} className="flex items-center gap-1.5 text-[11px] text-[#57534E]">
                      {tr.passed ? (
                        <Check className="w-3 h-3 text-[#15803D] shrink-0" />
                      ) : (
                        <X className="w-3 h-3 text-[#991B1B] shrink-0" />
                      )}
                      <span className={tr.passed ? 'text-[#15803D] font-medium' : 'text-[#991B1B]'}>
                        {tr.passed ? 'passed' : 'failed'}
                      </span>
                      <span>· {tr.label}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Record (Part A) */}
      <section aria-labelledby="section-record" className="pt-5 border-t border-[#E6E1D8]">
        <h2 id="section-record" className="text-sm font-semibold text-[#171717]">
          Record
        </h2>
        {!dayState.autonomyRecord ? (
          <p className="mt-2 text-sm text-[#78716C]">Nothing yet.</p>
        ) : (
          <div className="mt-2 bg-white border border-[#E6E1D8] rounded-xl p-3.5 text-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#171717]">
                {dayState.autonomyRecord.kindLabel}
              </span>
              <span
                className={`px-2 py-0.5 rounded-md border font-medium text-[11px] ${
                  dayState.autonomyRecord.level === 'autonomous_within_limits'
                    ? 'bg-[#EEF2FF] text-[#312E81] border-[#C7D2FE]'
                    : 'bg-[#FAF8F5] text-[#57534E] border-[#E6E1D8]'
                }`}
              >
                {dayState.autonomyRecord.levelLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#F3F0EA]">
              <div>
                <p className="text-[11px] text-[#78716C]">Cases</p>
                <p className="mt-0.5 font-semibold text-[#171717]">
                  <FactValue fact={dayState.autonomyRecord.casesFact} onInspect={onInspectFact} />
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#78716C]">Worked</p>
                <p className="mt-0.5 font-semibold text-[#171717]">
                  <FactValue fact={dayState.autonomyRecord.workedFact} onInspect={onInspectFact} />
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#78716C]">Proven vs held-out</p>
                <p className="mt-0.5 font-semibold text-[#171717]">
                  <FactValue fact={dayState.autonomyRecord.provenFact} onInspect={onInspectFact} />
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[#78716C]">Combined gain</p>
                <p className="mt-0.5 font-semibold text-[#171717]">
                  <FactValue
                    fact={dayState.autonomyRecord.pooledMoneyFact}
                    onInspect={onInspectFact}
                  />
                </p>
              </div>
            </div>

            <p className="text-[#57534E] leading-relaxed">
              <strong className="text-[#171717]">Rule to act alone:</strong>{' '}
              {dayState.autonomyRecord.earnRuleText}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
