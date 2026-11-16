import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { createFact } from '../../engine/facts';
import {
  BuilderRequirement,
  DayState,
  DismissReason,
  Fact,
  ProofTag,
} from '../../types/domain';
import { FactValue } from '../FactValue';
import {
  ActiveInvestigationBanner,
  BuilderErrorState,
  DemoHighlightState,
} from '../OwnerFeed';
import { InlineBuiltRefundToolCard } from './InlineBuiltRefundToolCard';
import { ProofPill, toSimpleEnglish } from './SimpleHelpers';
import { SimpleProblemCard } from './SimpleProblemCard';
import { TeamPanel } from './TeamPanel';
import { ProofComparisonVisual } from './VisualDiagrams';

interface SimpleOwnerFeedProps {
  dayState: DayState;
  activeInvestigation: ActiveInvestigationBanner | null;
  actionBusyId: string | null;
  isRequestInFlight: boolean;
  pendingRequirements: Record<string, BuilderRequirement>;
  builderProgressByCandidate: Record<string, string>;
  builderErrorByCandidate: Record<string, BuilderErrorState>;
  demoHighlight: DemoHighlightState | null;
  isTourMode?: boolean;
  onInspectFact: (fact: Fact) => void;
  onApproveCard: (candidateId: string) => void;
  onNotNowCard: (candidateId: string) => void;
  onDismissCard: (candidateId: string, reason: DismissReason) => void;
  onLookAgainCard: (candidateId: string) => void;
  onStartBuildRequirement: (candidateId: string) => void;
  onConfirmBuildTool: (candidateId: string) => void;
  onCancelRequirement: (candidateId: string) => void;
  onAskStoreManager: (candidateId: string) => void;
  onRespondAutonomy: (offerId: string, reaction: 'enable_autonomy' | 'keep_asking') => void;
  onUndoAction: (decisionId: string) => void;
  onToggleRefundReviewed: (refundId: string, reviewed: boolean) => void;
  onApproveRefundSwitch: (toolId: string, candidateId: string) => Promise<boolean>;
}

function verdictToProofTag(verdict: string): ProofTag {
  if (verdict === 'worked_proven') return 'proven';
  if (verdict === 'worked_single_store' || verdict === 'worked_before_after') return 'likely';
  return 'none';
}

export function SimpleOwnerFeed({
  dayState,
  activeInvestigation,
  actionBusyId,
  isRequestInFlight,
  pendingRequirements,
  builderProgressByCandidate,
  builderErrorByCandidate,
  demoHighlight,
  isTourMode = false,
  onInspectFact,
  onApproveCard,
  onNotNowCard,
  onDismissCard,
  onLookAgainCard,
  onStartBuildRequirement,
  onConfirmBuildTool,
  onCancelRequirement,
  onAskStoreManager,
  onRespondAutonomy,
  onUndoAction,
  onToggleRefundReviewed,
  onApproveRefundSwitch,
}: SimpleOwnerFeedProps) {
  const [quietOpen, setQuietOpen] = useState(false);
  const [showAllQuiet, setShowAllQuiet] = useState(false);
  const [openQuietIds, setOpenQuietIds] = useState<Record<string, boolean>>({});

  const inProgress = dayState.inProgress ?? [];
  const doneForYou = dayState.doneForYou ?? [];
  const turnedDownWarnings = dayState.moneyAccount?.turnedDownWarnings ?? [];
  const pendingOffer =
    dayState.autonomyRecord?.offerCard?.status === 'pending'
      ? dayState.autonomyRecord.offerCard
      : null;

  const builtTools = dayState.builtTools ?? [];
  const refundTool = builtTools.find((t) => t.id === 'tool:refund_exceptions_desk:walnut_creek');
  const refundSwitchNeedsTurnOn = Boolean(refundTool && !dayState.refundSwitchEnabled);

  const needsDecisionCount =
    dayState.raised.length + (pendingOffer ? 1 : 0) + (refundSwitchNeedsTurnOn ? 1 : 0);

  const quietCountFact = createFact(
    `simple:quiet_count:${dayState.date}`,
    'Items noticed, checked, and stayed quiet on',
    dayState.noticedAndLetGo.length,
    'count',
    'Signals checked against seasonal patterns, new store opening ramps, and stock transfers and safely left alone.',
  );

  const groupedLetGo = dayState.groupedLetGo;
  const visibleQuiet = showAllQuiet ? groupedLetGo : groupedLetGo.slice(0, 5);
  const highlightBadgeText = isTourMode ? 'The tour chooses this' : 'The demo chooses this';

  return (
    <div className="space-y-6">
      {/* Section 1: Needs your decision */}
      <section aria-labelledby="simple-needs-you" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="simple-needs-you" className="text-base font-semibold text-[#25372C]">
            Needs your decision
          </h2>
          {needsDecisionCount > 0 && (
            <span className="text-xs font-medium text-[#92400E]">
              {needsDecisionCount} waiting
            </span>
          )}
        </div>

        {/* Investigation in flight */}
        {activeInvestigation && (
          <div
            role="status"
            aria-live="polite"
            className="bg-white border border-[#CFE0D4] rounded-2xl p-4 space-y-2"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#25372C]">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Checking {toSimpleEnglish(activeInvestigation.title)}.</span>
            </div>
            {activeInvestigation.steps.length > 0 && (
              <ul className="space-y-1 pl-5 text-xs text-[#56695D] list-disc">
                {activeInvestigation.steps.map((s, idx) => (
                  <li key={`step-${idx}`}>{toSimpleEnglish(s)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Autonomy offer card */}
        {pendingOffer && (
          <article
            data-testid="autonomy-offer-card"
            className="simple-card-enter bg-[#EEF6F0] border-2 border-[#25372C] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2 text-base font-semibold text-[#25372C]">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{toSimpleEnglish(pendingOffer.headline)}</span>
              </div>
              <span className="text-xs text-[#43564A] shrink-0">
                {formatShortDate(pendingOffer.offeredOn)}
              </span>
            </div>
            <p className="text-sm text-[#25372C] leading-relaxed">
              {toSimpleEnglish(pendingOffer.body)}
            </p>
            {demoHighlight?.actionKey === 'autonomy_yes' && (
              <p className="text-xs font-medium text-[#25372C] bg-white px-2.5 py-1 rounded-md border border-[#CFE0D4] inline-block">
                {highlightBadgeText}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isRequestInFlight}
                onClick={() => onRespondAutonomy(pendingOffer.id, 'enable_autonomy')}
                className={`px-4 py-2 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  demoHighlight?.actionKey === 'autonomy_yes'
                    ? 'ring-2 ring-offset-2 ring-[#25372C]'
                    : ''
                }`}
              >
                Yes, within those limits
              </button>
              <button
                type="button"
                disabled={isRequestInFlight}
                onClick={() => onRespondAutonomy(pendingOffer.id, 'keep_asking')}
                className="px-3.5 py-2 bg-white hover:bg-[#F5EEDD] disabled:opacity-50 text-[#25372C] border border-[#D8CEB8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Keep asking me
              </button>
            </div>
          </article>
        )}

        {/* Inline refund desk when newly built and rule switch still off */}
        {refundTool && refundSwitchNeedsTurnOn && (
          <InlineBuiltRefundToolCard
            tool={refundTool}
            rows={dayState.refundRows ?? []}
            switchEnabled={Boolean(dayState.refundSwitchEnabled)}
            reviewedIds={dayState.reviewedRefundIds ?? []}
            unreviewedFact={dayState.toolUnreviewedFact}
            isBusy={isRequestInFlight}
            demoHighlight={demoHighlight}
            highlightBadgeText={highlightBadgeText}
            forceExpanded
            onInspectFact={onInspectFact}
            onToggleReviewed={onToggleRefundReviewed}
            onApproveRefundSwitch={onApproveRefundSwitch}
          />
        )}

        {/* Raised cards */}
        {dayState.raised.length > 0 && (
          <div className="space-y-3">
            {dayState.raised.map((item) => (
              <SimpleProblemCard
                key={item.candidateId}
                item={item}
                dayState={dayState}
                isBusy={actionBusyId === item.candidateId}
                buttonsDisabled={actionBusyId === item.candidateId || isRequestInFlight}
                pendingReq={pendingRequirements[item.candidateId]}
                buildProgress={builderProgressByCandidate[item.candidateId]}
                buildErr={builderErrorByCandidate[item.candidateId]}
                demoHighlight={demoHighlight}
                highlightBadgeText={highlightBadgeText}
                onInspectFact={onInspectFact}
                onApproveCard={onApproveCard}
                onNotNowCard={onNotNowCard}
                onDismissCard={onDismissCard}
                onLookAgainCard={onLookAgainCard}
                onStartBuildRequirement={onStartBuildRequirement}
                onConfirmBuildTool={onConfirmBuildTool}
                onCancelRequirement={onCancelRequirement}
                onAskStoreManager={onAskStoreManager}
              />
            ))}
          </div>
        )}

        {needsDecisionCount === 0 && !activeInvestigation && (
          <div className="bg-white border border-[#E5DCC7] rounded-2xl px-4 py-3 text-sm text-[#56695D]">
            Nothing needs your decision today.
          </div>
        )}
      </section>

      {/* Section 2: In progress */}
      <section aria-labelledby="simple-in-progress" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="simple-in-progress" className="text-base font-semibold text-[#25372C]">
            In progress
          </h2>
          {inProgress.length > 0 && (
            <span className="text-xs text-[#56695D]">{inProgress.length} active</span>
          )}
        </div>
        {inProgress.length === 0 ? (
          <p className="text-sm text-[#56695D]">Nothing in progress right now.</p>
        ) : (
          <ul className="space-y-2.5">
            {inProgress.map((act) => (
              <li
                key={act.decisionId}
                className="simple-card-enter bg-white border border-[#E5DCC7] rounded-2xl p-4 text-xs space-y-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[#25372C]">
                    {toSimpleEnglish(act.title)}
                  </span>
                  <span className="text-[#56695D] shrink-0">
                    Ends {formatShortDate(act.endDate)}
                  </span>
                </div>
                <p className="text-[#43564A] leading-snug">{toSimpleEnglish(act.measure)}</p>
                {(act.beforeRefundRateFact || act.afterRefundRateFact) && (
                  <p className="text-[#43564A]">
                    {act.beforeRefundRateFact && (
                      <>
                        Before:{' '}
                        <FactValue
                          fact={act.beforeRefundRateFact}
                          onInspect={onInspectFact}
                          noPlus
                          plainFont
                        />
                      </>
                    )}
                    {act.afterRefundRateFact && (
                      <>
                        {' · '}After:{' '}
                        <FactValue
                          fact={act.afterRefundRateFact}
                          onInspect={onInspectFact}
                          noPlus
                          plainFont
                        />
                      </>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[#25372C] pt-1 border-t border-[#EFE8D6]">
                  <span className="font-medium">{toSimpleEnglish(act.statusText)}</span>
                  <span className="text-[#56695D]">{toSimpleEnglish(act.nextCheckpoint)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 3: Done for you */}
      <section aria-labelledby="simple-done-for-you" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="simple-done-for-you" className="text-base font-semibold text-[#25372C]">
            Done for you
          </h2>
          {doneForYou.length > 0 && (
            <span className="text-xs text-[#56695D]">{doneForYou.length} finished</span>
          )}
        </div>

        {dayState.lostAutonomyReason && (
          <div className="p-3.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#78350F]">
            {toSimpleEnglish(dayState.lostAutonomyReason)}
          </div>
        )}

        {doneForYou.length === 0 ? (
          <p className="text-sm text-[#56695D]">No completed actions yet.</p>
        ) : (
          <ul className="space-y-3">
            {doneForYou.map((item) => {
              const proofBar = dayState.doneForYouProofBars?.[item.decisionId];
              const proofTag = verdictToProofTag(item.verdict);
              return (
                <li
                  key={item.decisionId}
                  data-done-id={item.decisionId}
                  className="simple-card-enter bg-white border border-[#E5DCC7] rounded-2xl p-4 text-xs space-y-2.5 shadow-2xs"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#25372C]">
                        {toSimpleEnglish(item.title)}
                      </span>
                      {item.isAutonomous && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-[#E8F1EC] text-[#25372C] border border-[#C6DBC9]">
                          Acted within limits
                        </span>
                      )}
                    </div>
                    <span className="text-[#56695D] shrink-0">
                      {formatShortDate(item.closedOn)}
                    </span>
                  </div>

                  {proofTag !== 'none' && <ProofPill proof={proofTag} />}

                  {item.movedSummary && (
                    <p className="text-[#25372C] font-medium">
                      {toSimpleEnglish(item.movedSummary)}
                    </p>
                  )}
                  {item.whySummary && (
                    <p className="text-[#56695D]">{toSimpleEnglish(item.whySummary)}</p>
                  )}

                  {proofBar && (
                    <ProofComparisonVisual data={proofBar} onInspectFact={onInspectFact} />
                  )}

                  <p
                    className={`font-medium ${
                      item.verdict === 'did_not_work' || item.verdict === 'undone'
                        ? 'text-[#991B1B]'
                        : 'text-[#15803D]'
                    }`}
                  >
                    {toSimpleEnglish(item.verdictSentence)}
                  </p>

                  {item.detailSentence && (
                    <p className="text-[#43564A]">{toSimpleEnglish(item.detailSentence)}</p>
                  )}

                  {(item.beforeRefundRateFact || item.afterRefundRateFact) && (
                    <p className="text-[#43564A]">
                      {item.beforeRefundRateFact && (
                        <>
                          Before:{' '}
                          <FactValue
                            fact={item.beforeRefundRateFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                          />
                        </>
                      )}
                      {item.afterRefundRateFact && (
                        <>
                          {' · '}After:{' '}
                          <FactValue
                            fact={item.afterRefundRateFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                          />
                        </>
                      )}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#EFE8D6]">
                    <div className="flex flex-wrap items-center gap-3 text-[#43564A]">
                      {item.provenMoneyFact && (
                        <span>
                          Proven gain:{' '}
                          <FactValue
                            fact={item.provenMoneyFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                            className="font-semibold text-[#15803D]"
                          />
                        </span>
                      )}
                      {item.expectedWorthFact && (
                        <span>
                          Expected worth:{' '}
                          <FactValue
                            fact={item.expectedWorthFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                            className="font-semibold text-[#25372C]"
                          />
                        </span>
                      )}
                      {item.unitsReturnedFact && (
                        <span>
                          Returned:{' '}
                          <FactValue
                            fact={item.unitsReturnedFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                          />
                        </span>
                      )}
                    </div>

                    {item.canUndo && (
                      <button
                        type="button"
                        disabled={isRequestInFlight}
                        onClick={() => onUndoAction(item.decisionId)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white hover:bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Undo</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Inline built refund desk after switch is active */}
        {refundTool && !refundSwitchNeedsTurnOn && (
          <InlineBuiltRefundToolCard
            tool={refundTool}
            rows={dayState.refundRows ?? []}
            switchEnabled={Boolean(dayState.refundSwitchEnabled)}
            reviewedIds={dayState.reviewedRefundIds ?? []}
            unreviewedFact={dayState.toolUnreviewedFact}
            isBusy={isRequestInFlight}
            demoHighlight={demoHighlight}
            highlightBadgeText={highlightBadgeText}
            onInspectFact={onInspectFact}
            onToggleReviewed={onToggleRefundReviewed}
            onApproveRefundSwitch={onApproveRefundSwitch}
          />
        )}
      </section>

      {/* Section 4: Warnings you turned down (appears once Not now or Dismiss was clicked) */}
      {turnedDownWarnings.length > 0 && (
        <section
          aria-labelledby="simple-turned-down"
          data-testid="warnings-turned-down-section"
          className="space-y-2.5"
        >
          <h2 id="simple-turned-down" className="text-base font-semibold text-[#25372C]">
            Warnings you turned down
          </h2>
          <ul className="space-y-2.5">
            {turnedDownWarnings.map((tw) => (
              <li
                key={`${tw.candidateId}-${tw.reactionDate}`}
                className="bg-white border border-[#EBD2CC] rounded-2xl p-4 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[#25372C]">{tw.title}</span>
                  <span className="text-[#991B1B] font-semibold">
                    Lost since turned down:{' '}
                    <FactValue
                      fact={tw.lostSinceTurnedDownFact}
                      onInspect={onInspectFact}
                      noPlus
                      plainFont
                    />
                  </span>
                </div>
                <p className="text-[#56695D]">
                  {tw.reaction === 'dismiss'
                    ? `Dismissed (${tw.dismissReasonLabel ?? 'other'})`
                    : 'Chose Not now'}{' '}
                  on {formatShortDate(tw.reactionDate)}. At stake:{' '}
                  <FactValue fact={tw.weeklyStakeFact} onInspect={onInspectFact} noPlus plainFont />
                  /week.
                </p>
                {tw.byStore.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {tw.byStore.map((bs) => (
                      <span
                        key={`${tw.candidateId}-${bs.storeId}`}
                        className="px-2.5 py-1 rounded-md bg-[#FFFDF7] border border-[#EFE8D6] text-[#5C3A36]"
                      >
                        {bs.storeName}:{' '}
                        <FactValue fact={bs.lostFact} onInspect={onInspectFact} noPlus plainFont />
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Track record */}
      {dayState.autonomyRecord && (
        <section aria-labelledby="simple-track-record" className="space-y-2.5">
          <h2 id="simple-track-record" className="text-base font-semibold text-[#25372C]">
            Track record
          </h2>
          <div className="bg-white border border-[#E5DCC7] rounded-2xl p-4 text-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-sm text-[#25372C]">
                {dayState.autonomyRecord.kindLabel}
              </span>
              <span className="px-2.5 py-0.5 rounded-md border border-[#D8CEB8] bg-[#FFFDF7] text-[#25372C] font-medium">
                {toSimpleEnglish(dayState.autonomyRecord.levelLabel)}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-[#FFFDF7] border border-[#EFE8D6]">
              <div>
                <p className="text-[#56695D]">Cases</p>
                <p className="mt-0.5 font-semibold text-[#25372C]">
                  <FactValue
                    fact={dayState.autonomyRecord.casesFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                  />
                </p>
              </div>
              <div>
                <p className="text-[#56695D]">Worked</p>
                <p className="mt-0.5 font-semibold text-[#25372C]">
                  <FactValue
                    fact={dayState.autonomyRecord.workedFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                  />
                </p>
              </div>
              <div>
                <p className="text-[#56695D]">Proven with comparison</p>
                <p className="mt-0.5 font-semibold text-[#25372C]">
                  <FactValue
                    fact={dayState.autonomyRecord.provenFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                  />
                </p>
              </div>
              <div>
                <p className="text-[#56695D]">Total gain</p>
                <p className="mt-0.5 font-semibold text-[#15803D]">
                  <FactValue
                    fact={dayState.autonomyRecord.pooledMoneyFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                  />
                </p>
              </div>
            </div>
            <p className="text-[#56695D] leading-snug">
              Rule to act alone: {toSimpleEnglish(dayState.autonomyRecord.earnRuleText)}
            </p>
          </div>
        </section>
      )}

      {/* Section 5: Noticed, checked, and stayed quiet */}
      <section aria-labelledby="simple-quiet" className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuietOpen((v) => !v)}
            className="inline-flex items-center gap-2 text-left cursor-pointer"
          >
            <h2 id="simple-quiet" className="text-base font-semibold text-[#25372C]">
              Noticed, checked, and stayed quiet
            </h2>
            {quietOpen ? (
              <ChevronUp className="w-4 h-4 text-[#56695D]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#56695D]" />
            )}
          </button>
          <span className="text-xs text-[#56695D]">
            (<FactValue fact={quietCountFact} onInspect={onInspectFact} noPlus plainFont />)
          </span>
        </div>

        {quietOpen && (
          <div className="space-y-2">
            {groupedLetGo.length === 0 ? (
              <p className="text-sm text-[#56695D]">Nothing checked yet.</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {visibleQuiet.map((group) => {
                    const isOpen = !!openQuietIds[group.id];
                    const storeNames = Array.from(
                      new Set(
                        group.items
                          .map((it) => it.storeName)
                          .filter((name): name is string => !!name),
                      ),
                    );
                    return (
                      <li
                        key={group.id}
                        className="bg-white border border-[#E5DCC7] rounded-xl overflow-hidden text-xs"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenQuietIds((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                          }
                          className="w-full text-left px-3.5 py-2.5 flex items-baseline justify-between gap-3 hover:bg-[#FFFDF7] cursor-pointer"
                        >
                          <div>
                            <p className="text-sm font-medium text-[#25372C]">
                              {toSimpleEnglish(group.headline)}
                            </p>
                            {storeNames.length > 0 && (
                              <p className="text-[#56695D] mt-0.5">{storeNames.join(', ')}</p>
                            )}
                          </div>
                          <span className="text-[#56695D] shrink-0">
                            {formatShortDate(group.date)}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="px-3.5 pb-3 pt-2 border-t border-[#EFE8D6] bg-[#FFFDF7] space-y-2">
                            {group.items.map((it) => (
                              <div key={it.candidateId} className="space-y-0.5">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <span className="font-medium text-[#25372C]">
                                    {it.storeName ?? 'All established stores'} (
                                    {formatShortDate(it.date)})
                                  </span>
                                  <span className="text-[#56695D]">
                                    Actual:{' '}
                                    <FactValue
                                      fact={it.actual}
                                      onInspect={onInspectFact}
                                      noPlus
                                      plainFont
                                    />{' '}
                                    · Expected:{' '}
                                    <FactValue
                                      fact={it.expected}
                                      onInspect={onInspectFact}
                                      noPlus
                                      plainFont
                                    />
                                  </span>
                                </div>
                                <p className="text-[#56695D]">{toSimpleEnglish(it.reason)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {groupedLetGo.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllQuiet((v) => !v)}
                    className="text-xs font-medium text-[#25372C] underline cursor-pointer"
                  >
                    {showAllQuiet ? 'Show latest 5' : `Show all ${groupedLetGo.length}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* Three helpers strip */}
      <TeamPanel
        dayState={dayState}
        activeInvestigation={activeInvestigation}
        builderProgressByCandidate={builderProgressByCandidate}
      />
    </div>
  );
}
