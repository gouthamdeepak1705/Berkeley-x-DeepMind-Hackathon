import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlainFactText } from '../components/FactValue';
import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { createFact } from '../engine/facts';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation } from '../engine/simulation';
import { clearTimelineSnapshotCache, evaluateStage2UpToDay } from '../engine/stage2Timeline';
import {
  clearGeminiMemoryCache,
  getGeminiUsageSummary,
  loadRecordedRunFromDisk,
  setGeminiPlaybackMode,
} from '../gemini/client';
import { executeActionThroughGateway } from '../gateway/gateway';
import {
  ActionDecision,
  AutonomyReaction,
  BuiltToolRecord,
  CardReaction,
} from '../types/domain';

test('Part A & F: Money Account sums without drift on every day 0..105, visual metrics & formatting checks pass', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();
  clearGeminiMemoryCache();
  loadRecordedRunFromDisk();
  setGeminiPlaybackMode('replay');

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    let decisions: ActionDecision[] = [];
    const reactions: CardReaction[] = [];
    const autonomyReactions: AutonomyReaction[] = [];
    const builtTools: BuiltToolRecord[] = [];

    // Check every day up to Sep 8 before approval
    for (let i = 0; i <= idx('2026-09-08'); i++) {
      const step = await evaluateStage2UpToDay({
        seed: DEFAULT_SEED,
        targetDayIndex: i,
        decisions,
        reactions,
        autonomyReactions,
        builtTools,
        investigateTargetDay: i === idx('2026-09-08'),
      });
      const ma = step.dayState.moneyAccount!;
      assert.ok(ma);
      assert.equal(ma.savedSoFarFact.value, ma.withoutOpscienFact.value - ma.lostSoFarFact.value);
      assert.equal(ma.savedProvenFact.value + ma.savedLikelyFact.value, ma.savedSoFarFact.value);
      assert.equal(step.dayState.storeBoard?.length, 10);
      for (const sb of step.dayState.storeBoard ?? []) {
        assert.ok(sb.chartPoints.every((cp) => cp.date <= step.dayState.date));
      }
      if (i === idx('2026-09-08')) {
        const bsCard = step.dayState.raised.find(
          (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
        );
        assert.ok(bsCard?.visualMetrics);
        assert.equal(bsCard.visualMetrics!.daysUntilDeliveryFact?.value, 62);
        assert.ok((bsCard.visualMetrics!.daysOfStockLeftFact?.value ?? 0) > 0);
        assert.ok((bsCard.visualMetrics!.emptyShelfDaysFact?.value ?? 0) > 0);
        assert.ok((bsCard.visualMetrics!.doNothingLossFact?.value ?? 0) > 0);
      }
    }

    // Approve Best-sellers Sep 8
    const bsPlan = buildTransferPlanForGroup({ sim: baseSim, date: '2026-09-08', groupId: 'best_sellers' }).plan;
    const bsGw = executeActionThroughGateway(
      {
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        kind: 'transfer',
        groupId: 'best_sellers',
        title: `${bsPlan.groupName} transfer`,
        measure: bsPlan.measure,
        ownerApproved: true,
        plan: bsPlan,
      },
      baseSim,
    );
    assert.ok(bsGw.ok && bsGw.decision);
    decisions.push(bsGw.decision);
    reactions.push({
      id: 'r:bs',
      candidateId: 'situation:stock_running_out:best_sellers',
      date: '2026-09-08',
      dayIndex: idx('2026-09-08'),
      reaction: 'approve',
    });

    // Check Sep 9..25, approve Walnut Creek Knitwear on Sep 25
    for (let i = idx('2026-09-09'); i <= idx('2026-09-25'); i++) {
      const step = await evaluateStage2UpToDay({
        seed: DEFAULT_SEED,
        targetDayIndex: i,
        decisions,
        reactions,
        autonomyReactions,
        builtTools,
        investigateTargetDay: i === idx('2026-09-25'),
      });
      const ma = step.dayState.moneyAccount!;
      assert.equal(ma.savedSoFarFact.value, ma.withoutOpscienFact.value - ma.lostSoFarFact.value);
      assert.equal(ma.savedProvenFact.value + ma.savedLikelyFact.value, ma.savedSoFarFact.value);

      if (i === idx('2026-09-25')) {
        const wcCard = step.dayState.raised.find(
          (r) => r.candidateId === 'situation:stock_running_out:knitwear',
        );
        assert.ok(wcCard?.transferPlan);
        const wcGw = executeActionThroughGateway(
          {
            candidateId: wcCard.candidateId,
            date: '2026-09-25',
            kind: 'transfer',
            groupId: 'knitwear',
            title: `${wcCard.transferPlan.groupName} transfer`,
            measure: wcCard.transferPlan.measure,
            ownerApproved: true,
            plan: wcCard.transferPlan,
          },
          step.sim,
        );
        assert.ok(wcGw.ok && wcGw.decision);
        decisions.push(wcGw.decision);
        reactions.push({
          id: 'r:wc',
          candidateId: wcCard.candidateId,
          date: '2026-09-25',
          dayIndex: idx('2026-09-25'),
          reaction: 'approve',
        });
      }
    }

    // Check Sep 26..30 (Rollout + Refund card + switch), then remainder up to Nov 14
    for (let i = idx('2026-09-26'); i <= idx('2026-09-30'); i++) {
      const step = await evaluateStage2UpToDay({
        seed: DEFAULT_SEED,
        targetDayIndex: i,
        decisions,
        reactions,
        autonomyReactions,
        builtTools,
        investigateTargetDay: i === idx('2026-09-30'),
      });
      const ma = step.dayState.moneyAccount!;
      assert.equal(ma.savedSoFarFact.value, ma.withoutOpscienFact.value - ma.lostSoFarFact.value);
      assert.equal(ma.savedProvenFact.value + ma.savedLikelyFact.value, ma.savedSoFarFact.value);

      if (i === idx('2026-09-27')) {
        const rolloutCard = step.dayState.raised.find((r) => r.isRollout);
        assert.ok(rolloutCard?.visualMetrics?.proofBarData, 'Sep 27 rollout card must have proofBarData');
        assert.equal(rolloutCard.visualMetrics!.proofBarData!.holdoutName, 'Santana Row');
      }

      const rolloutCard = step.dayState.raised.find((r) => r.isRollout);
      if (rolloutCard?.transferPlan) {
        const srPlan = rolloutCard.transferPlan;
        const srGw = executeActionThroughGateway(
          {
            candidateId: rolloutCard.candidateId,
            date: step.dayState.date,
            kind: 'transfer',
            groupId: 'best_sellers',
            title: `Rollout: ${srPlan.groupName} to ${srPlan.transferLines[0]?.toStoreName ?? 'held-out store'}`,
            measure: srPlan.measure,
            parentDecisionId: rolloutCard.parentDecisionId,
            ownerApproved: true,
            plan: srPlan,
          },
          step.sim,
        );
        assert.ok(srGw.ok && srGw.decision);
        decisions.push(srGw.decision);
        reactions.push({
          id: 'r:sr',
          candidateId: rolloutCard.candidateId,
          date: step.dayState.date,
          dayIndex: i,
          reaction: 'approve',
        });
      }
      const refCardPreOct = step.dayState.raised.find((r) => r.detectorKind === 'refunds_out_of_line');
      if (refCardPreOct && builtTools.length === 0) {
        assert.ok(refCardPreOct.visualMetrics?.refundStoreComparison);
        assert.equal(refCardPreOct.visualMetrics!.refundStoreComparison![0].storeId, 'walnut_creek');
        builtTools.push({
          id: 'tool:refund_exceptions_desk:walnut_creek',
          situationId: refCardPreOct.candidateId,
          title: 'Refund exceptions desk — Walnut Creek',
          storeId: 'walnut_creek',
          storeName: 'Walnut Creek',
          installedOn: step.dayState.date,
          html: '<!doctype html><html><body>ok</body></html>',
          model: 'fallback-code',
          mode: 'fallback',
          latencyMs: 1,
          inputTokens: 0,
          outputTokens: 0,
          byteSize: 44,
          usedFallbackCopy: true,
          repairedOnce: false,
          requirement: {
            situationId: refCardPreOct.candidateId,
            title: 'Refund exceptions desk — Walnut Creek',
            generatedOn: step.dayState.date,
            purpose: [{ type: 'text', text: 'Review unlinked cash refunds over fifty dollars.' }],
            users: [{ type: 'text', text: 'Walnut Creek store manager.' }],
            shows: [{ type: 'text', text: 'Flagged refunds.' }],
            actions: [{ type: 'text', text: 'Mark reviewed and switch approval rule on.' }],
            verification: [{ type: 'text', text: 'Three sandbox tests.' }],
            plainSummary: {
              purpose: 'Review unlinked cash refunds over fifty dollars.',
              users: 'Walnut Creek store manager.',
              shows: 'Flagged refunds.',
              actions: 'Mark reviewed and switch approval rule on.',
              verification: 'Three sandbox tests.',
            },
            factsById: {},
            model: 'fallback-code',
            mode: 'fallback',
            latencyMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            usedFallbackWording: true,
          },
          testResults: [
            { id: 'loads_cleanly', label: 'Load & render', passed: true, detail: 'Loaded.' },
            { id: 'flagged_math_matches', label: 'Flagged math', passed: true, detail: 'Matched.' },
            { id: 'mark_reviewed_responds', label: 'Row review control', passed: true, detail: 'Passed.' },
          ],
        });
        reactions.push({
          id: 'r:ref-install',
          candidateId: refCardPreOct.candidateId,
          date: step.dayState.date,
          dayIndex: i,
          reaction: 'approve',
          detail: 'Installed Refund exceptions desk.',
        });
        const swGw = executeActionThroughGateway(
          {
            candidateId: refCardPreOct.candidateId,
            date: step.dayState.date,
            kind: 'refund_switch',
            storeId: 'walnut_creek',
            toolId: 'tool:refund_exceptions_desk:walnut_creek',
            title: 'Require manager approval for cash refunds over $50 at Walnut Creek',
            measure: 'Walnut Creek 21-day cash refund rate before vs after switch',
            ownerApproved: true,
          },
          step.sim,
        );
        assert.ok(swGw.ok && swGw.decision);
        decisions.push(swGw.decision);
      }
    }

    // Step remaining days Oct 1 .. Nov 14
    let refHandled = builtTools.length > 0;
    let pasadenaHandled = false;
    let autonomyHandled = false;
    for (let i = idx('2026-10-01'); i <= idx('2026-11-14'); i++) {
      const step = await evaluateStage2UpToDay({
        seed: DEFAULT_SEED,
        targetDayIndex: i,
        decisions,
        reactions,
        autonomyReactions,
        builtTools,
        investigateTargetDay: true,
      });
      decisions = step.decisions;
      const ma = step.dayState.moneyAccount!;
      assert.equal(ma.savedSoFarFact.value, ma.withoutOpscienFact.value - ma.lostSoFarFact.value);
      assert.equal(ma.savedProvenFact.value + ma.savedLikelyFact.value, ma.savedSoFarFact.value);

      const probWithoutSum = ma.byProblem.reduce((s, p) => s + p.withoutOpscienFact.value, 0);
      const probLostSum = ma.byProblem.reduce((s, p) => s + p.lostSoFarFact.value, 0);
      const probSavedSum = ma.byProblem.reduce((s, p) => s + p.savedFact.value, 0);
      assert.equal(probWithoutSum, ma.withoutOpscienFact.value);
      assert.equal(probLostSum, ma.lostSoFarFact.value);
      assert.equal(probSavedSum, ma.savedSoFarFact.value);

      const storeWithoutSum = ma.byStore.reduce((s, p) => s + p.withoutOpscienFact.value, 0);
      const storeLostSum = ma.byStore.reduce((s, p) => s + p.lostSoFarFact.value, 0);
      const storeSavedSum = ma.byStore.reduce((s, p) => s + p.savedFact.value, 0);
      assert.equal(storeWithoutSum, ma.withoutOpscienFact.value);
      assert.equal(storeLostSum, ma.lostSoFarFact.value);
      assert.equal(storeSavedSum, ma.savedSoFarFact.value);

      // Handle Walnut Creek refunds tool + switch on the day it raises (Oct 3)
      const refCard = !refHandled
        ? step.dayState.raised.find((r) => r.detectorKind === 'refunds_out_of_line')
        : undefined;
      if (refCard) {
        assert.ok(refCard.visualMetrics?.refundStoreComparison);
        assert.equal(refCard.visualMetrics!.refundStoreComparison![0].storeId, 'walnut_creek');
        refHandled = true;
        builtTools.push({
          id: 'tool:refund_exceptions_desk:walnut_creek',
          situationId: refCard.candidateId,
          title: 'Refund exceptions desk — Walnut Creek',
          storeId: 'walnut_creek',
          storeName: 'Walnut Creek',
          installedOn: step.dayState.date,
          html: '<!doctype html><html><body>ok</body></html>',
          model: 'fallback-code',
          mode: 'fallback',
          latencyMs: 1,
          inputTokens: 0,
          outputTokens: 0,
          byteSize: 44,
          usedFallbackCopy: true,
          repairedOnce: false,
          requirement: {
            situationId: refCard.candidateId,
            title: 'Refund exceptions desk — Walnut Creek',
            generatedOn: step.dayState.date,
            purpose: [{ type: 'text', text: 'Review unlinked cash refunds over fifty dollars.' }],
            users: [{ type: 'text', text: 'Walnut Creek store manager.' }],
            shows: [{ type: 'text', text: 'Flagged refunds.' }],
            actions: [{ type: 'text', text: 'Mark reviewed and switch approval rule on.' }],
            verification: [{ type: 'text', text: 'Three sandbox tests.' }],
            plainSummary: {
              purpose: 'Review unlinked cash refunds over fifty dollars.',
              users: 'Walnut Creek store manager.',
              shows: 'Flagged refunds.',
              actions: 'Mark reviewed and switch approval rule on.',
              verification: 'Three sandbox tests.',
            },
            factsById: {},
            model: 'fallback-code',
            mode: 'fallback',
            latencyMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            usedFallbackWording: true,
          },
          testResults: [
            { id: 'loads_cleanly', label: 'Load & render', passed: true, detail: 'Loaded.' },
            { id: 'flagged_math_matches', label: 'Flagged math', passed: true, detail: 'Matched.' },
            { id: 'mark_reviewed_responds', label: 'Row review control', passed: true, detail: 'Passed.' },
          ],
        });
        reactions.push({
          id: 'r:ref-install',
          candidateId: refCard.candidateId,
          date: step.dayState.date,
          dayIndex: i,
          reaction: 'approve',
          detail: 'Installed Refund exceptions desk.',
        });
        const swGw = executeActionThroughGateway(
          {
            candidateId: refCard.candidateId,
            date: step.dayState.date,
            kind: 'refund_switch',
            storeId: 'walnut_creek',
            toolId: 'tool:refund_exceptions_desk:walnut_creek',
            title: 'Require manager approval for cash refunds over $50 at Walnut Creek',
            measure: 'Walnut Creek 21-day refund rate before vs after switch',
            ownerApproved: true,
          },
          step.sim,
        );
        assert.ok(swGw.ok && swGw.decision);
        decisions.push(swGw.decision);
      }

      // Handle Pasadena knitwear on the day it raises (Oct 15)
      const pasCard = !pasadenaHandled
        ? step.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear')
        : undefined;
      if (pasCard?.transferPlan) {
        pasadenaHandled = true;
        const pasGw = executeActionThroughGateway(
          {
            candidateId: pasCard.candidateId,
            date: step.dayState.date,
            kind: 'transfer',
            groupId: 'knitwear',
            title: `${pasCard.transferPlan.groupName} transfer`,
            measure: pasCard.transferPlan.measure,
            ownerApproved: true,
            plan: pasCard.transferPlan,
          },
          step.sim,
        );
        assert.ok(pasGw.ok && pasGw.decision);
        decisions.push(pasGw.decision);
        reactions.push({
          id: 'r:pas',
          candidateId: pasCard.candidateId,
          date: step.dayState.date,
          dayIndex: i,
          reaction: 'approve',
        });
      }

      // Accept autonomy when offered (Oct 23)
      if (!autonomyHandled && step.dayState.autonomyRecord?.offerCard?.status === 'pending') {
        autonomyHandled = true;
        autonomyReactions.push({
          id: 'auto:yes',
          offerId: step.dayState.autonomyRecord.offerCard.id,
          date: step.dayState.date,
          dayIndex: i,
          reaction: 'enable_autonomy',
        });
      }

      if (i === idx('2026-11-14')) {
        // Check Done for you proof bar & comma formatting (Part F #2)
        const bsDone = (step.dayState.doneForYou ?? []).find((d) => d.decisionId === bsGw.decision!.id);
        assert.ok(bsDone?.movedSummary?.includes('2,453'), `Expected comma in movedSummary: ${bsDone?.movedSummary}`);
        assert.ok(step.dayState.doneForYouProofBars?.[bsGw.decision!.id]);
        assert.ok(ma.withoutOpscienFact.value > 400000);
        assert.ok(ma.savedSoFarFact.value > 350000);
        assert.equal(ma.atRiskNowFact.value, 0);
      }
    }

    const usage = getGeminiUsageSummary();
    assert.equal(usage.uncachedDecisionCalls + usage.uncachedOtherCalls, 0);
    assert.equal(usage.fallbackCalls, 0);
  } finally {
    process.env.GEMINI_API_KEY = prevKey;
    clearTimelineSnapshotCache();
  }
});

test('Part A & F: Not now on Best-sellers tracks growing turnedDownWarnings split by store without +, and strips + in simple rates', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();
  clearGeminiMemoryCache();
  setGeminiPlaybackMode('replay');

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    const reactions: CardReaction[] = [
      {
        id: 'r:notnow:bs',
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        dayIndex: idx('2026-09-08'),
        reaction: 'not_now',
      },
    ];

    const sep25 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-25'),
      decisions: [],
      reactions,
    });
    const oct05 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-05'),
      decisions: [],
      reactions,
    });

    const tdSep25 = sep25.dayState.moneyAccount!.turnedDownWarnings.find((w) =>
      w.candidateId.includes('best_sellers'),
    );
    const tdOct05 = oct05.dayState.moneyAccount!.turnedDownWarnings.find((w) =>
      w.candidateId.includes('best_sellers'),
    );

    assert.ok(tdSep25 && tdOct05);
    assert.equal(tdSep25.byStore.length, 3);
    assert.ok(tdOct05.lostSinceTurnedDownFact.value > tdSep25.lostSinceTurnedDownFact.value);
    const bsProbOct05 = oct05.dayState.moneyAccount!.byProblem.find((p) => p.problemId === 'best_sellers')!;
    assert.equal(tdOct05.lostSinceTurnedDownFact.value, bsProbOct05.lostSoFarFact.value);

    // Check Part F #3 noPlus formatting
    const posPct = createFact('f:pct', 'Rate', 9.9, 'percent', 'note');
    const posPts = createFact('f:pts', 'Pts', 14.5, 'points', 'note');
    assert.equal(formatPlainFactText(posPct, { noPlus: true }), '9.9%');
    assert.equal(formatPlainFactText(posPts, { noPlus: true }), '14.5 points');
    assert.equal(formatPlainFactText(posPct), '+9.9%');
  } finally {
    process.env.GEMINI_API_KEY = prevKey;
    clearTimelineSnapshotCache();
  }
});

test('Stage 7 A.2: Dismissing Walnut Creek knitwear keeps Walnut Creek in Warnings turned down with non-zero loss and does not leak Dismissed label to Pasadena or Napa', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();
  clearGeminiMemoryCache();
  loadRecordedRunFromDisk();
  setGeminiPlaybackMode('replay');

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    const bsPlan = buildTransferPlanForGroup({ sim: baseSim, date: '2026-09-08', groupId: 'best_sellers' }).plan;
    const bsGw = executeActionThroughGateway(
      {
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        kind: 'transfer',
        groupId: 'best_sellers',
        title: `${bsPlan.groupName} transfer`,
        measure: bsPlan.measure,
        ownerApproved: true,
        plan: bsPlan,
      },
      baseSim,
    );
    assert.ok(bsGw.ok && bsGw.decision);

    const decisions: ActionDecision[] = [bsGw.decision];
    const reactions: CardReaction[] = [
      {
        id: 'r:bs',
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        dayIndex: idx('2026-09-08'),
        reaction: 'approve',
      },
      {
        id: 'r:dismiss-wc',
        candidateId: 'situation:stock_running_out:knitwear',
        date: '2026-09-25',
        dayIndex: idx('2026-09-25'),
        reaction: 'dismiss',
        reason: 'not_important',
        storeIds: ['walnut_creek'],
      },
    ];

    const oct15 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-15'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });

    // Pasadena Knitwear must raise as a new card even though Walnut Creek was dismissed
    const pasCard = oct15.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:knitwear',
    );
    assert.ok(pasCard, 'Pasadena Knitwear should raise as a new card on Oct 15');
    assert.ok(pasCard.stores?.some((s) => s.storeId === 'pasadena'));
    assert.ok(!pasCard.stores?.some((s) => s.storeId === 'walnut_creek'));

    const tdOct15 = oct15.dayState.moneyAccount!.turnedDownWarnings;
    const wcEntry = tdOct15.find(
      (w) => w.candidateId === 'situation:stock_running_out:knitwear' && w.byStore.some((b) => b.storeId === 'walnut_creek'),
    );
    assert.ok(wcEntry, 'Walnut Creek entry must stay in turnedDownWarnings');
    assert.equal(wcEntry.title, 'Knitwear running low at Walnut Creek');
    assert.ok(wcEntry.lostSinceTurnedDownFact.value > 0, 'Walnut Creek dismissed loss must be > 0');
    assert.ok(!wcEntry.byStore.some((b) => b.storeId === 'pasadena'), 'Pasadena must not merge into Walnut Creek dismissed entry');

    const nov14 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-14'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });

    const maNov14 = nov14.dayState.moneyAccount!;
    const wcProb = maNov14.byProblem.find((p) => p.problemId === 'walnut_creek_knitwear')!;
    const wcProbStore = wcProb.stores.find((s) => s.storeId === 'walnut_creek')!;
    const pasProb = maNov14.byProblem.find((p) => p.problemId === 'pasadena_knitwear');
    const napaProb = maNov14.byProblem.find((p) => p.problemId === 'napa_knitwear');

    const wcTurnedNov14 = maNov14.turnedDownWarnings.find(
      (w) => w.candidateId === 'situation:stock_running_out:knitwear' && w.byStore.some((b) => b.storeId === 'walnut_creek'),
    )!;
    assert.equal(
      wcTurnedNov14.lostSinceTurnedDownFact.value,
      wcProbStore.lostSoFarFact.value,
      'Turned down loss must equal Lost breakdown loss for Walnut Creek',
    );
    if (pasProb) {
      assert.ok(!pasProb.lossReason.includes('Dismissed'), `Pasadena should not say Dismissed: ${pasProb.lossReason}`);
    }
    if (napaProb) {
      assert.ok(!napaProb.lossReason.includes('Dismissed'), `Napa should not say Dismissed: ${napaProb.lossReason}`);
    }
  } finally {
    process.env.GEMINI_API_KEY = prevKey;
    clearTimelineSnapshotCache();
  }
});

test('Stage 7 A.3 & A.4 & Part B: Reconciles 3,822 spare units on Sep 8, Rockridge donor on Sep 25, and builds exact Day by Day chart series', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();
  clearGeminiMemoryCache();
  loadRecordedRunFromDisk();
  setGeminiPlaybackMode('replay');

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    // Part B: Sep 7 has $0 without Opscien and $0 lost
    const sep7 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-07'),
      decisions: [],
      reactions: [],
      investigateTargetDay: false,
    });
    const sep7Points = sep7.dayState.moneyAccount!.dayByDayPoints!;
    assert.equal(sep7Points.length, idx('2026-09-07') + 1);
    const sep7Last = sep7Points[sep7Points.length - 1];
    assert.equal(sep7Last.withoutOpscienUsd, 0);
    assert.equal(sep7Last.lostSoFarUsd, 0);
    assert.equal(sep7Last.savedSoFarUsd, 0);

    // A.3: Sep 8 Best-sellers card top (3,822) matches Full analysis (3,822)
    const sep8 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-08'),
      decisions: [],
      reactions: [],
      investigateTargetDay: true,
    });
    const bsCard = sep8.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    )!;
    assert.equal(bsCard.visualMetrics?.spareTotalUnitsFact?.value, 3822);
    assert.equal(
      bsCard.investigation?.factsById['tool:stock:donor_surplus:best_sellers:2026-09-08']?.value,
      3822,
    );
    const sep8AllText =
      (bsCard.investigation?.findingSegments ?? [])
        .map((s) => (s.type === 'text' ? s.text : s.fact.formatted))
        .join('') +
      (bsCard.investigation?.causeSegments ?? [])
        .map((s) => (s.type === 'text' ? s.text : s.fact.formatted))
        .join('');
    assert.ok(!sep8AllText.includes('5,178'), `Expected 5,178 to be reconciled to 3,822: ${sep8AllText}`);

    // Approve Sep 8 so Santana Row becomes holdout, then check Sep 25 Knitwear donor is Rockridge (not Santana Row)
    const bsGw = executeActionThroughGateway(
      {
        candidateId: bsCard.candidateId,
        date: '2026-09-08',
        kind: 'transfer',
        groupId: 'best_sellers',
        title: `${bsCard.transferPlan!.groupName} transfer`,
        measure: bsCard.transferPlan!.measure,
        ownerApproved: true,
        plan: bsCard.transferPlan!,
      },
      sep8.sim,
    );
    assert.ok(bsGw.ok && bsGw.decision);

    const sep25 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-25'),
      decisions: [bsGw.decision],
      reactions: [
        {
          id: 'r:bs',
          candidateId: bsCard.candidateId,
          date: '2026-09-08',
          dayIndex: idx('2026-09-08'),
          reaction: 'approve',
        },
      ],
      investigateTargetDay: true,
    });
    const wcCard = sep25.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:knitwear',
    )!;
    assert.equal(wcCard.transferPlan?.transferLines[0]?.fromStoreName, 'Rockridge');
    const wcInvText =
      (wcCard.investigation?.outcomeDetail ?? '') +
      (wcCard.investigation?.proposalSegments ?? [])
        .map((s) => (s.type === 'text' ? s.text : s.fact.formatted))
        .join('') +
      (wcCard.investigation?.options ?? []).map((o) => o.description).join(' ');
    assert.ok(!wcInvText.includes('Santana Row'), `Expected Santana Row donor to be rewritten to Rockridge: ${wcInvText}`);
    assert.ok(wcInvText.includes('Rockridge'), `Expected Rockridge donor in Knitwear details: ${wcInvText}`);

    // Part B: Check Not now on Sep 8 makes lostSoFar climb close to withoutOpscien
    const oct20NoAction = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-20'),
      decisions: [],
      reactions: [
        {
          id: 'r:notnow:bs',
          candidateId: 'situation:stock_running_out:best_sellers',
          date: '2026-09-08',
          dayIndex: idx('2026-09-08'),
          reaction: 'not_now',
        },
      ],
      investigateTargetDay: false,
    });
    const noActAccount = oct20NoAction.dayState.moneyAccount!;
    const noActLast = noActAccount.dayByDayPoints![noActAccount.dayByDayPoints!.length - 1];
    assert.equal(noActLast.withoutOpscienUsd, noActAccount.withoutOpscienFact.value);
    assert.equal(noActLast.lostSoFarUsd, noActAccount.lostSoFarFact.value);
    assert.ok(noActLast.lostSoFarUsd > 0 && noActLast.savedSoFarUsd === 0);
  } finally {
    process.env.GEMINI_API_KEY = prevKey;
    clearTimelineSnapshotCache();
  }
});

