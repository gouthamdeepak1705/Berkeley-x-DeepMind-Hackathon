import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../engine/calendar';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation } from '../engine/simulation';
import { evaluateStage2UpToDay } from '../engine/stage2Timeline';
import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { countSegmentsWords } from './placeholders';
import { GEMINI_SETTINGS } from './settings';
import {
  attemptDirectStockMutationBypass,
  clearGatewayAttemptLog,
  executeActionThroughGateway,
  runGatewaySelfTests,
} from '../gateway/gateway';
import { ActionDecision, CardReaction } from '../types/domain';

test('Stage 2 fix: model pricing and checker 25-word ceiling in settings', () => {
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-decision-1'], {
    input: 0.1,
    output: 0.0,
  });
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-4-carbon'], {
    input: 2.0,
    output: 10.0,
  });
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-4-argon'], {
    input: 2.0,
    output: 10.0,
  });
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-4-hydrogen'], {
    input: 1.5,
    output: 7.5,
  });
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-3.8-flash'], {
    input: 0.75,
    output: 3.75,
  });
  assert.deepEqual(GEMINI_SETTINGS.pricingPerMillionUsd['gemini-3.5-flash-lite'], {
    input: 0.3,
    output: 2.5,
  });
  assert.equal(GEMINI_SETTINGS.checkerLimits.maxProseWords, 25);
});

test('Gateway enforces limits and refuses the 3 forbidden actions', () => {
  clearGatewayAttemptLog();
  const sim = runSimulation(DEFAULT_SEED);
  const report = runGatewaySelfTests(sim, '2026-09-08');
  assert.equal(report.allRefused, true);
  assert.equal(report.cases.length, 3);
  for (const c of report.cases) {
    assert.equal(c.refusedAsExpected, true, `Expected ${c.id} to be refused`);
    assert.ok(c.reason.toLowerCase().includes('refused'));
  }

  const bypass = attemptDirectStockMutationBypass({
    date: '2026-09-08',
    storeId: 'union_square',
    groupId: 'best_sellers',
    deltaUnits: 120,
  });
  assert.equal(bypass.ok, false);
  assert.ok(bypass.reason.toLowerCase().includes('refused'));
});

test('Sep 8 Best-sellers transfer plan holds out Santana Row, respects donor floors, and fits <= 25 words', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const sim = runSimulation(DEFAULT_SEED);
    const { plan } = buildTransferPlanForGroup({
      sim,
      date: '2026-09-08',
      groupId: 'best_sellers',
    });

    assert.equal(plan.receiverStoreIds.length, 3);
    assert.equal(plan.holdoutStoreId, 'santana_row');
    assert.equal(
      plan.holdoutSentence,
      'Santana Row is held out so the result can be proven.',
    );
    assert.deepEqual(plan.treatedStoreIds.sort(), ['palo_alto', 'union_square']);
    assert.equal(plan.shortfallUnitsFact, undefined);
    assert.equal(plan.arrivalDate, '2026-09-10');
    assert.equal(plan.proofEndDate, '2026-10-08');
    assert.ok(plan.totalUnitsFact.value > 500, 'Transfer > 500 units requires owner approval');

    const sep8Idx = sim.liveDates.indexOf('2026-09-08');
    const step = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep8Idx,
      investigateTargetDay: true,
    });

    const bsCard = step.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    );
    assert.ok(bsCard, 'Best-sellers card must be raised on 2026-09-08');
    assert.ok(bsCard.investigation, 'Best-sellers card must have investigation on 2026-09-08');

    // Stage 2 fixes: <= 25 words each, Ruled out plain sentences, decisionRows in trace
    const inv = bsCard.investigation!;
    assert.ok(countSegmentsWords(inv.findingSegments) <= 25);
    assert.ok(countSegmentsWords(inv.causeSegments) <= 25);
    assert.ok(countSegmentsWords(inv.proposalSegments) <= 25);
    for (const ro of inv.ruledOut) {
      assert.ok(ro.summarySegments && ro.summarySegments.length > 0);
      assert.ok(ro.summary.length > 15, `Ruled out sentence too bare: ${ro.summary}`);
    }

    const decisionTraces = step.dayState.trace.filter(
      (t) => t.lane === 'manager' && t.kind === 'decision' && t.decisionRows && t.decisionRows.length > 0,
    );
    assert.ok(decisionTraces.length > 0, 'Expected structured decisionRows in Manager trace');
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Check 2 & Check 5 (no-key fallback): Approve Sep 8 -> In progress -> Proven -> Held-out silenced -> Rollout card', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const sep8Idx = baseSim.liveDates.indexOf('2026-09-08');

    const sep8Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep8Idx,
      investigateTargetDay: true,
    });
    const bsCard = sep8Res.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    )!;
    assert.ok(bsCard?.transferPlan);

    const gw = executeActionThroughGateway(
      {
        candidateId: bsCard.candidateId,
        date: '2026-09-08',
        kind: 'transfer',
        groupId: 'best_sellers',
        transferLines: bsCard.transferPlan!.transferLines,
        holdoutStoreId: bsCard.transferPlan!.holdoutStoreId,
        holdoutStoreName: bsCard.transferPlan!.holdoutStoreName,
        measure: bsCard.transferPlan!.measure,
        title: 'Best-sellers transfer',
        ownerApproved: true,
        approvedBy: 'Owner',
        plan: bsCard.transferPlan,
      },
      sep8Res.sim,
    );
    assert.equal(gw.ok, true);
    const decisions: ActionDecision[] = [gw.decision!];
    const reactions: CardReaction[] = [
      {
        id: 'react:approve:sep8',
        candidateId: bsCard.candidateId,
        date: '2026-09-08',
        dayIndex: sep8Idx,
        reaction: 'approve',
      },
    ];

    // On Sep 10 (arrival date): action is In progress, treated stores have fresh cover
    const sep10Idx = baseSim.liveDates.indexOf('2026-09-10');
    const sep10Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep10Idx,
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    assert.equal(sep10Res.dayState.inProgress?.length, 1);
    assert.equal(sep10Res.dayState.doneForYou?.length, 0);

    // Run until Sep 30: must prove "Worked. Proven against the held-out store.", silence Santana Row, and offer rollout card
    const sep30Idx = baseSim.liveDates.indexOf('2026-09-30');
    const sep30Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep30Idx,
      decisions,
      reactions,
      investigateTargetDay: true,
    });

    assert.equal(sep30Res.dayState.inProgress?.length, 0, 'Action should move out of In progress once proven');
    assert.equal(sep30Res.dayState.doneForYou?.length, 1);
    const done = sep30Res.dayState.doneForYou![0];
    assert.equal(done.verdict, 'worked_proven');
    assert.equal(done.verdictSentence, 'Worked. Proven against the held-out store.');
    assert.ok(done.provenMoneyFact && done.provenMoneyFact.value > 0);

    // Held-out Santana Row must NOT raise a separate stock_running_out card while silenced as control
    assert.ok(
      !sep30Res.dayState.raised.some(
        (r) => !r.isRollout && r.candidateId.includes('best_sellers'),
      ),
      'Held-out Santana Row must not raise a duplicate Best-sellers card',
    );

    const rolloutCard = sep30Res.dayState.raised.find((r) => r.isRollout);
    assert.ok(rolloutCard, 'Follow-on rollout card must appear once proven');
    assert.equal(rolloutCard.title, 'Roll out to the held-out store?');
    assert.ok(rolloutCard.transferPlan && rolloutCard.transferPlan.transferLines.length > 0);
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Check 3 & Check 5 (no-key fallback): Not now on Sep 8 -> worsens & re-raises with cost of delay -> late approve -> proven', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const sep8Idx = baseSim.liveDates.indexOf('2026-09-08');
    const reactions: CardReaction[] = [
      {
        id: 'react:not_now:sep8',
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        dayIndex: sep8Idx,
        reaction: 'not_now',
      },
    ];

    // Hidden on Sep 12
    const sep12Idx = baseSim.liveDates.indexOf('2026-09-12');
    const sep12Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep12Idx,
      reactions,
      investigateTargetDay: true,
    });
    assert.ok(
      !sep12Res.dayState.raised.some(
        (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
      ),
      'Deferred card must stay hidden while not worsened',
    );

    // Re-raises by Sep 23 after 3 consecutive lost-sales days, showing firstDetectedOn Sep 8 + Cost of delay so far
    const sep23Idx = baseSim.liveDates.indexOf('2026-09-23');
    const sep23Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep23Idx,
      reactions,
      investigateTargetDay: true,
    });
    const reRaised = sep23Res.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    );
    assert.ok(reRaised, 'Card must re-raise after 3 consecutive lost-sales days');
    assert.equal(reRaised.firstDetectedOn, '2026-09-08');
    assert.ok(reRaised.reRaisedOn && reRaised.reRaisedOn <= '2026-09-23');
    assert.ok(reRaised.costOfDelayFact && reRaised.costOfDelayFact.value > 0);

    // Approve late (e.g. Oct 5) -> arrives Oct 7 -> proves within ~9 days (Oct 15)
    const oct5Idx = baseSim.liveDates.indexOf('2026-10-05');
    const oct5Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct5Idx,
      reactions,
      investigateTargetDay: true,
    });
    const oct5Card = oct5Res.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    )!;
    assert.ok(oct5Card?.transferPlan);

    const gwLate = executeActionThroughGateway(
      {
        candidateId: oct5Card.candidateId,
        date: '2026-10-05',
        kind: 'transfer',
        groupId: 'best_sellers',
        transferLines: oct5Card.transferPlan!.transferLines,
        holdoutStoreId: oct5Card.transferPlan!.holdoutStoreId,
        holdoutStoreName: oct5Card.transferPlan!.holdoutStoreName,
        measure: oct5Card.transferPlan!.measure,
        title: 'Best-sellers late transfer',
        ownerApproved: true,
        approvedBy: 'Owner',
        plan: oct5Card.transferPlan,
      },
      oct5Res.sim,
    );
    assert.equal(gwLate.ok, true, `Late Oct 5 transfer should pass gateway: ${gwLate.refusalReason}`);

    const lateDecisions: ActionDecision[] = [gwLate.decision!];
    const lateReactions: CardReaction[] = [
      ...reactions,
      {
        id: 'react:approve:oct5',
        candidateId: oct5Card.candidateId,
        date: '2026-10-05',
        dayIndex: oct5Idx,
        reaction: 'approve',
      },
    ];

    const oct16Idx = baseSim.liveDates.indexOf('2026-10-16');
    const oct16Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct16Idx,
      decisions: lateDecisions,
      reactions: lateReactions,
      investigateTargetDay: true,
    });

    assert.equal(oct16Res.dayState.doneForYou?.length, 1);
    assert.equal(oct16Res.dayState.doneForYou![0].verdict, 'worked_proven');
    assert.equal(
      oct16Res.dayState.doneForYou![0].verdictSentence,
      'Worked. Proven against the held-out store.',
    );
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Dismiss with reason permanently hides situation and records reaction', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const sep8Idx = baseSim.liveDates.indexOf('2026-09-08');
    const oct5Idx = baseSim.liveDates.indexOf('2026-10-05');
    const reactions: CardReaction[] = [
      {
        id: 'react:dismiss:sep8',
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        dayIndex: sep8Idx,
        reaction: 'dismiss',
        reason: 'not_mine',
      },
    ];

    const oct5Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct5Idx,
      reactions,
      investigateTargetDay: true,
    });
    const bsAfterDismiss = oct5Res.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    );
    assert.ok(
      !bsAfterDismiss?.stores?.some(
        (s) => s.storeId === 'union_square' || s.storeId === 'palo_alto',
      ),
      'Stores on the dismissed Sep 8 card must remain permanently hidden',
    );
    assert.equal(oct5Res.dayState.reactions?.length, 1);
    assert.equal(oct5Res.dayState.reactions?.[0].reason, 'not_mine');
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});
