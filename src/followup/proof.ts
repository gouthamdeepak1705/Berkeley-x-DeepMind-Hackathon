import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { addDays, diffDays, formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { STORE_MAP } from '../engine/stores';
import {
  ActionDecision,
  DoneForYouItem,
  InProgressAction,
  RaisedItem,
  StoreId,
  TraceEntry,
} from '../types/domain';

export interface FollowUpEvaluationResult {
  inProgress: InProgressAction[];
  doneForYou: DoneForYouItem[];
  rolloutCards: RaisedItem[];
  activeControlStores: Set<string>;
  closedDecisionIds: Set<string>;
  undoneDecisionDates: Map<string, string>;
  traceEntries: TraceEntry[];
}

/**
 * Evaluates every active/past ActionDecision up to `date`:
 * - Tracks In progress actions until arrival (+2d) and through the 28-day proof window.
 * - Computes daily actual/expected ratios and treated-vs-control gap (percentage points).
 * - Fires a 7-day post-arrival checkpoint.
 * - Closes as "Worked. Proven against the held-out store." once gap > 10 pts for 7 days running,
 *   computing the proven dollar impact and raising "Roll out to the held-out store?".
 * - Closes as "Did not work" and marks undo if treated is worse than control for 7 days running.
 * - Closes as "Unclear." after 28 days without proof.
 */
export function evaluateActionsUpToDate(params: {
  sim: SimulationRun;
  decisions: ActionDecision[];
  date: string;
  handledRolloutIds?: Set<string>;
}): FollowUpEvaluationResult {
  const { sim, decisions, date, handledRolloutIds = new Set() } = params;
  const inProgress: InProgressAction[] = [];
  const doneForYou: DoneForYouItem[] = [];
  const rolloutCards: RaisedItem[] = [];
  const activeControlStores = new Set<string>();
  const closedDecisionIds = new Set<string>();
  const undoneDecisionDates = new Map<string, string>();
  const traceEntries: TraceEntry[] = [];

  for (const decision of decisions) {
    if (decision.date > date) continue;

    if (decision.kind === 'refund_switch') {
      const storeId = decision.storeId ?? 'walnut_creek';
      const storeName = STORE_MAP[storeId].name;
      const endDate = decision.proofEndDate ?? addDays(decision.date, 21);

      const computeRateForSpan = (startD: string, endD: string): { ratePct: number; sales: number; refunds: number } => {
        const sIdx = sim.dates.indexOf(startD);
        const eIdx = sim.dates.indexOf(endD);
        if (sIdx < 0 || eIdx < 0 || eIdx < sIdx) return { ratePct: 0, sales: 0, refunds: 0 };
        let sales = 0;
        let refunds = 0;
        for (let k = sIdx; k <= eIdx; k++) {
          const rec = sim.storeRecordsByDate[sim.dates[k]]?.[storeId];
          if (!rec || !rec.isOpen) continue;
          sales += rec.actualSales;
          refunds += rec.refundAmount;
        }
        return {
          ratePct: sales > 0 ? (refunds / sales) * 100 : 0,
          sales,
          refunds,
        };
      };

      const beforeStart = addDays(decision.date, -21);
      const beforeEnd = addDays(decision.date, -1);
      const beforeStats = computeRateForSpan(beforeStart, beforeEnd);
      const beforeFact = createFact(
        `proof:${decision.id}:before_rate`,
        `${storeName} 21-day refund rate before switch`,
        beforeStats.ratePct,
        'percent',
        `Refunds ($${Math.round(beforeStats.refunds).toLocaleString('en-US')}) divided by sales ($${Math.round(beforeStats.sales).toLocaleString('en-US')}) from ${beforeStart} to ${beforeEnd}.`,
      );

      const afterStart = addDays(decision.date, 1);
      const afterEnd = date < endDate ? date : endDate;
      const hasAfterDays = afterEnd >= afterStart;
      const afterStats = hasAfterDays
        ? computeRateForSpan(afterStart, afterEnd)
        : beforeStats;
      const afterFact = createFact(
        `proof:${decision.id}:after_rate:${date}`,
        `${storeName} refund rate after switch`,
        afterStats.ratePct,
        'percent',
        hasAfterDays
          ? `Refunds ($${Math.round(afterStats.refunds).toLocaleString('en-US')}) divided by sales ($${Math.round(afterStats.sales).toLocaleString('en-US')}) from ${afterStart} to ${afterEnd}.`
          : `Switch takes effect starting ${afterStart}; showing baseline rate on ${decision.date}.`,
      );

      if (date < endDate) {
        const elapsed = Math.max(0, diffDays(decision.date, date));
        inProgress.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? `${storeName} cash refund approval switch`,
          measure: decision.measure ?? `${storeName} 21-day refund rate before vs after switch`,
          statusText: hasAfterDays
            ? `Day ${elapsed} / 21 · Before ${beforeFact.formatted} · After ${afterFact.formatted}`
            : `Takes effect tomorrow · baseline ${beforeFact.formatted}`,
          nextCheckpoint: `21-day review on ${formatShortDate(endDate)}`,
          endDate,
          arrivalDate: afterStart,
          beforeRefundRateFact: beforeFact,
          afterRefundRateFact: afterFact,
        });
      } else {
        closedDecisionIds.add(decision.id);
        const verdictSentence = 'Likely worked. One store, before and after: not proven.';
        const detailSentence =
          `${storeName} refunds fell from ${beforeFact.formatted} before to ${afterFact.formatted} after. Proof needs a held-out control store and there is none here — only one store had this problem.`;

        doneForYou.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? `${storeName} cash refund approval switch`,
          verdict: 'worked_before_after',
          verdictSentence,
          detailSentence,
          approvedOn: decision.date,
          closedOn: endDate,
          beforeRefundRateFact: beforeFact,
          afterRefundRateFact: afterFact,
        });

        traceEntries.push({
          id: `trace:${endDate}:followup:refund_switch:${decision.id}`,
          date: endDate,
          lane: 'manager',
          kind: 'followup',
          headline: `${verdictSentence} (${storeName} cash refund approval)`,
          detail: detailSentence,
          outcome: 'raised',
          facts: [beforeFact, afterFact],
        });

        traceEntries.push({
          id: `trace:${endDate}:ds:refund_switch:${decision.id}`,
          date: endDate,
          lane: 'data_scientist',
          kind: 'followup',
          headline: `Before/after 21-day check: ${storeName} refund rate`,
          detail: `21-day before (${beforeFact.formatted}) vs 21-day after (${afterFact.formatted}). Cannot claim proof without a held-out control store.`,
          outcome: 'info',
          facts: [beforeFact, afterFact],
        });
      }
      continue;
    }

    if (decision.kind === 'store_manager_task') {
      const endDate = decision.dueDate ?? decision.proofEndDate ?? addDays(decision.date, 3);
      if (date < endDate) {
        inProgress.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? 'Ask Walnut Creek store manager',
          measure: decision.measure ?? 'Explanation for Till 2 cash refunds after 8 pm',
          statusText: 'Sent to Walnut Creek store manager (simulated)',
          nextCheckpoint: `Due ${formatShortDate(endDate)}`,
          endDate,
          arrivalDate: decision.date,
          isSimulatedTask: true,
        });
      } else {
        closedDecisionIds.add(decision.id);
        doneForYou.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? 'Ask Walnut Creek store manager',
          verdict: 'unclear',
          verdictSentence: 'Due date reached (simulated task; nothing sent outside the app).',
          approvedOn: decision.date,
          closedOn: endDate,
        });
      }
      continue;
    }

    if (decision.kind !== 'transfer' || !decision.transferLines || decision.transferLines.length === 0) {
      // Non-transfer action (e.g. refund_audit)
      const endDate = decision.proofEndDate ?? addDays(decision.date, 28);
      if (date < endDate) {
        inProgress.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? 'Approved owner action',
          measure: decision.measure ?? 'Weekly metric vs benchmark',
          statusText: 'Under way',
          nextCheckpoint: `Check on ${formatShortDate(addDays(decision.date, 7))}`,
          endDate,
          arrivalDate: decision.date,
        });
      } else {
        closedDecisionIds.add(decision.id);
        doneForYou.push({
          decisionId: decision.id,
          candidateId: decision.candidateId,
          title: decision.title ?? 'Approved owner action',
          verdict: 'unclear',
          verdictSentence: 'Review period complete.',
          approvedOn: decision.date,
          closedOn: endDate,
        });
      }
      continue;
    }

    const groupId = decision.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
    const grpLabel = groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
    const arrivalDate = decision.arrivalDate ?? addDays(decision.date, 2);
    const endDate = decision.proofEndDate ?? addDays(arrivalDate, 28);
    const treatedStoreIds = Array.from(new Set(decision.transferLines.map((l) => l.toStoreId)));
    const holdoutId = decision.holdoutStoreId;
    const holdoutName = holdoutId ? STORE_MAP[holdoutId].name : undefined;

    if (date < arrivalDate) {
      if (holdoutId) activeControlStores.add(holdoutId);
      const daysToArrive = diffDays(date, arrivalDate);
      inProgress.push({
        decisionId: decision.id,
        candidateId: decision.candidateId,
        title: decision.title ?? `${grpLabel} transfer`,
        measure:
          decision.measure ??
          `Daily sales vs expected at ${treatedStoreIds.map((id) => STORE_MAP[id].name).join(', ')}`,
        statusText: `In transit (arrives ${formatShortDate(arrivalDate)}, in ${daysToArrive} day${daysToArrive === 1 ? '' : 's'})`,
        nextCheckpoint: `7-day check on ${formatShortDate(addDays(arrivalDate, 7))}`,
        endDate,
        arrivalDate,
        holdoutStoreName: holdoutName,
      });
      continue;
    }

    // Walk daily from arrivalDate up to `date`
    const arrivalIdx = sim.dates.indexOf(arrivalDate);
    const dateIdx = sim.dates.indexOf(date);
    let consecPositive = 0;
    let consecNegative = 0;
    let cumulativeMoneyGain = 0;
    let verdict: 'in_progress' | 'worked_proven' | 'did_not_work' | 'unclear' = 'in_progress';
    let closedOn = date;
    let latestGapPts = 0;

    // Pre-arrival 7d ratio fallback if no holdout store (e.g. rollout or <3 stores)
    let preArrivalRatio = 1.0;
    if (!holdoutId && arrivalIdx >= 7) {
      let preAct = 0;
      let preExp = 0;
      for (let p = arrivalIdx - 7; p < arrivalIdx; p++) {
        const recs = sim.storeRecordsByDate[sim.dates[p]];
        for (const sid of treatedStoreIds) {
          preAct += recs[sid].actualSales;
          preExp += recs[sid].expectedSales ?? recs[sid].potentialSales;
        }
      }
      if (preExp > 0) preArrivalRatio = preAct / preExp;
    }

    for (let k = Math.max(0, arrivalIdx); k <= dateIdx; k++) {
      const d = sim.dates[k];
      const recs = sim.storeRecordsByDate[d];

      let treatedRatioSum = 0;
      let treatedCount = 0;
      let treatedExpectedSum = 0;
      for (const sid of treatedStoreIds) {
        const r = recs[sid];
        const exp = r.expectedSales ?? r.potentialSales;
        if (exp > 0) {
          treatedRatioSum += r.actualSales / exp;
          treatedCount++;
          treatedExpectedSum += exp;
        }
      }
      const treatedAvgRatio = treatedCount > 0 ? treatedRatioSum / treatedCount : 1;

      let baselineRatio = preArrivalRatio;
      if (holdoutId) {
        const ctrlRec = recs[holdoutId];
        const ctrlExp = ctrlRec.expectedSales ?? ctrlRec.potentialSales;
        baselineRatio = ctrlExp > 0 ? ctrlRec.actualSales / ctrlExp : 1;
      }

      const gap = treatedAvgRatio - baselineRatio;
      latestGapPts = gap * 100;
      cumulativeMoneyGain += treatedExpectedSum * gap;

      if (gap > 0.10) {
        consecPositive++;
        consecNegative = 0;
      } else if (gap < 0) {
        consecNegative++;
        consecPositive = 0;
      } else {
        consecPositive = 0;
        consecNegative = 0;
      }

      const daysPostArrival = k - arrivalIdx;

      if (holdoutId && daysPostArrival === 7) {
        traceEntries.push({
          id: `trace:${d}:followup:chk7:${decision.id}`,
          date: d,
          lane: 'data_scientist',
          kind: 'followup',
          headline: `7-day checkpoint: ${decision.title ?? `${grpLabel} transfer`}`,
          detail: `Treated avg vs expected ${(treatedAvgRatio * 100).toFixed(1)}% vs held-out ${holdoutName} ${(baselineRatio * 100).toFixed(1)}% (gap ${latestGapPts >= 0 ? '+' : ''}${latestGapPts.toFixed(1)} pts; ${consecPositive}/7 days > +10 pts).`,
          outcome: 'info',
        });
      }

      if (consecPositive >= 7) {
        verdict = 'worked_proven';
        closedOn = d;
        break;
      }
      if (holdoutId && consecNegative >= 7) {
        verdict = 'did_not_work';
        closedOn = d;
        undoneDecisionDates.set(decision.id, d);
        break;
      }
      if (daysPostArrival >= 28) {
        verdict = 'unclear';
        closedOn = d;
        break;
      }
    }

    const latestGapFact = createFact(
      `proof:${decision.id}:gap:${date}`,
      holdoutName
        ? `Treated vs held-out ${holdoutName} gap`
        : 'Post-arrival sales lift vs pre-arrival pace',
      latestGapPts,
      'points',
      holdoutName
        ? `Average (actual ÷ expected) across treated stores minus held-out ${holdoutName} ratio on ${date}.`
        : `Post-arrival (actual ÷ expected) minus pre-arrival 7-day baseline on ${date}.`,
    );

    if (verdict === 'in_progress') {
      if (holdoutId) activeControlStores.add(holdoutId);
      const daysSinceArr = diffDays(arrivalDate, date);
      const checkpointLabel =
        daysSinceArr < 7
          ? `7-day check on ${formatShortDate(addDays(arrivalDate, 7))}`
          : `${consecPositive}/7 days > +10 pts toward proof`;

      inProgress.push({
        decisionId: decision.id,
        candidateId: decision.candidateId,
        title: decision.title ?? `${grpLabel} transfer`,
        measure:
          decision.measure ??
          `Daily sales vs expected at ${treatedStoreIds.map((id) => STORE_MAP[id].name).join(', ')}`,
        statusText: holdoutName
          ? `Day ${daysSinceArr + 1} since arrival · gap ${latestGapPts >= 0 ? '+' : ''}${latestGapPts.toFixed(1)} pts vs ${holdoutName}`
          : `Day ${daysSinceArr + 1} since arrival · ${consecPositive}/7 days > +10 pts`,
        nextCheckpoint: checkpointLabel,
        endDate,
        arrivalDate,
        holdoutStoreName: holdoutName,
        latestGapPtsFact: latestGapFact,
      });
      continue;
    }

    // Closed action
    closedDecisionIds.add(decision.id);
    const provenMoneyFact = createFact(
      `proof:${decision.id}:money:${closedOn}`,
      'Proven additional sales',
      Math.max(0, cumulativeMoneyGain),
      'USD',
      `Sum over treated stores and days from arrival (${arrivalDate}) to ${closedOn} of (expected sales × treated-vs-control gap).`,
    );

    if (verdict === 'worked_proven') {
      const verdictSentence = holdoutName
        ? 'Worked. Proven against the held-out store.'
        : 'Worked. Sales recovered after arrival.';

      doneForYou.push({
        decisionId: decision.id,
        candidateId: decision.candidateId,
        title: decision.title ?? `${grpLabel} transfer`,
        verdict: 'worked_proven',
        verdictSentence,
        approvedOn: decision.date,
        closedOn,
        provenMoneyFact,
        holdoutStoreName: holdoutName,
      });

      traceEntries.push({
        id: `trace:${closedOn}:followup:proven:${decision.id}`,
        date: closedOn,
        lane: 'manager',
        kind: 'followup',
        headline: `${verdictSentence} (${decision.title ?? grpLabel})`,
        detail: `Proven over 7 consecutive days > +10 pts against ${holdoutName ?? 'baseline'} (${formatShortDate(closedOn)}). Proven gain ${provenMoneyFact.formatted}.`,
        outcome: 'raised',
        facts: [provenMoneyFact],
      });

      traceEntries.push({
        id: `trace:${closedOn}:ds:proven:${decision.id}`,
        date: closedOn,
        lane: 'data_scientist',
        kind: 'followup',
        headline: `Proof calculation: ${decision.title ?? grpLabel}`,
        detail: `Cumulative expected × gap across treated stores from ${formatShortDate(arrivalDate)} to ${formatShortDate(closedOn)} = ${provenMoneyFact.formatted}.`,
        outcome: 'info',
        facts: [provenMoneyFact, latestGapFact],
      });

      // Raise follow-on rollout card for the held-out store if not already handled
      const rolloutId = `rollout:${decision.id}`;
      if (holdoutId && !handledRolloutIds.has(rolloutId)) {
        // Keep control store suppressed from duplicate stock_running_out while rollout card is pending owner's tap
        activeControlStores.add(holdoutId);

        const { plan: rolloutPlan } = buildTransferPlanForGroup({
          sim,
          date,
          groupId,
          controlStores: new Set(),
          explicitReceivers: [holdoutId],
          disableHoldout: true,
        });

        const grpRecCtrl = sim.storeRecordsByDate[date][holdoutId].groups[groupId];
        const expectedCoverFact = createFact(
          `rollout:${decision.id}:exp:${date}`,
          'Safety cover threshold',
          2.5,
          'weeks',
          'Minimum 2.5 weeks safety cover target.',
        );
        const actualCoverFact = createFact(
          `rollout:${decision.id}:act:${date}`,
          `${holdoutName} ${grpLabel} cover`,
          grpRecCtrl.weeksOfCover ?? 0,
          'weeks',
          `Ending ${grpLabel} stock at ${holdoutName} on ${date}.`,
        );
        const stakeFact = createFact(
          `rollout:${decision.id}:stake:${date}`,
          'Weekly demand protected by rollout',
          grpRecCtrl.potentialSales * 7,
          'USD',
          `Estimated weekly ${grpLabel} demand at ${holdoutName} restored upon transfer arrival on ${rolloutPlan.arrivalDate}.`,
        );

        rolloutCards.push({
          candidateId: rolloutId,
          firstDetectedOn: closedOn,
          lastSeenOn: date,
          title: 'Roll out to the held-out store?',
          summary: `Transfer to ${treatedStoreIds.map((id) => STORE_MAP[id].name).join(' and ')} worked (${provenMoneyFact.formatted} proven). Approve the remaining transfer to ${holdoutName}.`,
          detectorKind: 'stock_running_out',
          groupId,
          stores: [
            {
              storeId: holdoutId,
              storeName: holdoutName!,
              firstDetectedOn: closedOn,
              initialExpected: expectedCoverFact,
              initialActual: actualCoverFact,
              initialStakePerWeek: stakeFact,
            },
          ],
          expected: expectedCoverFact,
          actual: actualCoverFact,
          stakePerWeek: stakeFact,
          transferPlan: rolloutPlan,
          isRollout: true,
          parentDecisionId: decision.id,
        });
      }
    } else if (verdict === 'did_not_work') {
      doneForYou.push({
        decisionId: decision.id,
        candidateId: decision.candidateId,
        title: decision.title ?? `${grpLabel} transfer`,
        verdict: 'did_not_work',
        verdictSentence: 'Did not work. Undo applied.',
        approvedOn: decision.date,
        closedOn,
        undone: true,
        holdoutStoreName: holdoutName,
      });

      traceEntries.push({
        id: `trace:${closedOn}:followup:failed:${decision.id}`,
        date: closedOn,
        lane: 'manager',
        kind: 'followup',
        headline: `Did not work — undo triggered: ${decision.title ?? grpLabel}`,
        detail: `Treated stores trailed ${holdoutName ?? 'control'} for 7 consecutive days; undo recipe executed on ${formatShortDate(closedOn)}.`,
        outcome: 'let_go',
      });
    } else {
      doneForYou.push({
        decisionId: decision.id,
        candidateId: decision.candidateId,
        title: decision.title ?? `${grpLabel} transfer`,
        verdict: 'unclear',
        verdictSentence: 'Unclear.',
        approvedOn: decision.date,
        closedOn,
        holdoutStoreName: holdoutName,
      });

      traceEntries.push({
        id: `trace:${closedOn}:followup:unclear:${decision.id}`,
        date: closedOn,
        lane: 'manager',
        kind: 'followup',
        headline: `Unclear after 28 days: ${decision.title ?? grpLabel}`,
        detail: `28-day proof window ended on ${formatShortDate(closedOn)} without 7 consecutive days > +10 pts.`,
        outcome: 'info',
      });
    }
  }

  return {
    inProgress,
    doneForYou,
    rolloutCards,
    activeControlStores,
    closedDecisionIds,
    undoneDecisionDates,
    traceEntries,
  };
}
