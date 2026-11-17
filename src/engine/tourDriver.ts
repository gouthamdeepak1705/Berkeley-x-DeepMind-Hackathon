import { LIVE_START_DATE, diffDays } from './calendar';
import { BuilderRequirement, DayState } from '../types/domain';
import { DemoHighlightState } from '../components/OwnerFeed';

export type TourActionKind =
  | 'advance_only'
  | 'approve_best_sellers'
  | 'approve_wc_knitwear_and_advance'
  | 'approve_rollout'
  | 'build_refund_tool'
  | 'enable_refund_switch'
  | 'accept_autonomy'
  | 'finish';

export type TourScrollTarget =
  | 'quiet'
  | 'best_sellers_card'
  | 'in_progress_transfer'
  | 'rollout_card'
  | 'refund_card'
  | 'inline_tool'
  | 'autonomy_offer'
  | 'result_page';

export interface TourStopSpec {
  stepNumber: number; // 1..8
  totalSteps: number; // 8
  targetDate: string;
  targetDayIndex: number;
  title: string;
  explanation: string;
  scrollTarget: TourScrollTarget;
  highlight: DemoHighlightState | null;
  actionKind: TourActionKind;
}

export const TOUR_TOTAL_STEPS = 8;

const STEP_SPECS: Array<Omit<TourStopSpec, 'targetDayIndex' | 'highlight'>> = [
  {
    stepNumber: 1,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-08-17',
    title: 'It noticed, and stayed quiet',
    explanation:
      'Normal summer dips happen every August. Opscien checked the calendar, ruled out a real problem, and did not wake you. Look at the chart: sales fell, but stayed inside the expected range.',
    scrollTarget: 'quiet',
    actionKind: 'advance_only',
  },
  {
    stepNumber: 2,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-08',
    title: 'It speaks',
    explanation:
      'Two big stores will run out of Best-sellers before delivery. Opscien suggests moving spare stock while holding Santana Row back to prove it. Sales look healthy on the chart. The problem is stock, not sales.',
    scrollTarget: 'best_sellers_card',
    actionKind: 'approve_best_sellers',
  },
  {
    stepNumber: 3,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-08',
    title: 'It acts safely',
    explanation:
      'Every spare-stock store keeps enough stock to reach its own delivery. No new stock was bought, and Santana Row stays held back to compare.',
    scrollTarget: 'in_progress_transfer',
    actionKind: 'approve_wc_knitwear_and_advance',
  },
  {
    stepNumber: 4,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-27',
    title: 'It proves the result',
    explanation:
      'Stores that got stock kept selling, while Santana Row dropped behind. With the gain proven, Opscien asks to send the rest now. On the Money tab, the green area is what the transfer has saved so far.',
    scrollTarget: 'rollout_card',
    actionKind: 'approve_rollout',
  },
  {
    stepNumber: 5,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-30',
    title: 'It finds a loss nobody was looking for',
    explanation:
      'Walnut Creek has high late-evening cash refunds with no matching sale on Till 2. Opscien proposes a refund check screen and a $50 approval rule.',
    scrollTarget: 'refund_card',
    actionKind: 'build_refund_tool',
  },
  {
    stepNumber: 6,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-09-30',
    title: 'It builds what was missing',
    explanation:
      'The new refund desk was built and tested three times. Next sets the $50 manager approval switch so the loss at the till stops tomorrow.',
    scrollTarget: 'inline_tool',
    actionKind: 'enable_refund_switch',
  },
  {
    stepNumber: 7,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-10-05',
    title: 'It earns trust',
    explanation:
      'Three small transfers all worked, with one proven against comparison. Opscien asks to handle stock transfers under 500 units itself and report after.',
    scrollTarget: 'autonomy_offer',
    actionKind: 'accept_autonomy',
  },
  {
    stepNumber: 8,
    totalSteps: TOUR_TOTAL_STEPS,
    targetDate: '2026-11-14',
    title: 'The result',
    explanation:
      'Opscien handled Pasadena and Napa automatically within your limits. Every dollar above compares running with Opscien against taking no action. The green area is everything Opscien saved.',
    scrollTarget: 'result_page',
    actionKind: 'finish',
  },
];

export function getTourStop(
  stepNumber: number,
  dayState?: DayState | null,
  _pendingRequirements?: Record<string, BuilderRequirement>,
): TourStopSpec {
  const clamped = Math.max(1, Math.min(TOUR_TOTAL_STEPS, stepNumber));
  const base = STEP_SPECS[clamped - 1];
  const targetDayIndex = diffDays(LIVE_START_DATE, base.targetDate);

  let highlight: DemoHighlightState | null = null;
  if (dayState) {
    if (clamped === 2) {
      const card = dayState.raised.find(
        (r) => r.candidateId === 'situation:stock_running_out:best_sellers' && !r.isRollout,
      );
      if (card) {
        highlight = { actionKey: `approve:${card.candidateId}`, label: 'Approve' };
      }
    } else if (clamped === 4) {
      const rollout = dayState.raised.find((r) => r.isRollout);
      if (rollout) {
        highlight = { actionKey: `approve:${rollout.candidateId}`, label: 'Approve' };
      }
    } else if (clamped === 5) {
      const refundCard = dayState.raised.find(
        (r) => r.investigation?.outcomeKind === 'tool_to_build',
      );
      if (refundCard) {
        highlight = { actionKey: `build:${refundCard.candidateId}`, label: 'Build' };
      }
    } else if (clamped === 6) {
      const refundTool = (dayState.builtTools ?? []).find(
        (t) => t.id === 'tool:refund_exceptions_desk:walnut_creek',
      );
      if (refundTool && !dayState.refundSwitchEnabled) {
        highlight = { actionKey: `open_tool:${refundTool.id}`, label: 'Turn on $50 approval rule' };
      }
    } else if (clamped === 7) {
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
