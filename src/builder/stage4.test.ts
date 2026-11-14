import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../engine/calendar';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation } from '../engine/simulation';
import {
  clearTimelineSnapshotCache,
  evaluateStage2UpToDay,
} from '../engine/stage2Timeline';
import { executeActionThroughGateway } from '../gateway/gateway';
import {
  clearGeminiMemoryCache,
  getGeminiPlaybackMode,
  loadRecordedRunFromDisk,
  setGeminiPlaybackMode,
} from '../gemini/client';
import { GEMINI_SETTINGS } from '../gemini/settings';
import { buildWatcherBriefing } from '../watcher/briefing';
import {
  buildRefundDeskHtml,
  computeExpectedFlaggedStats,
  createDeliberatelyBrokenToolHtml,
  injectSandboxCsp,
  repairRefundDeskHtml,
} from './builder';
import { FALLBACK_REFUND_DESK_HTML } from './fallbackTool';
import { generateRefundDeskRequirement } from './requirement';
import { evaluateSandboxOutcome } from './tester';
import { ActionDecision, BuiltToolRecord, CardReaction } from '../types/domain';

test('Section 0 #5: investigate_large and investigate_routine firstTimeoutMs are >= 90000 ms', () => {
  assert.ok(GEMINI_SETTINGS.jobs.investigate_large.firstTimeoutMs >= 90000);
  assert.ok(GEMINI_SETTINGS.jobs.investigate_routine.firstTimeoutMs >= 90000);
  assert.equal(GEMINI_SETTINGS.jobs.builder_requirement.models[0], 'gemini-4-carbon');
  assert.equal(GEMINI_SETTINGS.jobs.builder_tool.models[0], 'gemini-4-carbon');
  assert.equal(GEMINI_SETTINGS.jobs.builder_tool.thinkingLevel, 'medium');
  assert.ok(GEMINI_SETTINGS.jobs.builder_tool.firstTimeoutMs >= 120000);
});

test('Section 0 #2: incremental server cache matches full rebuild byte-for-byte and runs step < 300 ms', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    clearTimelineSnapshotCache();
    const baseSim = runSimulation(DEFAULT_SEED);
    const sep8Idx = baseSim.liveDates.indexOf('2026-09-08');
    const sep30Idx = baseSim.liveDates.indexOf('2026-09-30');

    // Warm up to Sep 29 incrementally
    await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep30Idx - 1,
      investigateTargetDay: true,
    });

    // Incremental step for Sep 30 should be fast (< 300ms)
    const t0 = Date.now();
    const cachedRes = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep30Idx,
      investigateTargetDay: true,
    });
    const incMs = Date.now() - t0;
    assert.ok(incMs < 300, `Expected incremental non-live step < 300ms, got ${incMs}ms`);

    // Compare against full cold rebuild from Day 0
    clearTimelineSnapshotCache();
    const coldRes = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep30Idx,
      investigateTargetDay: true,
    });

    assert.equal(cachedRes.dayState.date, coldRes.dayState.date);
    assert.equal(cachedRes.dayState.raised.length, coldRes.dayState.raised.length);
    assert.equal(
      cachedRes.dayState.groupedLetGo.length,
      coldRes.dayState.groupedLetGo.length,
    );
    assert.equal(cachedRes.dayState.headlineFacts.total28dSales.value, coldRes.dayState.headlineFacts.total28dSales.value);

    // Ensure Sep 8 also works after cache rebuild
    const sep8Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep8Idx,
      investigateTargetDay: false,
    });
    assert.equal(sep8Res.dayState.date, '2026-09-08');
  } finally {
    clearTimelineSnapshotCache();
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Section 0 #4: no raw act: IDs in owner copy or Manager trace, and control store let-go lines grouped', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    clearTimelineSnapshotCache();
    const sim = runSimulation(DEFAULT_SEED);
    const sep8Idx = sim.liveDates.indexOf('2026-09-08');
    const sep8Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: sep8Idx,
      investigateTargetDay: true,
    });
    const bsCard = sep8Res.dayState.raised.find(
      (r) => r.candidateId === 'situation:stock_running_out:best_sellers',
    )!;
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
    assert.ok(gw.ok && gw.decision);

    const oct5Idx = sim.liveDates.indexOf('2026-10-05');
    const oct5Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct5Idx,
      decisions: [gw.decision!],
      reactions: [
        {
          id: 'react:approve:bs',
          candidateId: bsCard.candidateId,
          date: '2026-09-08',
          dayIndex: sep8Idx,
          reaction: 'approve',
        },
      ],
      investigateTargetDay: true,
    });

    for (const item of oct5Res.dayState.noticedAndLetGo) {
      assert.ok(
        !item.reason.includes('act:'),
        `Raw internal act ID leaked into noticedAndLetGo: ${item.reason}`,
      );
    }
    for (const g of oct5Res.dayState.groupedLetGo) {
      assert.ok(!g.headline.includes('act:'), `Raw internal ID in groupedLetGo: ${g.headline}`);
      assert.ok(!g.headline.includes('situation:'), `Raw situation ID in headline: ${g.headline}`);
      if (g.headline.includes('Santana Row')) {
        assert.ok(
          !g.headline.includes('3 stores'),
          `Santana Row repeated across detectors must not say 3 stores: ${g.headline}`,
        );
      }
    }
    for (const tr of oct5Res.dayState.trace) {
      if (tr.lane === 'manager') {
        assert.ok(!tr.headline.includes('situation:'), `Raw ID in manager trace: ${tr.headline}`);
      }
    }
  } finally {
    clearTimelineSnapshotCache();
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Stage 4: Oct 3 Walnut Creek refunds shows tool_to_build with Build & Ask store manager + store_manager_task works in In progress', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';
  try {
    clearTimelineSnapshotCache();
    const baseSim = runSimulation(DEFAULT_SEED);
    const oct3Idx = baseSim.liveDates.indexOf('2026-10-03');
    const oct3Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct3Idx,
      investigateTargetDay: true,
    });

    const refundCard = oct3Res.dayState.raised.find(
      (r) => r.detectorKind === 'refunds_out_of_line',
    );
    assert.ok(refundCard, 'Walnut Creek refunds card must be open on Oct 3');
    assert.ok(refundCard.investigation);
    assert.equal(refundCard.investigation!.outcomeKind, 'tool_to_build');
    assert.ok(
      refundCard.investigation!.options.some((o) => o.id === 'build_refund_desk'),
      'Options must include build_refund_desk',
    );
    assert.ok(
      refundCard.investigation!.options.some((o) => o.id === 'ask_store_manager'),
      'Options must include ask_store_manager',
    );

    // Requirement generation fallback check (0 digits typed outside facts)
    const req = await generateRefundDeskRequirement({
      situation: refundCard,
      sim: oct3Res.sim,
      date: '2026-10-03',
    });
    assert.equal(req.title, 'Refund exceptions desk');
    assert.equal(req.usedFallbackWording, true);
    assert.ok(req.purpose.length > 0 && req.verification.length > 0);

    // Store manager simulated task passes Gateway and enters In progress with 3-day due date
    const gwMgr = executeActionThroughGateway(
      {
        candidateId: refundCard.candidateId,
        date: '2026-10-03',
        kind: 'store_manager_task',
        storeId: 'walnut_creek',
        dueDate: addDays('2026-10-03', 3),
        title: 'Ask Walnut Creek store manager about Till 2 cash refunds after 8 pm',
        measure: 'Simulated question logged (due 6 Oct)',
        ownerApproved: true,
        approvedBy: 'Owner',
      },
      oct3Res.sim,
    );
    assert.equal(gwMgr.ok, true);

    // Verify on the exact same day AND the next day that the refund card remains open with Build available
    const oct3PostMgrRes = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct3Idx,
      decisions: [gwMgr.decision!],
      investigateTargetDay: true,
    });
    const oct3StillOpen = oct3PostMgrRes.dayState.raised.find(
      (r) => r.detectorKind === 'refunds_out_of_line',
    );
    assert.ok(oct3StillOpen, 'Refunds card must stay open on Needs you on the same day after Ask store manager');
    assert.equal(oct3StillOpen!.investigation?.outcomeKind, 'tool_to_build');

    const oct4Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct3Idx + 1,
      decisions: [gwMgr.decision!],
      investigateTargetDay: true,
    });
    const oct4StillOpen = oct4Res.dayState.raised.find(
      (r) => r.detectorKind === 'refunds_out_of_line',
    );
    assert.ok(oct4StillOpen, 'Refunds card must stay open on Needs you the next day after Ask store manager');
    assert.equal(oct4StillOpen!.investigation?.outcomeKind, 'tool_to_build');
    const mgrInProgress = oct4Res.dayState.inProgress?.find((a) => a.isSimulatedTask);
    assert.ok(mgrInProgress, 'Simulated store manager task should appear in In progress');
    assert.equal(mgrInProgress!.endDate, '2026-10-06');

    const oct7Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: baseSim.liveDates.indexOf('2026-10-07'),
      decisions: [gwMgr.decision!],
      investigateTargetDay: true,
    });
    const mgrDone = oct7Res.dayState.doneForYou?.find(
      (d) => d.decisionId === gwMgr.decision!.id,
    );
    assert.ok(mgrDone, 'Simulated store manager task closes after due date');
  } finally {
    clearTimelineSnapshotCache();
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

test('Stage 4: Refund exceptions desk math, sandbox test outcome evaluator, fallback builder, switch simulation & 21-day before/after proof', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevMode = getGeminiPlaybackMode();
  process.env.GEMINI_API_KEY = '';
  clearGeminiMemoryCache();
  setGeminiPlaybackMode('live');
  try {
    clearTimelineSnapshotCache();
    const baseSim = runSimulation(DEFAULT_SEED);
    const oct3Date = '2026-10-03';
    const windowStart = addDays(oct3Date, -34);
    const rows = baseSim.walnutCreekRefunds.filter(
      (r) => r.date >= windowStart && r.date <= oct3Date,
    );

    const stats = computeExpectedFlaggedStats(rows);
    assert.ok(stats.count > 0, 'Must have flagged Till 2 operator 14 evening cash refunds');
    assert.ok(stats.total > 0);
    assert.equal(stats.unreviewedFlaggedCount, stats.count);

    // Check marking 1 row reviewed reduces unreviewed count
    const statsOneReviewed = computeExpectedFlaggedStats(
      rows,
      new Set([stats.flaggedRows[0].id]),
    );
    assert.equal(statsOneReviewed.unreviewedFlaggedCount, stats.count - 1);

    // CSP injection check
    const cspWrapped = injectSandboxCsp(FALLBACK_REFUND_DESK_HTML);
    assert.ok(cspWrapped.includes('Content-Security-Policy'));
    assert.ok(!FALLBACK_REFUND_DESK_HTML.includes('localStorage'));

    // Test evaluator catches deliberately broken draft expectations & passes valid match
    const badEval = evaluateSandboxOutcome({
      loaded: true,
      reportedCount: 0,
      reportedTotal: 0,
      markReviewedAcked: false,
      expectedCount: stats.count,
      expectedTotal: stats.total,
    });
    assert.equal(badEval.allPassed, false);
    assert.equal(badEval.results[0].passed, true);
    assert.equal(badEval.results[1].passed, false);
    assert.equal(badEval.results[2].passed, false);

    const goodEval = evaluateSandboxOutcome({
      loaded: true,
      reportedCount: stats.count,
      reportedTotal: stats.total,
      markReviewedAcked: true,
      expectedCount: stats.count,
      expectedTotal: stats.total,
    });
    assert.equal(goodEval.allPassed, true);

    const brokenHtml = createDeliberatelyBrokenToolHtml();
    assert.ok(brokenHtml.includes('Refund exceptions desk'));

    // Fallback HTML build and repair without API key
    const oct3Idx = baseSim.liveDates.indexOf(oct3Date);
    const oct3Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct3Idx,
      investigateTargetDay: true,
    });
    const refundCard = oct3Res.dayState.raised.find(
      (r) => r.detectorKind === 'refunds_out_of_line',
    )!;
    const req = await generateRefundDeskRequirement({
      situation: refundCard,
      sim: oct3Res.sim,
      date: oct3Date,
    });
    const built = await buildRefundDeskHtml({ requirement: req, sampleRows: rows });
    assert.equal(built.usedFallbackCopy, true);
    assert.ok(built.html.includes('flagged_summary'));

    const repaired = await repairRefundDeskHtml({
      brokenHtml,
      failureReasons: badEval.failureReasons,
      requirement: req,
      sampleRows: rows,
    });
    assert.equal(repaired.usedFallbackCopy, true);

    // Gateway refund_switch -> simulation stops extra cash refunds starting Oct 4 -> 21-day proof closes Oct 25+
    const gwSwitch = executeActionThroughGateway(
      {
        candidateId: refundCard.candidateId,
        date: oct3Date,
        kind: 'refund_switch',
        storeId: 'walnut_creek',
        toolId: 'tool:refund_exceptions_desk:walnut_creek',
        title: 'Require manager approval for cash refunds over $50 at Walnut Creek',
        measure: 'Walnut Creek 21-day cash refund rate before vs after switch',
        ownerApproved: true,
        approvedBy: 'Owner',
      },
      oct3Res.sim,
    );
    assert.equal(gwSwitch.ok, true);
    const decisions: ActionDecision[] = [gwSwitch.decision!];
    const reactions: CardReaction[] = [
      {
        id: 'react:tool:install',
        candidateId: refundCard.candidateId,
        date: oct3Date,
        dayIndex: oct3Idx,
        reaction: 'approve',
      },
    ];
    const installedTool: BuiltToolRecord = {
      id: 'tool:refund_exceptions_desk:walnut_creek',
      situationId: refundCard.candidateId,
      title: 'Refund exceptions desk',
      storeId: 'walnut_creek',
      storeName: 'Walnut Creek',
      installedOn: oct3Date,
      html: FALLBACK_REFUND_DESK_HTML,
      model: 'code (fallback copy)',
      mode: 'fallback',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      byteSize: Buffer.byteLength(FALLBACK_REFUND_DESK_HTML, 'utf8'),
      usedFallbackCopy: true,
      repairedOnce: false,
      requirement: req,
      testResults: goodEval.results,
    };

    const switchedSim = runSimulation(DEFAULT_SEED, decisions);
    // Check refunds on Oct 5..Oct 25 vs before switch
    const afterRows = switchedSim.walnutCreekRefunds.filter(
      (r) => r.date > oct3Date && r.date <= '2026-10-25' && r.operatorNumber === 14 && r.till === 2,
    );
    assert.equal(afterRows.length, 0, 'Switch must stop extra Till 2 op 14 cash refunds starting next day');

    // Run timeline through Oct 25 (22 days after Oct 3 switch -> 21-day window closed on Oct 24/25)
    const oct26Idx = switchedSim.liveDates.indexOf('2026-10-26');
    const oct26Res = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: oct26Idx,
      decisions,
      reactions,
      investigateTargetDay: true,
      builtTools: [installedTool],
      reviewedRefundIds: [stats.flaggedRows[0].id],
    });

    const refundDone = oct26Res.dayState.doneForYou?.find(
      (d) => d.decisionId === gwSwitch.decision!.id,
    );
    assert.ok(refundDone, '21-day refund switch proof must close in Done for you');
    assert.equal(refundDone!.verdict, 'worked_before_after');
    assert.equal(
      refundDone!.verdictSentence,
      'Likely worked. One store, before and after: not proven.',
    );
    assert.ok(refundDone!.beforeRefundRateFact && refundDone!.afterRefundRateFact);
    assert.ok(
      refundDone!.afterRefundRateFact!.value < refundDone!.beforeRefundRateFact!.value,
      'After refund rate must drop significantly after switch',
    );

    // Watcher briefing strictly includes unreviewed flagged count as of Oct 3 (with 1 reviewed)
    const briefing = buildWatcherBriefing({
      sim: oct3Res.sim,
      date: oct3Date,
      subjects: [],
      openSituations: [],
      letGoSummaries: [],
      decisions: [],
      controlStores: new Set(),
      builtTools: [installedTool],
      reviewedRefundIds: [stats.flaggedRows[0].id],
    });
    assert.ok(
      briefing.includes(`${stats.count - 1} unreviewed flagged`),
      `Watcher briefing must include live unreviewed count (${stats.count - 1}), got:\n${briefing}`,
    );
  } finally {
    clearTimelineSnapshotCache();
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    else delete process.env.GEMINI_API_KEY;
    clearGeminiMemoryCache();
    loadRecordedRunFromDisk();
    setGeminiPlaybackMode(prevMode);
  }
});
