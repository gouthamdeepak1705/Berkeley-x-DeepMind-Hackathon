import test from 'node:test';
import assert from 'node:assert/strict';
import { createFact } from './engine/facts';
import { DEFAULT_SEED } from './engine/prng';
import { runSimulation } from './engine/simulation';
import { clearTimelineSnapshotCache, evaluateStage2UpToDay } from './engine/stage2Timeline';
import { computeExpectedFlaggedStats } from './builder/builder';
import { runSituationInvestigation } from './checker/checker';
import { buildTransferPlanForGroup } from './checker/transferPlan';
import {
  clearGeminiMemoryCache,
  exportRecordedRunFile,
  getGeminiCapBanner,
  getGeminiPlaybackMode,
  getGeminiUsageSummary,
  loadRecordedRunEntries,
  setGeminiPlaybackMode,
} from './gemini/client';
import { executeActionThroughGateway } from './gateway/gateway';
import { buildEndStatement } from './statement/statement';
import { ActionDecision, AutonomyReaction, BuiltToolRecord, CardReaction } from './types/domain';

test('Stage 5 full run: End Statement on 14 November computes 5/5 real, 0/6 look-alikes, money, cost, and built tools', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  clearTimelineSnapshotCache();
  clearGeminiMemoryCache();
  setGeminiPlaybackMode('replay');

  try {
    const baseSim = runSimulation(DEFAULT_SEED);
    const idx = (d: string) => baseSim.liveDates.indexOf(d);

    const decisions: ActionDecision[] = [];
    const reactions: CardReaction[] = [];
    const autonomyReactions: AutonomyReaction[] = [];
    const builtTools: BuiltToolRecord[] = [];

    // 1. Best-sellers on 2026-09-08
    const bsPlan = buildTransferPlanForGroup({ sim: baseSim, date: '2026-09-08', groupId: 'best_sellers' }).plan;
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

    // 2. Walnut Creek Knitwear on 2026-09-25
    const sep25 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-09-25'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    const wcCard = sep25.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(wcCard?.transferPlan);
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

    // 3. Santana Row rollout on 2026-09-30
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
    assert.ok(srGw.ok && srGw.decision);
    decisions.push(srGw.decision);
    reactions.push({
      id: 'r:sr',
      candidateId: `rollout:${bsGw.decision.id}`,
      date: '2026-09-30',
      dayIndex: idx('2026-09-30'),
      reaction: 'approve',
    });

    // 4. Walnut Creek Refunds raised near 2 October -> install tool + enable $50 switch
    let refDayStr = '2026-10-03';
    let octRefRes = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-03'),
      decisions,
      reactions,
      investigateTargetDay: true,
    });
    let refCard = octRefRes.dayState.raised.find((r) => r.detectorKind === 'refunds_out_of_line');
    if (!refCard) {
      for (let dIdx = idx('2026-09-29'); dIdx <= idx('2026-10-10'); dIdx++) {
        const probe = await evaluateStage2UpToDay({
          seed: DEFAULT_SEED,
          targetDayIndex: dIdx,
          decisions,
          reactions,
          investigateTargetDay: true,
        });
        const found = probe.dayState.raised.find((r) => r.detectorKind === 'refunds_out_of_line');
        if (found) {
          octRefRes = probe;
          refCard = found;
          refDayStr = probe.dayState.date;
          break;
        }
      }
    }
    assert.ok(refCard, `Walnut Creek refunds situation must raise near 2 October (checked through Oct 10)`);
    builtTools.push({
      id: 'tool:refund_exceptions_desk:walnut_creek',
      situationId: refCard.candidateId,
      title: 'Refund exceptions desk — Walnut Creek',
      storeId: 'walnut_creek',
      storeName: 'Walnut Creek',
      installedOn: refDayStr,
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
        generatedOn: refDayStr,
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
      date: refDayStr,
      dayIndex: idx(refDayStr),
      reaction: 'approve',
      detail: 'Installed Refund exceptions desk.',
    });
    const swGw = executeActionThroughGateway(
      {
        candidateId: refCard.candidateId,
        date: refDayStr,
        kind: 'refund_switch',
        storeId: 'walnut_creek',
        toolId: 'tool:refund_exceptions_desk:walnut_creek',
        ownerApproved: true,
      },
      octRefRes.sim,
    );
    assert.ok(swGw.ok && swGw.decision);
    decisions.push(swGw.decision);

    // 5. Pasadena Knitwear on 2026-10-15 + Indigo Autonomy offer acceptance
    const oct15 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-10-15'),
      decisions,
      reactions,
      builtTools,
      investigateTargetDay: true,
    });
    const pasCard = oct15.dayState.raised.find((r) => r.candidateId === 'situation:stock_running_out:knitwear');
    assert.ok(pasCard?.transferPlan);
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
    assert.ok(pasGw.ok && pasGw.decision);
    decisions.push(pasGw.decision);
    reactions.push({
      id: 'r:pas',
      candidateId: pasCard.candidateId,
      date: '2026-10-15',
      dayIndex: idx('2026-10-15'),
      reaction: 'approve',
    });
    assert.ok(oct15.dayState.autonomyRecord?.offerCard);
    autonomyReactions.push({
      id: 'auto:yes',
      offerId: oct15.dayState.autonomyRecord.offerCard.id,
      date: '2026-10-15',
      dayIndex: idx('2026-10-15'),
      reaction: 'enable_autonomy',
    });

    // 6. Run through penultimate day (no endStatement) and final day 14 Nov 2026 (endStatement present)
    const nov13 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: idx('2026-11-13'),
      decisions,
      reactions,
      autonomyReactions,
      builtTools,
      investigateTargetDay: true,
    });
    assert.equal(nov13.dayState.endStatement, undefined);

    const nov14 = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: nov13.decisions.length ? idx('2026-11-14') : idx('2026-11-14'),
      decisions: nov13.decisions,
      reactions,
      autonomyReactions,
      builtTools,
      investigateTargetDay: true,
    });
    const stmt = nov14.dayState.endStatement;
    assert.ok(stmt, '14 November must produce the End Statement');
    assert.equal(stmt.generatedOn, '2026-11-14');

    // Money checks
    assert.ok(stmt.money.provenAvoidedFact.value > 0);
    assert.ok(stmt.money.refundLeakageStoppedFact.value > 0);
    assert.equal(stmt.money.autonomousTransfersCountFact.value, 1);

    // Noticing accuracy: 5 of 5 real events, 0 of 6 look-alikes
    assert.equal(stmt.noticing.realTotalFact.value, 5);
    assert.equal(stmt.noticing.realRaisedFact.value, 5);
    assert.equal(stmt.noticing.lookAlikesTotalFact.value, 6);
    assert.equal(stmt.noticing.lookAlikesRaisedFact.value, 0);
    assert.ok(stmt.noticing.medianDaysEarlyFact.value >= 1);

    // Built tools & integrity checks
    assert.equal(stmt.built.toolsBuiltFact.value, 1);
    assert.equal(stmt.wrongOrUnproven.unprovenOnlyCountFact.value, 5); // WC Knitwear, SR Rollout, WC Refund Switch, Pasadena Knitwear, Napa Auto Knitwear
    assert.ok(stmt.cost.estimatedCostUsdFact.value === 0);
    assert.ok(stmt.money.provenAvoidedFact.id && stmt.money.provenAvoidedFact.note.length > 10);
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Part E Replay mode & fallback: default replay makes zero live calls, recorded entries replay cleanly', async () => {
  clearGeminiMemoryCache();
  assert.equal(getGeminiPlaybackMode(), 'replay');

  // Switch cleanly to live then back to replay
  assert.equal(setGeminiPlaybackMode('live'), 'live');
  assert.equal(getGeminiPlaybackMode(), 'live');
  assert.equal(setGeminiPlaybackMode('replay'), 'replay');
  assert.equal(getGeminiCapBanner(), null);

  // Even with a dummy key, replay mode must NEVER attempt live HTTP calls and must fall back cleanly
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'dummy-test-key-never-called';
  try {
    const sim = runSimulation(DEFAULT_SEED);
    const snap = {
      candidateId: 'situation:stock_running_out:knitwear',
      firstDetectedOn: '2026-09-25',
      lastSeenOn: '2026-09-25',
      title: 'Knitwear running short — Walnut Creek',
      summary: 'Knitwear cover fell below 2.5 weeks.',
      detectorKind: 'stock_running_out' as const,
      groupId: 'knitwear' as const,
      expected: createFact('t:exp', 'Expected', 2.5, 'weeks', 'Target cover.'),
      actual: createFact('t:act', 'Actual', 2.1, 'weeks', 'Current cover.'),
      stakePerWeek: createFact('t:stk', 'Weekly stake', 2400, 'USD', 'Weekly stake.'),
    };
    const inv = await runSituationInvestigation({
      situation: snap,
      sim,
      date: '2026-09-25',
      controlStores: new Set<string>(),
    });
    assert.equal(inv.mode, 'fallback');
    assert.equal(inv.jobKey, 'investigate_routine');
    const usage = getGeminiUsageSummary();
    assert.equal(usage.liveCalls, 0);

    // Round-trip recorded run serialization
    const loadedCount = loadRecordedRunEntries([
      {
        cacheKey: 'sample-key-1',
        kind: 'interactions',
        model: 'gemini-4-carbon',
        job: 'builder_requirement',
        feature: 'test',
        latencyMs: 420,
        inputTokens: 100,
        outputTokens: 50,
        data: { id: 'i1', model: 'gemini-4-carbon', latencyMs: 420, inputTokens: 100, outputTokens: 50, output_text: 'ok', steps: [] },
      },
    ]);
    assert.equal(loadedCount, 1);
    const exported = exportRecordedRunFile(DEFAULT_SEED);
    assert.equal(exported.version, 1);
    assert.equal(exported.entries.length, 1);

    // Helper sanity: computeExpectedFlaggedStats & buildEndStatement direct call
    const flagged = computeExpectedFlaggedStats(sim.walnutCreekRefunds, new Set());
    assert.ok(flagged.count > 0);
    const directStmt = buildEndStatement({
      seed: DEFAULT_SEED,
      date: '2026-11-14',
      sim,
      decisions: [],
      doneForYou: [],
      watcherEvalLog: [],
      allTrace: [],
      builtTools: [],
    });
    assert.equal(directStmt.noticing.realTotalFact.value, 5);
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
    setGeminiPlaybackMode('replay');
  }
});
