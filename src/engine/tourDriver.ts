import { LIVE_START_DATE, diffDays } from './calendar';
import { BuilderRequirement, DayState } from '../types/domain';
import { DemoHighlightState } from '../components/OwnerFeed';

export interface TourStopSpec {
  stepNumber: number; // 1..8
  totalSteps: number; // 8
  targetDate: string;
  targetDayIndex: number;
  title: string;
  explanation: string;
  highlight: DemoHighlightState | null;
  actionKind:
    | 'approve_best_sellers'
    | 'approve_wc_knitwear'
    | 'approve_rollout'
    | 'build_and_switch_refunds'
    | 'accept_autonomy'
    | 'advance_only'
    | 'finish';
}

export const TOUR_TOTAL_STEPS = 8;

const STEP_SPECS: Array<Omit<TourStopSpec, 'targetDayIndex' | 'highlight'>> = [
  {
    stepNumber: 1,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-08',
    title: 'Flagship stores running low on best-sellers',
    explanation:
      'Sales are normal, not falling. Two flagship stores are below 2.5 weeks of stock and Santana Row is next. Opscien suggests moving stock from stores with plenty, while holding Santana Row back for comparison.',
    actionKind: 'approve_best_sellers',
  },
  {
    stepNumber: 2,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-25',
    title: 'A smaller knitwear shortage',
    explanation:
      'Walnut Creek is running short on knitwear. Moving 479 units leaves plenty at other stores and avoids empty shelves. Because this is under 500 units at one store, Opscien measures before and after.',
    actionKind: 'approve_wc_knitwear',
  },
  {
    stepNumber: 3,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-27',
    title: 'Proven against the store held back',
    explanation:
      'Union Square and Palo Alto received stock and kept selling. Santana Row stayed held back and lost sales. Because stock was the only difference, Opscien asks to send the rest now.',
    actionKind: 'approve_rollout',
  },
  {
    stepNumber: 4,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-30',
    title: 'Cash refunds with no matching sale',
    explanation:
      'Walnut Creek has high evening cash refunds with no matching receipt on Till 2. Moving stock cannot fix a till rule. Opscien builds a tested review desk and sets a $50 manager approval switch.',
    actionKind: 'build_and_switch_refunds',
  },
  {
    stepNumber: 5,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-10-05',
    title: 'Earning the right to act alone',
    explanation:
      'Three small stock moves worked out of three, with one proven against comparison. Opscien asks if it can handle stock transfers under 500 units on its own and report after.',
    actionKind: 'accept_autonomy',
  },
  {
    stepNumber: 6,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-10-15',
    title: 'Acting within limits at Pasadena',
    explanation:
      'Pasadena ran low on knitwear under 500 units. Because you allowed small moves earlier, Opscien moved 424 units automatically, stayed within every limit, and gave you an Undo button.',
    actionKind: 'advance_only',
  },
  {
    stepNumber: 7,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-11-01',
    title: 'Acting within limits at Napa',
    explanation:
      'Napa opened late August and just ran short on knitwear under 500 units. Opscien handled the transfer automatically and logged the gain and Undo button under Done for you.',
    actionKind: 'advance_only',
  },
  {
    stepNumber: 8,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-11-14',
    title: 'The full 106-day money result',
    explanation:
      'This summary compares what would have been lost without Opscien against what was actually lost. Every figure opens its exact formula when tapped.',
    actionKind: 'finish',
  },
];

export function getTourStop(
  stepNumber: number,
  dayState?: DayState | null,
  pendingRequirements?: Record<string, BuilderRequirement>,
): TourStopSpec {
  const clamped = Math.max(1, Math.min(TOUR_TOTAL_STEPS, stepNumber));
  const base = STEP_SPECS[clamped - 1];
  const targetDayIndex = diffDays(LIVE_START_DATE, base.targetDate);

  let highlight: DemoHighlightState | null = null;
  if (dayState) {
    if (clamped === 1) {
      const card = dayState.raised.find(
        (r) => r.candidateId === 'situation:stock_running_out:best_sellers' && !r.isRollout,
      );
      if (card) {
        highlight = { actionKey: `approve:${card.candidateId}`, label: 'Approve' };
      }
    } else if (clamped === 2) {
      const card = dayState.raised.find(
        (r) => r.candidateId === 'situation:stock_running_out:knitwear',
      );
      if (card) {
        highlight = { actionKey: `approve:${card.candidateId}`, label: 'Approve' };
      }
    } else if (clamped === 3) {
      const rollout = dayState.raised.find((r) => r.isRollout);
      if (rollout) {
        highlight = { actionKey: `approve:${rollout.candidateId}`, label: 'Approve' };
      }
    } else if (clamped === 4) {
      const refundTool = (dayState.builtTools ?? []).find(
        (t) => t.id === 'tool:refund_exceptions_desk:walnut_creek',
      );
      const refundCard = dayState.raised.find(
        (r) => r.investigation?.outcomeKind === 'tool_to_build',
      );
      if (refundTool && !dayState.refundSwitchEnabled) {
        highlight = { actionKey: `open_tool:${refundTool.id}`, label: 'Turn on $50 approval rule' };
      } else if (refundCard) {
        if (pendingRequirements?.[refundCard.candidateId]) {
          highlight = { actionKey: `build_it:${refundCard.candidateId}`, label: 'Build it' };
        } else {
          highlight = { actionKey: `build:${refundCard.candidateId}`, label: 'Build' };
        }
      }
    } else if (clamped === 5) {
      if (dayState.autonomyRecord?.offerCard?.status === 'pending') {
        highlight = { actionKey: 'autonomy_yes', label: 'Yes, within those limits' };
      }
    }
  }

  return {
    ...base,
    targetDayIndex,
    highlight,
  };
}

export function getAllTourStops(): TourStopSpec[] {
  return STEP_SPECS.map((s) => ({
    ...s,
    targetDayIndex: diffDays(LIVE_START_DATE, s.targetDate),
    highlight: null,
  }));
}
