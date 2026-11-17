import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import {
  BuilderRequirement,
  DayState,
  DismissReason,
  Fact,
  RaisedItem,
} from '../../types/domain';
import { FactValue } from '../FactValue';
import { BuilderErrorState, DemoHighlightState } from '../OwnerFeed';
import { RawTextSegments, SimpleTextSegments, toSimpleEnglish } from './SimpleHelpers';
import {
  ProofComparisonVisual,
  RefundComparisonVisual,
  StockShortageVisual,
  TransferFlowVisual,
} from './VisualDiagrams';

interface SimpleProblemCardProps {
  item: RaisedItem;
  dayState: DayState;
  isBusy: boolean;
  buttonsDisabled: boolean;
  pendingReq?: BuilderRequirement;
  buildProgress?: string;
  buildErr?: BuilderErrorState;
  demoHighlight?: DemoHighlightState | null;
  highlightBadgeText?: string;
  onInspectFact: (fact: Fact) => void;
  onApproveCard?: (candidateId: string) => void;
  onNotNowCard?: (candidateId: string) => void;
  onDismissCard?: (candidateId: string, reason: DismissReason) => void;
  onLookAgainCard?: (candidateId: string) => void;
  onStartBuildRequirement?: (candidateId: string) => void;
  onConfirmBuildTool?: (candidateId: string) => void;
  onCancelRequirement?: (candidateId: string) => void;
  onAskStoreManager?: (candidateId: string) => void;
}

const DISMISS_REASONS: Array<{ value: DismissReason; label: string }> = [
  { value: 'not_important', label: 'Not important' },
  { value: 'already_known', label: 'Already known' },
  { value: 'wrong', label: 'Wrong' },
  { value: 'not_mine', label: 'Not mine' },
];

function buildAccurateTitle(item: RaisedItem): string {
  const base = toSimpleEnglish(item.title);
  if (item.detectorKind === 'stock_running_out' && item.groupId === 'best_sellers' && !item.isRollout) {
    const count = item.stores?.length ?? 3;
    if (count === 1 && item.stores?.[0]) {
      return `Best-sellers running low at ${item.stores[0].storeName}`;
    }
    return `Best-sellers running low at ${count} big stores`;
  }
  if (item.isRollout) {
    return 'Send the rest of Best-sellers stock to Santana Row';
  }
  if (item.detectorKind === 'refunds_out_of_line') {
    return 'Cash refunds with no matching sale at Walnut Creek';
  }
  if (item.detectorKind === 'stock_running_out' && item.groupId === 'knitwear') {
    const storeName =
      item.stores?.[0]?.storeName ??
      item.transferPlan?.transferLines[0]?.toStoreName ??
      item.investigation?.transferPlan?.transferLines[0]?.toStoreName;
    if (storeName) return `Knitwear running low at ${storeName}`;
  }
  return base;
}

function describeSuggestedLine(item: RaisedItem): string {
  const sc = item.secondCheck ?? item.investigation?.secondCheck;
  if (sc?.status === 'disagreed') {
    return 'Two checks disagreed. Check these store numbers again.';
  }
  const plan = item.transferPlan ?? item.investigation?.transferPlan;
  if (plan) {
    const dest =
      plan.treatedStoreIds.length === 1
        ? plan.transferLines[0]?.toStoreName ?? 'the short store'
        : `${plan.treatedStoreIds.length} short stores`;
    if (plan.holdoutStoreName) {
      return `Move ${plan.totalUnitsFact.formatted} to ${dest}. Hold ${plan.holdoutStoreName} back to compare.`;
    }
    return `Move ${plan.totalUnitsFact.formatted} from stores with spare stock to ${dest}.`;
  }
  if (item.investigation?.outcomeKind === 'tool_to_build') {
    return 'Build a refund check screen and require approval for cash refunds over $50.';
  }
  if (item.isRollout) {
    return 'Send the remaining Best-sellers stock to Santana Row.';
  }
  return toSimpleEnglish(item.investigation?.outcomeDetail ?? 'Review and choose a next step.');
}

export function SimpleProblemCard({
  item,
  dayState,
  isBusy,
  buttonsDisabled,
  pendingReq,
  buildProgress,
  buildErr,
  demoHighlight,
  highlightBadgeText = 'The demo chooses this',
  onInspectFact,
  onApproveCard,
  onNotNowCard,
  onDismissCard,
  onLookAgainCard,
  onStartBuildRequirement,
  onConfirmBuildTool,
  onCancelRequirement,
  onAskStoreManager,
}: SimpleProblemCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  const inv = item.investigation;
  const sc = item.secondCheck ?? inv?.secondCheck;
  const plan = item.transferPlan ?? inv?.transferPlan;
  const checksDisagree = sc?.status === 'disagreed';
  const isToolToBuild = inv?.outcomeKind === 'tool_to_build';
  const stakeFact = item.todayStakePerWeek ?? item.stakePerWeek;
  const vm = item.visualMetrics;

  const askedManagerAct = (dayState.inProgress ?? []).find(
    (a) => a.candidateId === item.candidateId && a.isSimulatedTask,
  );
  const doneManagerAct = (dayState.doneForYou ?? []).find(
    (d) => d.candidateId === item.candidateId,
  );

  const approveBtnKey = `approve:${item.candidateId}`;
  const buildBtnKey = `build:${item.candidateId}`;
  const buildItBtnKey = `build_it:${item.candidateId}`;

  const highlightRing = (key: string) =>
    demoHighlight?.actionKey === key
      ? 'ring-2 ring-offset-2 ring-[#25372C] shadow-md'
      : '';

  const cardTitle = buildAccurateTitle(item);
  const evidenceList = item.evidence ?? [];
  const headerDateStr = item.reRaisedOn ? dayState.date : item.firstDetectedOn;
  const tourTarget = item.isRollout
    ? 'rollout_card'
    : item.detectorKind === 'refunds_out_of_line'
      ? 'refund_card'
      : item.candidateId === 'situation:stock_running_out:best_sellers'
        ? 'best_sellers_card'
        : undefined;

  const storeNamesList = (item.stores ?? []).map((s) => s.storeName);
  const storeListText =
    storeNamesList.length === 0
      ? 'This store'
      : storeNamesList.length === 1
        ? storeNamesList[0]
        : storeNamesList.length === 2
          ? `${storeNamesList[0]} and ${storeNamesList[1]}`
          : `${storeNamesList.slice(0, -1).join(', ')}, and ${storeNamesList[storeNamesList.length - 1]}`;
  const groupLabel = item.groupId === 'knitwear' ? 'Knitwear' : 'Best-sellers';
  const proofBar = vm?.proofBarData;

  return (
    <article
      data-card-id={item.candidateId}
      data-tour-target={tourTarget}
      className="simple-card-enter bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-2xs"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#FEF3C7] text-[#78350F] border border-[#FDE68A]">
            Needs your decision
          </span>
          <h3 className="mt-1.5 text-base font-semibold text-[#25372C] leading-snug">
            {cardTitle}
          </h3>
        </div>
        <span className="text-xs text-[#56695D] shrink-0">
          {formatShortDate(headerDateStr)}
        </span>
      </div>

      {/* Returned after "Not now" */}
      {item.reRaisedOn && (
        <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs space-y-1">
          <p className="font-medium text-[#78350F]">
            Put aside on {item.deferredOn ? formatShortDate(item.deferredOn) : 'an earlier day'}{' '}
            (first raised {formatShortDate(item.firstDetectedOn)}). Raised again today.
          </p>
          {item.costOfDelayFact && (
            <p className="text-[#25372C]">
              Lost while waiting:{' '}
              <FactValue
                fact={item.costOfDelayFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
                className="font-semibold text-[#991B1B]"
              />
              {storeNamesList.length > 0 && (
                <span className="text-[#56695D]"> ({storeNamesList.join(', ')})</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Four invariant plain lines built from Facts */}
      <dl className="space-y-2 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-[132px_1fr] gap-0.5 sm:gap-2">
          <dt className="text-xs font-semibold text-[#56695D]">What is happening</dt>
          <dd className="text-[#25372C] leading-snug">
            {item.isRollout ? (
              proofBar ? (
                <>
                  {proofBar.treatedNames} got stock and kept selling (
                  <FactValue fact={proofBar.treatedPctFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                  of expected vs{' '}
                  <FactValue fact={proofBar.holdoutPctFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                  at {proofBar.holdoutName}).
                </>
              ) : (
                <span>{toSimpleEnglish(item.summary)}</span>
              )
            ) : item.detectorKind === 'refunds_out_of_line' ? (
              vm?.walnutCreekRefundRateFact && vm?.peerRefundRateFact ? (
                <>
                  Walnut Creek cash refunds are{' '}
                  <FactValue
                    fact={vm.walnutCreekRefundRateFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                  />
                  , compared with{' '}
                  <FactValue fact={vm.peerRefundRateFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                  at the other 7 stores open more than 18 months.
                </>
              ) : (
                <span>{toSimpleEnglish(item.summary)}</span>
              )
            ) : vm?.daysOfStockLeftFact && vm?.currentCoverFact ? (
              vm.daysOfStockLeftFact.value <= 0 ? (
                <>
                  {storeListText} {storeNamesList.length === 1 ? 'has' : 'have'} run out of{' '}
                  {groupLabel}. {storeNamesList.length === 1 ? 'It is' : 'They are'} losing sales
                  every day
                  {vm.daysUntilDeliveryFact ? (
                    <>
                      {' '}
                      until next delivery in{' '}
                      <FactValue
                        fact={vm.daysUntilDeliveryFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                      .
                    </>
                  ) : (
                    '. No delivery is planned.'
                  )}
                </>
              ) : (
                <>
                  Sales are normal. {storeListText} will run out of {groupLabel} in{' '}
                  <FactValue fact={vm.daysOfStockLeftFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                  (<FactValue fact={vm.currentCoverFact} onInspect={onInspectFact} noPlus plainFont />)
                  {vm.daysUntilDeliveryFact ? (
                    <>
                      , before next delivery in{' '}
                      <FactValue
                        fact={vm.daysUntilDeliveryFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                      .
                    </>
                  ) : (
                    '. No delivery is planned.'
                  )}
                </>
              )
            ) : (
              <span>{toSimpleEnglish(item.summary)}</span>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[132px_1fr] gap-0.5 sm:gap-2">
          <dt className="text-xs font-semibold text-[#56695D]">Why</dt>
          <dd className="text-[#25372C] leading-snug">
            {item.isRollout ? (
              proofBar ? (
                <>
                  Holding {proofBar.holdoutName} back proved the stock caused the gain
                  {proofBar.provenGainFact ? (
                    <>
                      {' '}
                      (
                      <FactValue
                        fact={proofBar.provenGainFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />{' '}
                      so far).
                    </>
                  ) : (
                    '.'
                  )}
                </>
              ) : (
                'The test against the store held back for comparison proved the transfer saved sales.'
              )
            ) : item.detectorKind === 'refunds_out_of_line' ? (
              'Most of the extra refunds are late-evening cash refunds with no matching sale on Till 2 by one staff member.'
            ) : (
              <>
                Nothing is wrong with demand. Stock is simply low there
                {vm?.spareStoreCountFact &&
                vm?.spareTotalUnitsFact &&
                vm.spareStoreCountFact.value > 0 ? (
                  <>
                    , while{' '}
                    <FactValue
                      fact={vm.spareStoreCountFact}
                      onInspect={onInspectFact}
                      noPlus
                      plainFont
                    />{' '}
                    other stores have{' '}
                    <FactValue
                      fact={vm.spareTotalUnitsFact}
                      onInspect={onInspectFact}
                      noPlus
                      plainFont
                    />{' '}
                    to spare.
                  </>
                ) : (
                  '.'
                )}
              </>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[132px_1fr] gap-0.5 sm:gap-2">
          <dt className="text-xs font-semibold text-[#56695D]">What I suggest</dt>
          <dd className="font-medium text-[#25372C] leading-snug">
            {sc?.status === 'disagreed' ? (
              'Two checks disagreed. Check these store numbers again.'
            ) : item.isRollout && plan ? (
              <>
                Send <FactValue fact={plan.totalUnitsFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                of remaining {groupLabel} stock to{' '}
                {plan.transferLines[0]?.toStoreName ?? proofBar?.holdoutName ?? 'Santana Row'} (arrives{' '}
                {formatShortDate(plan.arrivalDate)}).
              </>
            ) : item.detectorKind === 'refunds_out_of_line' ? (
              'Build a refund check screen and require manager approval for cash refunds over $50.'
            ) : plan ? (
              <>
                Move <FactValue fact={plan.totalUnitsFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                from stores with spare stock to{' '}
                {plan.treatedStoreIds.length === 1
                  ? plan.transferLines[0]?.toStoreName ?? storeListText
                  : `${plan.treatedStoreIds.length} short stores`}
                {plan.holdoutStoreName ? `; hold ${plan.holdoutStoreName} back to compare` : ''}.
              </>
            ) : (
              describeSuggestedLine(item)
            )}
          </dd>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[132px_1fr] gap-0.5 sm:gap-2">
          <dt className="text-xs font-semibold text-[#56695D]">If you do nothing</dt>
          <dd className="text-[#991B1B] font-medium leading-snug">
            {item.isRollout ? (
              <>
                Lose about <FactValue fact={stakeFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                each week at{' '}
                {proofBar?.holdoutName ?? plan?.transferLines[0]?.toStoreName ?? 'Santana Row'}.
              </>
            ) : item.detectorKind === 'refunds_out_of_line' ? (
              <>
                Lose about <FactValue fact={stakeFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                each week.
              </>
            ) : (
              <>
                Lose about <FactValue fact={stakeFact} onInspect={onInspectFact} noPlus plainFont />{' '}
                each week.
                {vm?.daysUntilDeliveryFact &&
                  vm?.doNothingLossFact &&
                  vm.doNothingLossFact.value > 0 && (
                    <span>
                      {' '}
                      Total before next delivery:{' '}
                      <FactValue
                        fact={vm.doNothingLossFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                      .
                    </span>
                  )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {/* Embedded visual diagrams */}
      {!item.isRollout && vm?.daysOfStockLeftFact && (
        <StockShortageVisual metrics={vm} onInspectFact={onInspectFact} />
      )}
      {vm?.proofBarData && (
        <ProofComparisonVisual data={vm.proofBarData} onInspectFact={onInspectFact} />
      )}
      {plan && <TransferFlowVisual plan={plan} onInspectFact={onInspectFact} />}
      {vm?.refundStoreComparison && vm.refundStoreComparison.length > 0 && (
        <RefundComparisonVisual rows={vm.refundStoreComparison} onInspectFact={onInspectFact} />
      )}

      {/* Pending Builder Requirement sheet */}
      {isToolToBuild && pendingReq && (
        <div
          data-testid="builder-requirement-panel"
          className="p-3.5 rounded-xl bg-[#F4F8F5] border border-[#CFE0D4] text-xs space-y-2.5"
        >
          <p className="font-semibold text-[#25372C]">
            Plan for store desk: {pendingReq.title}
          </p>
          <dl className="space-y-1.5 text-[#25372C]">
            <div>
              <dt className="font-semibold text-[#56695D]">What it is for</dt>
              <dd className="leading-snug">
                <SimpleTextSegments segments={pendingReq.purpose} onInspectFact={onInspectFact} />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#56695D]">Who uses it</dt>
              <dd className="leading-snug">
                <SimpleTextSegments segments={pendingReq.users} onInspectFact={onInspectFact} />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#56695D]">What it shows</dt>
              <dd className="leading-snug">
                <SimpleTextSegments segments={pendingReq.shows} onInspectFact={onInspectFact} />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#56695D]">What you can do inside it</dt>
              <dd className="leading-snug">
                <SimpleTextSegments segments={pendingReq.actions} onInspectFact={onInspectFact} />
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#56695D]">Checks before handover</dt>
              <dd className="leading-snug">
                <SimpleTextSegments
                  segments={pendingReq.verification}
                  onInspectFact={onInspectFact}
                />
              </dd>
            </div>
          </dl>

          {buildProgress && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-[#CFE0D4] text-[#25372C] font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{toSimpleEnglish(buildProgress)}</span>
            </div>
          )}

          {buildErr && (
            <div
              role="alert"
              className="p-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] space-y-1"
            >
              <p className="font-semibold">{buildErr.message}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {buildErr.failures.map((f, i) => (
                  <li key={`bfail-${i}`}>{toSimpleEnglish(f)}</li>
                ))}
              </ul>
            </div>
          )}

          {demoHighlight?.actionKey === buildItBtnKey && (
            <p className="text-xs font-medium text-[#25372C] bg-white px-2.5 py-1 rounded-md border border-[#CFE0D4]">
              {highlightBadgeText}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={buttonsDisabled}
              onClick={() => onConfirmBuildTool?.(item.candidateId)}
              className={`px-4 py-2 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                buildItBtnKey,
              )}`}
            >
              {buildProgress ? 'Building and testing...' : 'Build it'}
            </button>
            <button
              type="button"
              disabled={buttonsDisabled}
              onClick={() => onCancelRequirement?.(item.candidateId)}
              className="px-3.5 py-2 bg-white hover:bg-[#F5EEDD] disabled:opacity-50 text-[#25372C] border border-[#D8CEB8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Demo or Tour helper badge */}
      {demoHighlight &&
        (demoHighlight.actionKey === approveBtnKey || demoHighlight.actionKey === buildBtnKey) && (
          <p className="text-xs font-medium text-[#25372C] bg-[#E8F1EC] px-2.5 py-1 rounded-md border border-[#C6DBC9] inline-block">
            {highlightBadgeText}
          </p>
        )}

      {/* Primary action bar */}
      {!(isToolToBuild && pendingReq) && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {checksDisagree ? (
                <button
                  type="button"
                  disabled={buttonsDisabled}
                  onClick={() => onLookAgainCard?.(item.candidateId)}
                  className="px-4 py-2 bg-[#B45309] hover:bg-[#92400E] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {isBusy ? 'Checking again...' : 'Look again'}
                </button>
              ) : isToolToBuild ? (
                <>
                  <button
                    type="button"
                    disabled={buttonsDisabled}
                    onClick={() => onStartBuildRequirement?.(item.candidateId)}
                    className={`px-4 py-2 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
                      buildBtnKey,
                    )}`}
                  >
                    {isBusy ? 'Preparing...' : 'Build'}
                  </button>

                  {askedManagerAct ? (
                    <span className="px-3 py-1.5 bg-[#FFFDF7] border border-[#DFD5BE] text-[#56695D] text-xs rounded-lg">
                      Asked store manager · due {formatShortDate(askedManagerAct.endDate)}
                    </span>
                  ) : doneManagerAct ? (
                    <span className="px-3 py-1.5 bg-[#FFFDF7] border border-[#DFD5BE] text-[#56695D] text-xs rounded-lg">
                      Store manager reply received
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={buttonsDisabled}
                      onClick={() => onAskStoreManager?.(item.candidateId)}
                      className="px-3.5 py-2 bg-white hover:bg-[#F5EEDD] disabled:opacity-50 text-[#25372C] border border-[#D8CEB8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
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
                  className={`px-4 py-2 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${highlightRing(
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
                className="px-3.5 py-2 bg-white hover:bg-[#F5EEDD] disabled:opacity-50 text-[#25372C] border border-[#D8CEB8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Not now
              </button>

              <button
                type="button"
                disabled={buttonsDisabled}
                onClick={() => setDismissOpen((v) => !v)}
                className="px-3.5 py-2 bg-white hover:bg-[#F5EEDD] disabled:opacity-50 text-[#56695D] border border-[#D8CEB8] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#25372C] hover:underline cursor-pointer"
            >
              <span>{detailsOpen ? 'Hide details' : 'See details'}</span>
              {detailsOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <p className="text-[11px] text-[#56695D]">
            Not now: I will ask again. Each week of waiting costs about{' '}
            <FactValue fact={stakeFact} onInspect={onInspectFact} noPlus plainFont />. Dismiss: I stop
            raising this for these stores.
          </p>

          {dismissOpen && (
            <div className="p-2.5 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#56695D] mr-1">Why dismiss this?</span>
              {DISMISS_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={buttonsDisabled}
                  onClick={() => {
                    setDismissOpen(false);
                    onDismissCard?.(item.candidateId, r.value);
                  }}
                  className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-[#F5EEDD] disabled:opacity-50 border border-[#D8CEB8] rounded-md text-[#25372C] cursor-pointer"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsible plain-English details */}
      {detailsOpen && (
        <div className="pt-3 border-t border-[#EFE8D6] space-y-3 text-xs">
          {inv && !item.isRollout && (
            <div className="p-2.5 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6] space-y-1 text-[#25372C]">
              <p className="font-semibold text-[#56695D]">Full analysis</p>
              <p className="leading-snug">
                <RawTextSegments segments={inv.findingSegments} onInspectFact={onInspectFact} />
              </p>
              <p className="leading-snug text-[#43564A]">
                <RawTextSegments segments={inv.causeSegments} onInspectFact={onInspectFact} />
              </p>
              {vm?.spareTotalUnitsFact && (
                <p className="leading-snug text-[#56695D] pt-0.5">
                  The card uses a stricter rule for what each store must keep, so it shows fewer spare units.
                </p>
              )}
            </div>
          )}
          {/* Stock threshold note if present */}
          {vm?.currentCoverFact && vm.alarmCoverFact && (
            <p className="p-2.5 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6] text-[#25372C]">
              Alarm line: <FactValue fact={vm.alarmCoverFact} onInspect={onInspectFact} noPlus plainFont />.
              Now: <FactValue fact={vm.currentCoverFact} onInspect={onInspectFact} noPlus plainFont />.
              {vm.daysUntilDeliveryFact ? (
                <>
                  {' '}
                  Next delivery: in{' '}
                  <FactValue fact={vm.daysUntilDeliveryFact} onInspect={onInspectFact} noPlus plainFont />.
                </>
              ) : (
                ' Next scheduled delivery: none on schedule.'
              )}
            </p>
          )}

          {/* Expected and Actual */}
          <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6]">
            <div>
              <p className="text-[#56695D]">Expected</p>
              <p className="mt-0.5 font-semibold text-[#25372C]">
                <FactValue fact={item.expected} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
            <div>
              <p className="text-[#56695D]">Actual</p>
              <p className="mt-0.5 font-semibold text-[#25372C]">
                <FactValue fact={item.actual} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
            <div>
              <p className="text-[#56695D]">Weekly loss</p>
              <p className="mt-0.5 font-semibold text-[#25372C]">
                <FactValue fact={stakeFact} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
          </div>

          {/* Two-way check */}
          {sc && (
            <div
              className={`px-3 py-2 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${
                sc.status === 'matched'
                  ? 'bg-[#F4FBF6] border-[#BBF7D0] text-[#14532D]'
                  : sc.status === 'disagreed'
                    ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
                    : 'bg-[#FFFDF7] border-[#E5DCC7] text-[#56695D]'
              }`}
            >
              <span className="font-medium">
                {sc.status === 'matched' ? 'Passed two ways' : toSimpleEnglish(sc.label)}
              </span>
              {sc.secondValueFact && (
                <span>
                  First check:{' '}
                  <FactValue fact={sc.firstValueFact} onInspect={onInspectFact} noPlus plainFont /> ·
                  Second check:{' '}
                  <FactValue fact={sc.secondValueFact} onInspect={onInspectFact} noPlus plainFont />
                </span>
              )}
            </div>
          )}

          {/* What was ruled out */}
          {inv && inv.ruledOut.length > 0 && !item.isRollout && (
            <div>
              <p className="font-semibold text-[#56695D]">Other causes checked and ruled out</p>
              <ul className="mt-1.5 space-y-1">
                {inv.ruledOut.map((ro) => (
                  <li key={ro.kind} className="flex items-start gap-1.5 text-[#43564A]">
                    <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-0.5" />
                    <span>
                      {ro.summarySegments && ro.summarySegments.length > 0 ? (
                        <SimpleTextSegments
                          segments={ro.summarySegments}
                          onInspectFact={onInspectFact}
                        />
                      ) : (
                        toSimpleEnglish(ro.summary)
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Store-by-store transfer lines */}
          {plan && (
            <div className="p-2.5 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6] space-y-1">
              <p className="font-semibold text-[#25372C]">Store-by-store move plan</p>
              <ul className="space-y-0.5 text-[#56695D]">
                {plan.transferLines.map((l, idx) => (
                  <li key={`${l.fromStoreId}-${l.toStoreId}-${idx}`}>
                    {l.fromStoreName} to {l.toStoreName}: {l.units.toLocaleString('en-US')} units
                  </li>
                ))}
              </ul>
              <p className="text-[#56695D]">No store drops below its own safety floor.</p>
            </div>
          )}

          {/* Related signs */}
          {evidenceList.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setRelatedOpen((v) => !v)}
                className="text-xs font-medium text-[#25372C] underline cursor-pointer"
              >
                {relatedOpen
                  ? `Hide related signs (${evidenceList.length})`
                  : `See related signs (${evidenceList.length})`}
              </button>
              {relatedOpen && (
                <ul className="mt-2 space-y-1.5">
                  {evidenceList.map((ev) => (
                    <li
                      key={ev.candidateId}
                      className="p-2 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6]"
                    >
                      <p className="font-medium text-[#25372C]">{toSimpleEnglish(ev.title)}</p>
                      <p className="text-[#56695D]">
                        Actual:{' '}
                        <FactValue fact={ev.actual} onInspect={onInspectFact} noPlus plainFont /> ·
                        Expected:{' '}
                        <FactValue fact={ev.expected} onInspect={onInspectFact} noPlus plainFont />
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
