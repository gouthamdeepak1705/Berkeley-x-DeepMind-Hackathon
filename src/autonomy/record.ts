import { formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import {
  ActionDecision,
  AutonomyLevel,
  AutonomyOfferCard,
  AutonomyReaction,
  AutonomyRecord,
  DoneForYouItem,
} from '../types/domain';

export const AUTONOMY_KIND_LABEL = 'Stock transfer between stores';
export const AUTONOMY_EARN_RULE_TEXT =
  'To act alone on stock transfers under 500 units: the last 3 cases all worked, at least 1 was proven against a held-out store, none was undone by you, donors keep their cover, and you say yes.';

export function evaluateAutonomyRecord(params: {
  date: string;
  decisions: ActionDecision[];
  doneForYou: DoneForYouItem[];
  autonomyReactions: AutonomyReaction[];
}): AutonomyRecord {
  const { date, decisions, doneForYou, autonomyReactions } = params;

  const transferDecisionIds = new Set(
    decisions.filter((d) => d.kind === 'transfer' && d.date <= date).map((d) => d.id),
  );

  // Consider all completed or undone transfer outcomes up to `date` in chronological close order
  const closedTransfers = doneForYou
    .filter(
      (item) =>
        transferDecisionIds.has(item.decisionId) &&
        item.verdict !== 'autonomous_pending' &&
        item.closedOn <= date,
    )
    .sort((a, b) => (a.closedOn < b.closedOn ? -1 : a.closedOn > b.closedOn ? 1 : 0));

  const casesCount = closedTransfers.length;
  const workedCount = closedTransfers.filter(
    (c) => (c.verdict === 'worked_proven' || c.verdict === 'worked_single_store') && !c.undone,
  ).length;
  const provenCount = closedTransfers.filter(
    (c) => c.verdict === 'worked_proven' && !c.undone,
  ).length;
  const pooledMoneyUsd = closedTransfers.reduce((sum, c) => {
    if (c.verdict === 'worked_proven' && !c.undone && c.provenMoneyFact) {
      return sum + c.provenMoneyFact.value;
    }
    return sum;
  }, 0);

  // Consecutive trailing worked count & trailing undo count
  let consecutiveStreakWorked = 0;
  for (let i = closedTransfers.length - 1; i >= 0; i--) {
    const c = closedTransfers[i];
    if ((c.verdict === 'worked_proven' || c.verdict === 'worked_single_store') && !c.undone) {
      consecutiveStreakWorked++;
    } else {
      break;
    }
  }

  let consecutiveUndos = 0;
  for (let i = closedTransfers.length - 1; i >= 0; i--) {
    if (closedTransfers[i].undone) {
      consecutiveUndos++;
    } else {
      break;
    }
  }

  // Last 3 cases earn-rule check
  const lastThree = closedTransfers.slice(-3);
  const earnRuleMet =
    lastThree.length === 3 &&
    lastThree.every(
      (c) => (c.verdict === 'worked_proven' || c.verdict === 'worked_single_store') && !c.undone,
    ) &&
    lastThree.some((c) => c.verdict === 'worked_proven');

  // Determine accepted/declined status and whether autonomy was subsequently lost
  const relevantReactions = autonomyReactions
    .filter((r) => r.date <= date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const lastEnable = [...relevantReactions]
    .reverse()
    .find((r) => r.reaction === 'enable_autonomy');
  const lastDecline = [...relevantReactions]
    .reverse()
    .find((r) => r.reaction === 'keep_asking');

  let level: AutonomyLevel = 'recommend_decide';
  let lostAutonomyReason: string | undefined;

  if (lastEnable && (!lastDecline || lastEnable.date >= lastDecline.date)) {
    // Check if an autonomous action failed or owner undid 2 in a row AFTER autonomy was granted
    const failedAuto = closedTransfers.find(
      (c) =>
        c.isAutonomous &&
        c.verdict === 'did_not_work' &&
        c.closedOn >= lastEnable.date,
    );
    const undoneTransfersSinceEnable = closedTransfers.filter(
      (c) => c.closedOn >= lastEnable.date,
    );
    let trailingUndosSinceEnable = 0;
    for (let i = undoneTransfersSinceEnable.length - 1; i >= 0; i--) {
      if (undoneTransfersSinceEnable[i].undone) {
        trailingUndosSinceEnable++;
      } else {
        break;
      }
    }

    if (failedAuto) {
      level = 'recommend_decide';
      lostAutonomyReason = `Returned to "I recommend, you decide" on ${formatShortDate(failedAuto.closedOn)}: an automatic stock transfer (${failedAuto.title}) did not work.`;
    } else if (trailingUndosSinceEnable >= 2) {
      const latestUndoDate = undoneTransfersSinceEnable[undoneTransfersSinceEnable.length - 1].closedOn;
      level = 'recommend_decide';
      lostAutonomyReason = `Returned to "I recommend, you decide" on ${formatShortDate(latestUndoDate)}: you undid two transfers in a row.`;
    } else {
      level = 'autonomous_within_limits';
    }
  }

  let offerCard: AutonomyOfferCard | undefined;
  if (earnRuleMet && !lostAutonomyReason) {
    const earnedOnDate = lastThree[lastThree.length - 1].closedOn;
    const offerId = `autonomy:offer:stock_transfer:${earnedOnDate}`;
    const matchingReaction = relevantReactions.find(
      (r) => r.offerId === offerId || r.date >= earnedOnDate,
    );
    const status: AutonomyOfferCard['status'] = matchingReaction
      ? matchingReaction.reaction === 'enable_autonomy'
        ? 'accepted'
        : 'declined'
      : 'pending';

    offerCard = {
      id: offerId,
      offeredOn: earnedOnDate,
      kindLabel: AUTONOMY_KIND_LABEL,
      headline: 'Stock transfers under 500 units',
      body: 'Stock transfers under 500 units: 3 right out of 3, one proven against a held-out store. Shall I do these myself and report after? Anything above 500 units still comes to you.',
      status,
      decidedOn: matchingReaction?.date,
    };
  }

  const levelLabel =
    level === 'autonomous_within_limits'
      ? 'I do it within limits and report after'
      : 'I recommend, you decide';

  return {
    kindLabel: AUTONOMY_KIND_LABEL,
    casesFact: createFact(
      `record:stock_transfer:cases:${date}`,
      'Stock transfer cases',
      casesCount,
      'count',
      `Closed or owner-undone stock transfer cases completed through ${formatShortDate(date)}.`,
    ),
    workedFact: createFact(
      `record:stock_transfer:worked:${date}`,
      'Cases that worked',
      workedCount,
      'count',
      `Transfers out of ${casesCount} where treated sales met proof or single-store 7-day expectation with no stockout and no undo.`,
    ),
    provenFact: createFact(
      `record:stock_transfer:proven:${date}`,
      'Proven against a held-out store',
      provenCount,
      'count',
      `Transfers evaluated against a deliberately held-out control store and proven.`,
    ),
    pooledMoneyFact: createFact(
      `record:stock_transfer:pooled_money:${date}`,
      'Pooled proven money result',
      pooledMoneyUsd,
      'USD',
      'Sum of proven additional sales across closed stock transfers with a held-out control store (single-store transfers are marked Worked without a control store and excluded here).',
    ),
    level,
    levelLabel,
    earnRuleText: AUTONOMY_EARN_RULE_TEXT,
    earnRuleMet,
    consecutiveStreakWorked,
    consecutiveUndos,
    lostAutonomyReason,
    offerCard,
  };
}
