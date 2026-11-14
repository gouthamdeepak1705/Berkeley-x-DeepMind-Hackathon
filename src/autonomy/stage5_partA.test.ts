import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation } from '../engine/simulation';
import { evaluateStage2UpToDay, clearTimelineSnapshotCache } from '../engine/stage2Timeline';
import { buildTransferPlanForGroup } from '../checker/transferPlan';
import { executeActionThroughGateway } from '../gateway/gateway';
import { ActionDecision, AutonomyReaction, CardReaction } from '../types/domain';

test('Part A: routine knitwear waves, single-store proof, autonomy earn & auto-execution, >500 limit, and Undo revocation', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    const decisions: ActionDecision[] = [];
    const reactions: CardReaction[] = [];
    const autonomyReactions: AutonomyReaction[] = [];

    // 1. Sep 8 Best-sellers (>500 units, held-out Santana Row)
    const bsPlan = buildTransferPlanForGroup({ sim: baseSim, date: '2026-09-08', groupId: 'best_sellers' }).plan;
    assert.ok(bsPlan.totalUnitsFact.value > 500);
    assert.equal(bsPlan.holdoutStoreId, 'santana_row');
    const bsGw = executeActionThroughGateway(
      {
        candidateId: 'situation:stock_running_out:best_sellers',
        date: '2026-09-08',
        kind: 'transfer',
        groupId: 'best_sellers',
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

    // 2. Sep 25 Walnut Creek Knitwear -> single store, <500 units, routine kind, fast model
    const sep25 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-25'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const wcCard = sep25.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(wcCard, 'Walnut Creek Knitwear card must be raised on 2026-09-25');
    assert.equal(wcCard.investigation?.jobKey, 'investigate_routine');
    assert.ok(wcCard.transferPlan && wcCard.transferPlan.totalUnitsFact.value < 500);
    assert.equal(wcCard.transferPlan.receiverStoreIds.length, 1);
    assert.equal(wcCard.transferPlan.receiverStoreIds[0], 'walnut_creek');
    assert.ok(
      sep25.dayState.trace.some((t) => t.lane === 'data_scientist' && t.detail.includes('routine kind, fast model')),
      'Data scientist trace must label routine kind, fast model',
    );

    const wcGw = executeActionThroughGateway(
      {
        candidateId: wcCard.candidateId,
        date: '2026-09-25',
        kind: 'transfer',
        groupId: 'knitwear',
        ownerApproved: true,
        plan: wcCard.transferPlan,
      },
      sep25.sim,
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

    // 3. Oct 3: WC Knitwear 7-day check completes as worked_single_store
    const oct3 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-03'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const wcDfy = oct3.dayState.doneForYou?.find((d) => d.decisionId === wcGw.decision!.id);
    assert.ok(wcDfy, 'WC Knitwear should close in Done for you by Oct 3');
    assert.equal(wcDfy.verdict, 'worked_single_store');
    assert.ok(wcDfy.verdictSentence.includes('Before and after, one store: not proven alone'));

    // 4. Approve Santana Row rollout on Sep 30 (closes Oct 8) -> triggers 3-of-3 earn rule
    const srPlan = buildTransferPlanForGroup({
      sim: runSimulation(DEFAULT_SEED, decisions),
      date: '2026-09-30',
      groupId: 'best_sellers',
      explicitReceivers: ['santana_row'],
      disableHoldout: true,
    }).plan;
    const srGw = executeActionThroughGateway(
      {
        candidateId: `rollout:${bsGw.decision.id}`,
        date: '2026-09-30',
        kind: 'transfer',
        groupId: 'best_sellers',
        ownerApproved: true,
        plan: srPlan,
      },
      runSimulation(DEFAULT_SEED, decisions),
    );
    decisions.push(srGw.decision!);
    reactions.push({
      id: 'r:sr',
      candidateId: `rollout:${bsGw.decision.id}`,
      date: '2026-09-30',
      dayIndex: idx('2026-09-30'),
      reaction: 'approve',
    });

    // 5. Oct 15 Pasadena Knitwear MUST raise independently even though WC was knitwear!
    const oct15 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-15'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    assert.ok(oct15.dayState.autonomyRecord?.earnRuleMet, 'Earn rule must be met after 3 worked transfers (1 proven)');
    assert.equal(oct15.dayState.autonomyRecord?.offerCard?.status, 'pending');
    assert.equal(oct15.dayState.autonomyRecord?.level, 'recommend_decide');

    const pasCard = oct15.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(pasCard, 'Pasadena Knitwear must raise independently on 2026-10-15');
    assert.equal(pasCard.investigation?.jobKey, 'investigate_routine');
    assert.deepEqual(pasCard.transferPlan?.receiverStoreIds, ['pasadena']);
    assert.ok((pasCard.transferPlan?.totalUnitsFact.value ?? 999) < 500);

    const pasGw = executeActionThroughGateway(
      {
        candidateId: pasCard.candidateId,
        date: '2026-10-15',
        kind: 'transfer',
        groupId: 'knitwear',
        ownerApproved: true,
        plan: pasCard.transferPlan,
      },
      oct15.sim,
    );
    decisions.push(pasGw.decision!);
    reactions.push({
      id: 'r:pas',
      candidateId: pasCard.candidateId,
      date: '2026-10-15',
      dayIndex: idx('2026-10-15'),
      reaction: 'approve',
    });

    // 6. Owner says "Yes, within those limits" on Oct 15 -> level switches, and Nov 1 Napa auto-executes!
    autonomyReactions.push({
      id: 'auto:accept',
      offerId: oct15.dayState.autonomyRecord!.offerCard!.id,
      date: '2026-10-15',
      dayIndex: idx('2026-10-15'),
      reaction: 'enable_autonomy',
    });

    const nov1 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-01'),
      decisions,
      reactions,
      autonomyReactions,
      investigateTargetDay: true,
    });
    assert.equal(nov1.dayState.autonomyRecord?.level, 'autonomous_within_limits');
    // Napa card should NOT be raised in Needs you — it executed automatically into Done for you!
    assert.ok(
      !nov1.dayState.raised.some((r) => r.candidateId === 'situation:stock_running_out:knitwear'),
      'Napa Knitwear under 500 units should not raise an approval card once autonomy is enabled',
    );
    const autoNapa = nov1.dayState.doneForYou?.find((d) => d.isAutonomous);
    assert.ok(autoNapa, 'Napa Knitwear must appear automatically under Done for you');
    assert.equal(autoNapa.canUndo, true);
    assert.ok(autoNapa.movedSummary?.includes('Napa'));
    assert.ok(autoNapa.expectedWorthFact);

    // 7. Gateway limit: >500-unit transfer is STILL refused without owner approval even with autonomyGranted=true
    const bigGw = executeActionThroughGateway(
      {
        candidateId: 'test:big_auto',
        date: '2026-11-01',
        kind: 'transfer',
        groupId: 'best_sellers',
        ownerApproved: false,
        autonomous: true,
        autonomyGranted: true,
        transferLines: [
          {
            fromStoreId: 'sacramento',
            fromStoreName: 'Sacramento',
            toStoreId: 'walnut_creek',
            toStoreName: 'Walnut Creek',
            groupId: 'best_sellers',
            units: 600,
          },
        ],
      },
      nov1.sim,
    );
    assert.equal(bigGw.ok, false);

    // 8. Owner Undoes two transfers in a row -> autonomy reverts to "I recommend, you decide"
    const updatedDecisions = nov1.decisions.map((d) => {
      if (d.id === autoNapa.decisionId) return { ...d, undoneOnDate: '2026-11-02', unitsReturned: 371 };
      if (d.id === pasGw.decision!.id) return { ...d, undoneOnDate: '2026-11-02', unitsReturned: 200 };
      return d;
    });
    const nov2 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-02'),
      decisions: updatedDecisions,
      reactions,
      autonomyReactions,
      investigateTargetDay: true,
    });
    assert.equal(nov2.dayState.autonomyRecord?.level, 'recommend_decide');
    assert.ok(nov2.dayState.lostAutonomyReason?.includes('undid two transfers in a row'));
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Regression: snapshot cache hits preserve autonomous decisions when evaluating twice with pre-autonomy decisions', async () => {
  const { computeCalmStatusLine } = await import('../engine/demoDriver');
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);
    const decisions: ActionDecision[] = [];
    const reactions: CardReaction[] = [];
    const autonomyReactions: AutonomyReaction[] = [];

    // Approve Best-sellers Sep 8, WC Knitwear Sep 25, SR Rollout Sep 27
    const bsPlan = buildTransferPlanForGroup({ sim: baseSim, date: '2026-09-08', groupId: 'best_sellers' }).plan;
    const bsGw = executeActionThroughGateway(
      { candidateId: 'situation:stock_running_out:best_sellers', date: '2026-09-08', kind: 'transfer', groupId: 'best_sellers', ownerApproved: true, plan: bsPlan },
      baseSim,
    );
    decisions.push(bsGw.decision!);
    reactions.push({ id: 'r:bs', candidateId: 'situation:stock_running_out:best_sellers', date: '2026-09-08', dayIndex: idx('2026-09-08'), reaction: 'approve' });

    const wcPlan = buildTransferPlanForGroup({ sim: runSimulation(DEFAULT_SEED, decisions), date: '2026-09-25', groupId: 'knitwear', explicitReceivers: ['walnut_creek'], disableHoldout: true }).plan;
    const wcGw = executeActionThroughGateway(
      { candidateId: 'situation:stock_running_out:knitwear', date: '2026-09-25', kind: 'transfer', groupId: 'knitwear', ownerApproved: true, plan: wcPlan },
      runSimulation(DEFAULT_SEED, decisions),
    );
    decisions.push(wcGw.decision!);
    reactions.push({ id: 'r:wc', candidateId: 'situation:stock_running_out:knitwear', date: '2026-09-25', dayIndex: idx('2026-09-25'), reaction: 'approve' });

    const srPlan = buildTransferPlanForGroup({ sim: runSimulation(DEFAULT_SEED, decisions), date: '2026-09-27', groupId: 'best_sellers', explicitReceivers: ['santana_row'], disableHoldout: true }).plan;
    const srGw = executeActionThroughGateway(
      { candidateId: `rollout:${bsGw.decision!.id}`, date: '2026-09-27', kind: 'transfer', groupId: 'best_sellers', ownerApproved: true, plan: srPlan },
      runSimulation(DEFAULT_SEED, decisions),
    );
    decisions.push(srGw.decision!);
    reactions.push({ id: 'r:sr', candidateId: `rollout:${bsGw.decision!.id}`, date: '2026-09-27', dayIndex: idx('2026-09-27'), reaction: 'approve' });

    // Handle Walnut Creek refunds (raised 2026-09-30) so Nov 14 has no open decision cards
    const sep30 = await evaluateStage2UpToDay({ seed: DEFAULT_SEED, targetDayIndex: idx('2026-09-30'), decisions, reactions });
    const refCard = sep30.dayState.raised.find((r) => r.detectorKind === 'refunds_out_of_line');
    if (refCard) {
      reactions.push({ id: 'r:ref', candidateId: refCard.candidateId, date: '2026-09-30', dayIndex: idx('2026-09-30'), reaction: 'approve' });
    }

    // Autonomy offer accepted on Oct 5 (when 3rd transfer closes)
    const oct5 = await evaluateStage2UpToDay({ seed: DEFAULT_SEED, targetDayIndex: idx('2026-10-05'), decisions, reactions });
    assert.ok(oct5.dayState.autonomyRecord?.offerCard, 'Autonomy offer must raise on Oct 5');
    autonomyReactions.push({
      id: 'auto:accept',
      offerId: oct5.dayState.autonomyRecord.offerCard.id,
      date: '2026-10-05',
      dayIndex: idx('2026-10-05'),
      reaction: 'enable_autonomy',
    });

    // Cold call to Oct 15 (populates timelineSnapshotCache), followed by cached hit call with same pre-autonomy decisions
    const firstOct15 = await evaluateStage2UpToDay({ seed: DEFAULT_SEED, targetDayIndex: idx('2026-10-15'), decisions, reactions, autonomyReactions });
    assert.equal(firstOct15.decisions.length, 4, 'First run on Oct 15 must include Pasadena autonomous decision');
    const secondOct15 = await evaluateStage2UpToDay({ seed: DEFAULT_SEED, targetDayIndex: idx('2026-10-15'), decisions, reactions, autonomyReactions });
    assert.equal(secondOct15.decisions.length, 4, 'Cached repeat run on Oct 15 must still return Pasadena autonomous decision');
    assert.equal(secondOct15.decisions[3].isAutonomous, true);

    const nov14 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-14'),
      decisions: secondOct15.decisions,
      reactions,
      autonomyReactions,
    });
    assert.equal(nov14.dayState.endStatement?.money.autonomousTransfersCountFact.value, 2, 'Both Pasadena and Napa should run autonomously');
    assert.equal(
      computeCalmStatusLine({ dayState: nov14.dayState, activeInvestigation: null, builderProgressByCandidate: {} }),
      'Done. Proven.',
    );
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Fix 4: Dismissing Walnut Creek knitwear on Sep 25 still raises Pasadena on Oct 15 and Napa on Nov 1', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);
    const decisions: ActionDecision[] = [];
    const reactions: CardReaction[] = [];

    // 1. Dismiss Walnut Creek Knitwear on Sep 25
    const sep25 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-25'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const wcCard = sep25.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(wcCard, 'Walnut Creek Knitwear must raise on 2026-09-25');
    reactions.push({
      id: 'r:dismiss:wc',
      candidateId: wcCard.candidateId,
      date: '2026-09-25',
      dayIndex: idx('2026-09-25'),
      reaction: 'dismiss',
      reason: 'not_important',
    });

    // 2. Sep 26: Walnut Creek stays dismissed
    const sep26 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-26'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    assert.ok(
      !sep26.dayState.raised.some((r) => r.candidateId === 'situation:stock_running_out:knitwear'),
      'Dismissed Walnut Creek card must stay closed on Sep 26',
    );

    // 3. Oct 15: Pasadena Knitwear MUST raise independently and only include Pasadena
    const oct15 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-15'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const pasCard = oct15.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(pasCard, 'Pasadena Knitwear must still raise on 2026-10-15 after Walnut Creek dismissal');
    assert.deepEqual(
      pasCard.stores?.map((s) => s.storeId),
      ['pasadena'],
      'Pasadena card must contain only Pasadena',
    );
    assert.deepEqual(pasCard.transferPlan?.receiverStoreIds, ['pasadena']);
    assert.equal(pasCard.investigation?.jobKey, 'investigate_routine');

    // Approve Pasadena so Nov 1 Napa also surfaces cleanly
    const pasGw = executeActionThroughGateway(
      {
        candidateId: pasCard.candidateId,
        date: '2026-10-15',
        kind: 'transfer',
        groupId: 'knitwear',
        ownerApproved: true,
        plan: pasCard.transferPlan,
      },
      oct15.sim,
    );
    decisions.push(pasGw.decision!);
    reactions.push({
      id: 'r:approve:pas',
      candidateId: pasCard.candidateId,
      date: '2026-10-15',
      dayIndex: idx('2026-10-15'),
      reaction: 'approve',
    });

    // 4. Nov 1: Napa Knitwear MUST also raise independently
    const nov1 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-01'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const napaCard = nov1.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(napaCard, 'Napa Knitwear must still raise on 2026-11-01');
    assert.deepEqual(
      napaCard.stores?.map((s) => s.storeId),
      ['napa'],
    );
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

