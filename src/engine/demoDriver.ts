import { BuilderRequirement, DayState } from '../types/domain';
import { ActiveInvestigationBanner, DemoHighlightState } from '../components/OwnerFeed';

export interface ScriptedDemoBeat {
  id: string;
  caption: string;
  highlight: DemoHighlightState | null;
  action:
    | { type: 'approve_card'; candidateId: string }
    | { type: 'start_build'; candidateId: string }
    | { type: 'confirm_build'; candidateId: string }
    | { type: 'open_and_switch'; toolId: string; candidateId: string }
    | { type: 'accept_autonomy'; offerId: string };
}

/**
 * Pure calm one-line status indicator for the top of the left column (Part B #3).
 */
export function computeCalmStatusLine(params: {
  dayState: DayState;
  activeInvestigation: ActiveInvestigationBanner | null;
  builderProgressByCandidate: Record<string, string>;
}): string {
  const { dayState, activeInvestigation, builderProgressByCandidate } = params;
  const builderKeys = Object.keys(builderProgressByCandidate);

  if (builderKeys.length > 0) {
    return 'Developer: building and checking your store tool.';
  }
  if (activeInvestigation) {
    return `Data scientist: checking ${activeInvestigation.title}.`;
  }
  if (
    dayState.raised.length > 0 ||
    dayState.autonomyRecord?.offerCard?.status === 'pending'
  ) {
    return 'Needs your decision.';
  }
  if (
    dayState.dayIndex === dayState.totalDays - 1 &&
    dayState.doneForYou?.some((d) => d.verdict === 'worked_proven')
  ) {
    return 'Done. Proven.';
  }
  if ((dayState.inProgress?.length ?? 0) > 0) {
    return 'Acting. Waiting for the result.';
  }

  const todayTrace = dayState.trace.find((t) => t.date === dayState.date);
  if (todayTrace?.lane === 'manager' && todayTrace.outcome === 'let_go') {
    return 'Manager: checked a signal today and let it go.';
  }
  if ((dayState.doneForYou?.length ?? 0) > 0 && dayState.doneForYou![0].closedOn === dayState.date) {
    return 'Done. Proven.';
  }

  return 'Watching. Nothing unusual.';
}

/**
 * Returns the current scripted Watch-it-run beat waiting to execute on `dayState`,
 * or null if the clock should advance cleanly to the next day.
 */
export function selectNextWatchDemoBeat(params: {
  dayState: DayState;
  pendingRequirements: Record<string, BuilderRequirement>;
  executedBeatKeys: Set<string>;
}): ScriptedDemoBeat | null {
  const { dayState, pendingRequirements, executedBeatKeys } = params;

  // 1. Indigo Autonomy Offer Card (~Oct 23)
  const offer = dayState.autonomyRecord?.offerCard;
  if (offer && offer.status === 'pending') {
    const key = `beat:autonomy:${offer.id}`;
    if (!executedBeatKeys.has(key)) {
      return {
        id: key,
        caption:
          'Three small stock moves worked out of three, with one proven against a held-out store; agreeing to let OpsCien act alone under 500 units.',
        highlight: { actionKey: 'autonomy_yes', label: 'Yes, within those limits' },
        action: { type: 'accept_autonomy', offerId: offer.id },
      };
    }
  }

  // 2. If refund tool was just installed and switch is still off, open tool and enable $50 switch
  const refundTool = (dayState.builtTools ?? []).find(
    (t) => t.id === 'tool:refund_exceptions_desk:walnut_creek',
  );
  if (refundTool && !dayState.refundSwitchEnabled) {
    const key = `beat:switch:${refundTool.id}`;
    if (!executedBeatKeys.has(key)) {
      return {
        id: key,
        caption:
          'Opening the Refund exceptions desk at Walnut Creek and switching on manager approval for cash refunds over $50.',
        highlight: { actionKey: `open_tool:${refundTool.id}`, label: 'Open tool' },
        action: {
          type: 'open_and_switch',
          toolId: refundTool.id,
          candidateId: refundTool.situationId,
        },
      };
    }
  }

  // 3. Check open "Needs you" cards in chronological priority
  for (const item of dayState.raised) {
    // 3a. Walnut Creek refunds tool_to_build
    if (item.investigation?.outcomeKind === 'tool_to_build') {
      if (pendingRequirements[item.candidateId]) {
        const key = `beat:build_it:${item.candidateId}`;
        if (!executedBeatKeys.has(key)) {
          return {
            id: key,
            caption:
              'Gemini wrote the requirement for the Walnut Creek refund desk; building it and running three checks inside a sandbox.',
            highlight: { actionKey: `build_it:${item.candidateId}`, label: 'Build it' },
            action: { type: 'confirm_build', candidateId: item.candidateId },
          };
        }
      } else {
        const key = `beat:build:${item.candidateId}`;
        if (!executedBeatKeys.has(key)) {
          return {
            id: key,
            caption:
              'Late evening cash refunds at Walnut Creek need a store desk rather than a stock move; asking Gemini to plan the tool.',
            highlight: { actionKey: `build:${item.candidateId}`, label: 'Build' },
            action: { type: 'start_build', candidateId: item.candidateId },
          };
        }
      }
      continue;
    }

    // 3b. Best-sellers Sep 8 / Knitwear WC Sep 25 / Rollout Sep 30 / Pasadena Knitwear Oct 15
    const key = `beat:approve:${item.candidateId}:${item.firstDetectedOn}`;
    if (!executedBeatKeys.has(key)) {
      let caption = `Approving ${item.title.toLowerCase()} through the gateway safety checks.`;
      if (item.candidateId === 'situation:stock_running_out:best_sellers') {
        caption =
          'Best-sellers stock is running low at three stores; approving a safe transfer from stores with stock to spare while holding Santana Row out to prove it works.';
      } else if (item.isRollout) {
        caption =
          'Proven against Santana Row as the comparison store; rolling out the remaining Best-sellers stock move now.';
      } else if (item.candidateId === 'situation:stock_running_out:knitwear') {
        caption =
          'A single-store Knitwear shortage under 500 units was checked quickly; approving the transfer.';
      }
      return {
        id: key,
        caption,
        highlight: { actionKey: `approve:${item.candidateId}`, label: 'Approve' },
        action: { type: 'approve_card', candidateId: item.candidateId },
      };
    }
  }

  return null;
}

/**
 * Ambient 1-sentence caption during Watch it run when no interactive beat is waiting.
 */
export function selectWatchCaptionForDay(dayState: DayState): string {
  if (dayState.dayIndex === dayState.totalDays - 1) {
    return '14 November complete: reviewing the money result, noticing accuracy, costs, and built tools.';
  }
  const latestAuto = (dayState.doneForYou ?? []).find(
    (d) => d.isAutonomous && d.approvedOn === dayState.date,
  );
  if (latestAuto) {
    return `${latestAuto.title} stayed within your 500-unit rule, so OpsCien acted automatically and logged it under Done for you.`;
  }
  if (dayState.date >= '2026-08-01' && dayState.date <= '2026-09-07') {
    return 'Watching daily trading through August and the Labor Day weekend while letting seasonal noise pass quietly.';
  }
  if (dayState.date >= '2026-10-04' && dayState.date <= '2026-10-14') {
    return 'Tracking Walnut Creek cash refunds under the new $50 approval switch and checking comparable stores.';
  }
  return 'Watching all 10 stores daily and checking each signal before raising anything.';
}
