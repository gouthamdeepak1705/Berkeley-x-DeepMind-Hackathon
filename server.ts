import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  buildRefundDeskHtml,
  createDeliberatelyBrokenToolHtml,
  repairRefundDeskHtml,
} from './src/builder/builder';
import { generateRefundDeskRequirement } from './src/builder/requirement';
import { runSituationInvestigation } from './src/checker/checker';
import { addDays, formatShortDate } from './src/engine/calendar';
import { DEFAULT_SEED } from './src/engine/prng';
import { runSimulation } from './src/engine/simulation';
import { buildLiveTimeline, runFullDiagnostics } from './src/engine/runner';
import {
  clearTimelineSnapshotCache,
  evaluateStage2UpToDay,
} from './src/engine/stage2Timeline';
import { evaluateActionsUpToDate } from './src/followup/proof';
import {
  clearGeminiMemoryCache,
  exportRecordedRunFile,
  getGeminiCapBanner,
  getGeminiPlaybackMode,
  getGeminiUsageSummary,
  runConnectionTests,
  setGeminiPlaybackMode,
} from './src/gemini/client';
import { generateDayOneBriefWithGemini } from './src/gemini/dayOne';
import {
  clearGatewayAttemptLog,
  executeActionThroughGateway,
  runGatewaySelfTests,
} from './src/gateway/gateway';
import { evaluateAutonomyRecord } from './src/autonomy/record';
import {
  ActionDecision,
  AutonomyReaction,
  BuilderRequirement,
  BuiltToolRecord,
  CardReaction,
  DismissReason,
  InvestigationResult,
  RaisedItem,
  TraceEntry,
} from './src/types/domain';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

function toInvestigationMap(
  record?: Record<string, InvestigationResult>,
): Map<string, InvestigationResult> {
  const map = new Map<string, InvestigationResult>();
  if (record && typeof record === 'object') {
    for (const [k, v] of Object.entries(record)) {
      if (v) map.set(k, v);
    }
  }
  return map;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'opscien-instinct', stage: 5 });
  });

  app.get('/api/day-one', async (_req, res) => {
    try {
      const sim = runSimulation(DEFAULT_SEED);
      const enriched = await generateDayOneBriefWithGemini(sim.dayOneBrief);
      res.json({
        brief: enriched,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/api/diagnostics', (_req, res) => {
    const report = runFullDiagnostics(DEFAULT_SEED);
    res.json(report);
  });

  app.get('/api/gemini/stats', (_req, res) => {
    res.json(getGeminiUsageSummary());
  });

  app.get('/api/gemini/mode', (_req, res) => {
    res.json({
      mode: getGeminiPlaybackMode(),
      capBanner: getGeminiCapBanner(),
      usage: getGeminiUsageSummary(),
    });
  });

  app.post('/api/gemini/mode', (req, res) => {
    const requested = (req.body as { mode?: string } | undefined)?.mode;
    const next = setGeminiPlaybackMode(requested === 'live' ? 'live' : 'replay');
    clearTimelineSnapshotCache();
    res.json({
      ok: true,
      mode: next,
      capBanner: getGeminiCapBanner(),
      usage: getGeminiUsageSummary(),
    });
  });

  app.get('/api/recorded-run/export', (_req, res) => {
    const payload = exportRecordedRunFile(DEFAULT_SEED);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="recorded_run.json"');
    res.send(JSON.stringify(payload, null, 2));
  });

  app.post('/api/dev/connection-test', async (_req, res) => {
    try {
      const report = await runConnectionTests();
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/dev/gateway-test', (_req, res) => {
    try {
      const sim = runSimulation(DEFAULT_SEED);
      const report = runGatewaySelfTests(sim, '2026-09-08');
      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/dev/clear-cache', (_req, res) => {
    clearGeminiMemoryCache();
    clearGatewayAttemptLog();
    clearTimelineSnapshotCache();
    res.json({ ok: true });
  });

  app.post('/api/timeline/reset-log', (_req, res) => {
    clearGatewayAttemptLog();
    res.json({ ok: true });
  });

  app.post('/api/timeline/step', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        controlStores?: string[];
        investigateTargetDay?: boolean;
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const result = await evaluateStage2UpToDay({
        seed: typeof body.seed === 'number' ? body.seed : DEFAULT_SEED,
        targetDayIndex: typeof body.dayIndex === 'number' ? body.dayIndex : 0,
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
        reactions: Array.isArray(body.reactions) ? body.reactions : [],
        autonomyReactions: Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [],
        controlStores: new Set(Array.isArray(body.controlStores) ? body.controlStores : []),
        investigateTargetDay: Boolean(body.investigateTargetDay),
        providedInvestigations: toInvestigationMap(body.completedInvestigations),
        builtTools: Array.isArray(body.builtTools) ? body.builtTools : [],
        reviewedRefundIds: Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [],
        builderTraceEntries: Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [],
      });

      res.json({
        dayState: result.dayState,
        decisions: result.decisions,
        pendingSituation: result.pendingSituation ?? null,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/timeline/next-event', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        fromDayIndex?: number;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        controlStores?: string[];
        openCandidateIds?: string[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const fromDayIndex = Math.max(0, typeof body.fromDayIndex === 'number' ? body.fromDayIndex : 0);
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);
      const clientOpenIds = Array.isArray(body.openCandidateIds)
        ? new Set(body.openCandidateIds)
        : null;
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries)
        ? body.builderTraceEntries
        : [];

      const timeline = buildLiveTimeline(seed, decisions, controlStores);
      const clampedFrom = Math.min(timeline.dayStates.length - 1, fromDayIndex);
      const baseState = timeline.dayStates[clampedFrom];

      const handledRollouts = new Set(
        reactions
          .filter((r) => r.candidateId.startsWith('rollout:') && r.reaction !== 'not_now')
          .map((r) => r.candidateId),
      );
      const closedIdsAtFrom = new Set(
        reactions
          .filter((r) => r.reaction === 'approve' || r.reaction === 'dismiss')
          .map((r) => r.candidateId),
      );
      const isClosedForEpisode = (
        candidateId: string,
        firstDetectedOn: string,
        stores?: RaisedItem['stores'],
      ): boolean => {
        if (candidateId.startsWith('situation:stock_running_out:')) {
          if (stores && stores.length > 0) {
            return stores.every((st) =>
              reactions.some(
                (r) =>
                  r.candidateId === candidateId &&
                  (r.reaction === 'approve' || r.reaction === 'dismiss') &&
                  r.date >= st.firstDetectedOn,
              ),
            );
          }
          return reactions.some(
            (r) =>
              r.candidateId === candidateId &&
              (r.reaction === 'approve' || r.reaction === 'dismiss') &&
              r.date >= firstDetectedOn,
          );
        }
        return closedIdsAtFrom.has(candidateId);
      };
      const deferredIdsAtFrom = new Set(
        reactions
          .filter((r) => r.reaction === 'not_now')
          .map((r) => r.candidateId),
      );
      const baseRaisedIds = new Set(baseState?.raised.map((r) => r.candidateId) ?? []);
      const baseLetGoGroupIds = new Set(baseState?.groupedLetGo.map((g) => g.id) ?? []);

      const unraisedWatchIds = clientOpenIds
        ? new Set(
            (baseState?.raised ?? [])
              .filter(
                (r) =>
                  !clientOpenIds.has(r.candidateId) &&
                  !isClosedForEpisode(r.candidateId, r.firstDetectedOn, r.stores) &&
                  !deferredIdsAtFrom.has(r.candidateId) &&
                  !r.groundTruth?.startsWith('near_miss:'),
              )
              .map((r) => r.candidateId),
          )
        : new Set<string>();

      const prevFollow = evaluateActionsUpToDate({
        sim: timeline.sim,
        decisions,
        date: baseState?.date ?? timeline.sim.liveDates[0],
        handledRolloutIds: handledRollouts,
      });
      const prevAuto = evaluateAutonomyRecord({
        date: baseState?.date ?? timeline.sim.liveDates[0],
        decisions,
        doneForYou: prevFollow.doneForYou,
        autonomyReactions,
      });

      const latestByCandidate = new Map<string, CardReaction>();
      for (const r of reactions) {
        latestByCandidate.set(r.candidateId, r);
      }
      const activeDeferredStock = Array.from(latestByCandidate.values()).filter(
        (r) =>
          r.reaction === 'not_now' &&
          r.candidateId.startsWith('situation:stock_running_out:') &&
          !decisions.some((d) => d.candidateId === r.candidateId),
      );
      const latestDeferDate =
        activeDeferredStock.length > 0
          ? activeDeferredStock[activeDeferredStock.length - 1].date
          : null;

      let nextDayIndex: number | null = null;
      let consecLostAfterDefer = 0;

      for (let i = clampedFrom + 1; i < timeline.dayStates.length; i++) {
        const ds = timeline.dayStates[i];
        const d = ds.date;

        const hasNewMaterialRaise = ds.raised.some(
          (r) =>
            (!baseRaisedIds.has(r.candidateId) ||
              r.candidateId.startsWith('situation:stock_running_out:knitwear')) &&
            !isClosedForEpisode(r.candidateId, r.firstDetectedOn, r.stores) &&
            !r.groundTruth?.startsWith('near_miss:'),
        );
        const hasNewLetGoGroup = ds.groupedLetGo.some(
          (g) =>
            !baseLetGoGroupIds.has(g.id) &&
            (g.checkKind === 'calendar' || g.checkKind === 'stock_returned'),
        );

        if (hasNewMaterialRaise || hasNewLetGoGroup) {
          nextDayIndex = i;
          break;
        }

        const curFollow = evaluateActionsUpToDate({
          sim: timeline.sim,
          decisions,
          date: d,
          handledRolloutIds: handledRollouts,
        });
        const curAuto = evaluateAutonomyRecord({
          date: d,
          decisions,
          doneForYou: curFollow.doneForYou,
          autonomyReactions,
        });
        const hasNewPendingOffer =
          curAuto.offerCard?.status === 'pending' &&
          prevAuto.offerCard?.id !== curAuto.offerCard?.id;

        if (
          hasNewPendingOffer ||
          curFollow.traceEntries.some((t) => t.date === d) ||
          curFollow.doneForYou.length > prevFollow.doneForYou.length ||
          curFollow.rolloutCards.length > prevFollow.rolloutCards.length ||
          decisions.some((dec) => (dec.arrivalDate ?? addDays(dec.date, 2)) === d)
        ) {
          nextDayIndex = i;
          break;
        }

        if (latestDeferDate && d > latestDeferDate) {
          const recs = timeline.sim.storeRecordsByDate[d];
          const lostAny = Object.values(recs).some(
            (r) => r.groups.best_sellers.potentialSales - r.groups.best_sellers.actualSales > 0.01,
          );
          if (lostAny) consecLostAfterDefer += 1;
          else consecLostAfterDefer = 0;
          if (consecLostAfterDefer >= 3) {
            nextDayIndex = i;
            break;
          }
        }

        if (unraisedWatchIds.size > 0 && ds.raised.some((r) => unraisedWatchIds.has(r.candidateId))) {
          const s2 = await evaluateStage2UpToDay({
            seed,
            targetDayIndex: i,
            decisions,
            reactions,
            autonomyReactions,
            controlStores,
            investigateTargetDay: false,
            providedInvestigations: provided,
            builtTools,
            reviewedRefundIds,
            builderTraceEntries,
          });
          if (s2.dayState.raised.some((r) => unraisedWatchIds.has(r.candidateId))) {
            nextDayIndex = i;
            break;
          }
        }
      }

      if (nextDayIndex === null && clampedFrom < timeline.dayStates.length - 1) {
        nextDayIndex = timeline.dayStates.length - 1;
      }
      if (typeof nextDayIndex === 'number' && nextDayIndex <= clampedFrom) {
        nextDayIndex =
          clampedFrom < timeline.dayStates.length - 1 ? clampedFrom + 1 : null;
      }

      res.json({ nextDayIndex });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/action/approve', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? [...body.decisions] : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? [...body.autonomyReactions] : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      const targetItem = preStep.dayState.raised.find((r) => r.candidateId === body.candidateId);
      if (!targetItem) {
        res.status(404).json({ ok: false, error: 'Card is no longer open.' });
        return;
      }

      const currentDate = preStep.dayState.date;
      const isTransfer = Boolean(targetItem.transferPlan);
      const gwResult = executeActionThroughGateway(
        isTransfer && targetItem.transferPlan
          ? {
              candidateId: targetItem.candidateId,
              date: currentDate,
              kind: 'transfer',
              groupId: targetItem.transferPlan.groupId,
              transferLines: targetItem.transferPlan.transferLines,
              holdoutStoreId: targetItem.transferPlan.holdoutStoreId,
              holdoutStoreName: targetItem.transferPlan.holdoutStoreName,
              measure: targetItem.transferPlan.measure,
              title: targetItem.isRollout
                ? `Rollout: ${targetItem.transferPlan.groupName} to ${targetItem.transferPlan.transferLines[0]?.toStoreName ?? 'held-out store'}`
                : `${targetItem.transferPlan.groupName} transfer`,
              parentDecisionId: targetItem.parentDecisionId,
              ownerApproved: true,
              approvedBy: 'Owner',
              plan: targetItem.transferPlan,
            }
          : {
              candidateId: targetItem.candidateId,
              date: currentDate,
              kind: targetItem.detectorKind === 'refunds_out_of_line' ? 'refund_audit' : 'other',
              title: targetItem.title,
              ownerApproved: true,
              approvedBy: 'Owner',
            },
        preStep.sim,
      );

      if (!gwResult.ok || !gwResult.decision) {
        res.status(400).json({
          ok: false,
          refusalReason: gwResult.refusalReason ?? 'Action refused by gateway.',
          traceEntry: gwResult.traceEntry,
        });
        return;
      }

      const newReaction: CardReaction = {
        id: `react:${targetItem.candidateId}:${currentDate}:approve:${reactions.length}`,
        candidateId: targetItem.candidateId,
        date: currentDate,
        dayIndex,
        reaction: 'approve',
        detail: gwResult.preview?.summary ?? `Approved ${targetItem.title}`,
      };
      const updatedDecisions = [...decisions, gwResult.decision];
      const updatedReactions = [...reactions, newReaction];

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions: updatedDecisions,
        reactions: updatedReactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        decision: gwResult.decision,
        reaction: newReaction,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/autonomy/respond', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        offerId: string;
        reaction: 'enable_autonomy' | 'keep_asking';
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const priorAutoReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const sim = runSimulation(seed, decisions);
      const date = sim.liveDates[Math.max(0, Math.min(sim.liveDates.length - 1, dayIndex))];
      const newReaction: AutonomyReaction = {
        id: `auto:${body.offerId}:${date}:${priorAutoReactions.length}`,
        offerId: body.offerId,
        date,
        dayIndex,
        reaction: body.reaction,
      };
      const updatedAutoReactions = [...priorAutoReactions, newReaction];

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions: updatedAutoReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        autonomyReaction: newReaction,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/action/undo', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        decisionId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? [...body.decisions] : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const preSim = runSimulation(seed, decisions);
      const date = preSim.liveDates[Math.max(0, Math.min(preSim.liveDates.length - 1, dayIndex))];
      const recs = preSim.storeRecordsByDate[date];

      const updatedDecisions = decisions.map((d) => {
        if (d.id !== body.decisionId || d.undoneOnDate) return d;
        const gid = d.groupId === 'knitwear' ? 'knitwear' : 'best_sellers';
        const arrivalDate = d.arrivalDate ?? addDays(d.date, 2);
        let returned = 0;
        for (const line of d.transferLines ?? []) {
          if (date < arrivalDate) {
            returned += line.units;
          } else {
            const avail = recs?.[line.toStoreId]?.groups[gid]?.endingStock ?? 0;
            returned += Math.min(avail, line.units);
          }
        }
        return {
          ...d,
          undoneOnDate: date,
          unitsReturned: Math.round(returned),
        };
      });

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions: updatedDecisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        decisions: postStep.decisions,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/action/react', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        reaction: 'not_now' | 'dismiss';
        reason?: DismissReason;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const sim = runSimulation(seed, decisions);
      const date = sim.liveDates[Math.max(0, Math.min(sim.liveDates.length - 1, dayIndex))];
      const newReaction: CardReaction = {
        id: `react:${body.candidateId}:${date}:${body.reaction}:${reactions.length}`,
        candidateId: body.candidateId,
        date,
        dayIndex,
        reaction: body.reaction,
        reason: body.reason,
      };
      const updatedReactions = [...reactions, newReaction];

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions: updatedReactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        reaction: newReaction,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/action/look-again', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      const targetItem = preStep.dayState.raised.find((r) => r.candidateId === body.candidateId);
      if (!targetItem) {
        res.status(404).json({ ok: false, error: 'Card not found.' });
        return;
      }

      const disSetLook =
        targetItem.detectorKind === 'stock_running_out' && targetItem.groupId
          ? preStep.dismissedStockStores?.get(targetItem.groupId)
          : undefined;
      const freshInv = await runSituationInvestigation({
        situation: targetItem,
        sim: preStep.sim,
        date: preStep.dayState.date,
        dismissedStores: disSetLook && disSetLook.size > 0 ? disSetLook : undefined,
        bypassCache: true,
      });
      provided.set(targetItem.candidateId, freshInv);

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        investigation: freshInv,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/action/store-manager', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? [...body.decisions] : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      const currentDate = preStep.dayState.date;
      const dueDate = addDays(currentDate, 3);
      const gwResult = executeActionThroughGateway(
        {
          candidateId: body.candidateId,
          date: currentDate,
          kind: 'store_manager_task',
          storeId: 'walnut_creek',
          dueDate,
          title: 'Ask Walnut Creek store manager about Till 2 cash refunds after 8 pm',
          measure: `Simulated question logged (due ${formatShortDate(dueDate)})`,
          ownerApproved: true,
          approvedBy: 'Owner',
        },
        preStep.sim,
      );

      if (!gwResult.ok || !gwResult.decision) {
        res.status(400).json({
          ok: false,
          refusalReason: gwResult.refusalReason ?? 'Action refused by gateway.',
        });
        return;
      }

      const updatedDecisions = [...decisions, gwResult.decision];
      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions: updatedDecisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        decision: gwResult.decision,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/builder/requirement', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];

      const step = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
      });

      const targetItem = step.dayState.raised.find((r) => r.candidateId === body.candidateId);
      if (!targetItem) {
        res.status(404).json({ ok: false, error: 'Card not found for requirement.' });
        return;
      }

      const requirement = await generateRefundDeskRequirement({
        situation: targetItem,
        sim: step.sim,
        date: step.dayState.date,
      });

      const traceEntry: TraceEntry = {
        id: `trace:${step.dayState.date}:dev:req:${targetItem.candidateId}:${Date.now()}`,
        date: step.dayState.date,
        lane: 'developer',
        kind: 'builder',
        headline: `Requirement written: ${requirement.title}`,
        detail: `${requirement.model} (${requirement.mode}, ${requirement.latencyMs} ms${requirement.mode === 'replayed' ? ' replayed' : ''}). ${requirement.plainSummary.purpose}`,
        outcome: 'info',
        meta: {
          model: requirement.model,
          mode: requirement.mode,
          latencyMs: requirement.latencyMs,
        },
      };

      res.json({
        ok: true,
        requirement,
        traceEntry,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/builder/build', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        requirement: BuilderRequirement;
        decisions?: ActionDecision[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];

      const sim = runSimulation(seed, decisions);
      const date = sim.liveDates[Math.max(0, Math.min(sim.liveDates.length - 1, dayIndex))];
      const windowStart = addDays(date, -34);
      const rows = sim.walnutCreekRefunds.filter((r) => r.date >= windowStart && r.date <= date);

      const buildResult = await buildRefundDeskHtml({
        requirement: body.requirement,
        sampleRows: rows,
      });

      const sizeKb = (buildResult.byteSize / 1024).toFixed(1);
      const traceEntry: TraceEntry = {
        id: `trace:${date}:dev:build:${Date.now()}`,
        date,
        lane: 'developer',
        kind: 'builder',
        headline: buildResult.usedFallbackCopy
          ? `Tool written from fallback copy (${sizeKb} KB)`
          : `Tool written by ${buildResult.model} (${sizeKb} KB)`,
        detail: buildResult.usedFallbackCopy
          ? `Fallback copy, not built live.${buildResult.errorNote ? ` (${buildResult.errorNote})` : ''}`
          : `Single-file HTML written in ${buildResult.latencyMs} ms${buildResult.mode === 'replayed' ? ' (replayed)' : ''} · ${buildResult.inputTokens} in / ${buildResult.outputTokens} out tokens.`,
        outcome: buildResult.usedFallbackCopy ? 'let_go' : 'info',
        meta: {
          model: buildResult.model,
          mode: buildResult.mode,
          latencyMs: buildResult.latencyMs,
        },
      };

      res.json({
        ok: true,
        buildResult,
        rows,
        date,
        traceEntry,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/builder/repair', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        requirement: BuilderRequirement;
        brokenHtml: string;
        failureReasons: string[];
        decisions?: ActionDecision[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];

      const sim = runSimulation(seed, decisions);
      const date = sim.liveDates[Math.max(0, Math.min(sim.liveDates.length - 1, dayIndex))];
      const windowStart = addDays(date, -34);
      const rows = sim.walnutCreekRefunds.filter((r) => r.date >= windowStart && r.date <= date);

      const repairResult = await repairRefundDeskHtml({
        brokenHtml: body.brokenHtml,
        failureReasons: body.failureReasons,
        requirement: body.requirement,
        sampleRows: rows,
      });

      const traceEntry: TraceEntry = {
        id: `trace:${date}:dev:repair:${Date.now()}`,
        date,
        lane: 'developer',
        kind: 'builder',
        headline: `Asked Gemini to repair tool once (${(repairResult.byteSize / 1024).toFixed(1)} KB)`,
        detail: `Failure reasons sent to ${repairResult.model}: ${body.failureReasons.join(' | ')}`,
        outcome: 'info',
        meta: {
          model: repairResult.model,
          mode: repairResult.mode,
          latencyMs: repairResult.latencyMs,
        },
      };

      res.json({
        ok: true,
        repairResult,
        traceEntry,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/builder/install', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        builtTool: BuiltToolRecord;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const priorTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? [...body.builderTraceEntries] : [];

      const sim = runSimulation(seed, decisions);
      const date = sim.liveDates[Math.max(0, Math.min(sim.liveDates.length - 1, dayIndex))];
      const newReaction: CardReaction = {
        id: `react:${body.candidateId}:${date}:approve_tool:${reactions.length}`,
        candidateId: body.candidateId,
        date,
        dayIndex,
        reaction: 'approve',
        detail: `Installed ${body.builtTool.title} after passing all 3 sandbox tests.`,
      };
      const updatedReactions = [...reactions, newReaction];
      const updatedTools = [
        ...priorTools.filter((t) => t.id !== body.builtTool.id),
        body.builtTool,
      ];

      const testSummary = body.builtTool.testResults
        .map((t) => `${t.label}: ${t.passed ? 'passed' : 'failed'}`)
        .join(' · ');
      builderTraceEntries.push({
        id: `trace:${date}:dev:tests:${body.builtTool.id}`,
        date,
        lane: 'developer',
        kind: 'builder',
        headline: `Tool verified & installed: ${body.builtTool.title}`,
        detail: `${testSummary}${body.builtTool.usedFallbackCopy ? ' · Fallback copy, not built live.' : ''}`,
        outcome: 'raised',
        meta: {
          model: body.builtTool.model,
          mode: body.builtTool.mode,
          latencyMs: body.builtTool.latencyMs,
        },
      });

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions: updatedReactions,
        autonomyReactions: Array.isArray((req.body as { autonomyReactions?: AutonomyReaction[] })?.autonomyReactions)
          ? (req.body as { autonomyReactions: AutonomyReaction[] }).autonomyReactions
          : [],
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools: updatedTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        reaction: newReaction,
        builtTools: updatedTools,
        builderTraceEntries,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/builder/switch-approve', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        candidateId: string;
        toolId: string;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        autonomyReactions?: AutonomyReaction[];
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? [...body.decisions] : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const autonomyReactions = Array.isArray(body.autonomyReactions) ? body.autonomyReactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      const currentDate = preStep.dayState.date;
      const gwResult = executeActionThroughGateway(
        {
          candidateId: body.candidateId,
          date: currentDate,
          kind: 'refund_switch',
          storeId: 'walnut_creek',
          toolId: body.toolId,
          title: 'Require manager approval for cash refunds over $50 at Walnut Creek',
          measure: 'Walnut Creek 21-day cash refund rate before vs after switch',
          ownerApproved: true,
          approvedBy: 'Owner',
        },
        preStep.sim,
      );

      if (!gwResult.ok || !gwResult.decision) {
        res.status(400).json({
          ok: false,
          refusalReason: gwResult.refusalReason ?? 'Action refused by gateway.',
        });
        return;
      }

      const updatedDecisions = [...decisions, gwResult.decision];
      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions: updatedDecisions,
        reactions,
        autonomyReactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      res.json({
        ok: true,
        decision: gwResult.decision,
        dayState: postStep.dayState,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/dev/broken-tool-test', async (req, res) => {
    try {
      const sim = runSimulation(DEFAULT_SEED, []);
      const testDate = '2026-10-03';
      const windowStart = addDays(testDate, -34);
      const rows = sim.walnutCreekRefunds.filter((r) => r.date >= windowStart && r.date <= testDate);
      const brokenHtml = createDeliberatelyBrokenToolHtml();
      const requirement = {
        situationId: 'situation:refunds_out_of_line:walnut_creek',
        title: 'Refund exceptions desk',
        generatedOn: testDate,
        purpose: [{ type: 'text' as const, text: 'Isolate and stop unlinked late-evening cash refunds at Walnut Creek.' }],
        users: [{ type: 'text' as const, text: 'Finance lead and owner.' }],
        shows: [{ type: 'text' as const, text: 'Thirty-five days of Walnut Creek refund records with Till two operator fourteen flagged.' }],
        actions: [{ type: 'text' as const, text: 'Mark reviewed and require manager approval for cash refunds above threshold.' }],
        verification: [{ type: 'text' as const, text: 'Loads cleanly, matches flagged count/total, and responds to mark-reviewed.' }],
        plainSummary: {
          purpose: 'Isolate and stop unlinked late-evening cash refunds at Walnut Creek.',
          users: 'Finance lead and owner.',
          shows: '35 days of Walnut Creek refund records with Till 2 operator 14 flagged.',
          actions: 'Mark reviewed and require manager approval for cash refunds over $50.',
          verification: 'Loads cleanly, matches flagged count/total, and responds to mark-reviewed.',
        },
        factsById: {},
        model: 'dev-test',
        mode: 'fallback' as const,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        usedFallbackWording: true,
      };
      void req;
      res.json({
        ok: true,
        brokenHtml,
        rows,
        requirement,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/timeline/investigate-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        controlStores?: string[];
        situationId?: string;
        completedInvestigations?: Record<string, InvestigationResult>;
        builtTools?: BuiltToolRecord[];
        reviewedRefundIds?: string[];
        builderTraceEntries?: TraceEntry[];
      };

      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);
      const provided = toInvestigationMap(body.completedInvestigations);
      const builtTools = Array.isArray(body.builtTools) ? body.builtTools : [];
      const reviewedRefundIds = Array.isArray(body.reviewedRefundIds) ? body.reviewedRefundIds : [];
      const builderTraceEntries = Array.isArray(body.builderTraceEntries) ? body.builderTraceEntries : [];

      const autonomyReactions = Array.isArray(
        (req.body as { autonomyReactions?: AutonomyReaction[] })?.autonomyReactions,
      )
        ? (req.body as { autonomyReactions: AutonomyReaction[] }).autonomyReactions
        : [];

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions,
        controlStores,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      const targetSituation =
        (body.situationId
          ? preStep.dayState.raised.find((r) => r.candidateId === body.situationId)
          : undefined) ?? preStep.pendingSituation;

      if (!targetSituation) {
        sendEvent('done', {
          investigation: null,
          dayState: preStep.dayState,
          usage: getGeminiUsageSummary(),
        });
        res.end();
        return;
      }

      const disSetStream =
        targetSituation.detectorKind === 'stock_running_out' && targetSituation.groupId
          ? preStep.dismissedStockStores?.get(targetSituation.groupId)
          : undefined;
      const invResult = await runSituationInvestigation({
        situation: targetSituation,
        sim: preStep.sim,
        date: preStep.dayState.date,
        controlStores,
        dismissedStores: disSetStream && disSetStream.size > 0 ? disSetStream : undefined,
        onEvent: (ev) => {
          sendEvent('step', ev);
        },
      });

      const invKey =
        targetSituation.detectorKind === 'stock_running_out' &&
        targetSituation.groupId === 'knitwear' &&
        targetSituation.stores?.length
          ? `${targetSituation.candidateId}:${targetSituation.stores.map((s) => s.storeId).sort().join(',')}:${targetSituation.firstDetectedOn}`
          : targetSituation.candidateId;
      provided.set(invKey, invResult);

      const finalStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        autonomyReactions: Array.isArray((req.body as { autonomyReactions?: AutonomyReaction[] })?.autonomyReactions)
          ? (req.body as { autonomyReactions: AutonomyReaction[] }).autonomyReactions
          : [],
        controlStores,
        investigateTargetDay: false,
        providedInvestigations: provided,
        builtTools,
        reviewedRefundIds,
        builderTraceEntries,
      });

      sendEvent('done', {
        investigation: invResult,
        investigationKey: invKey,
        dayState: finalStep.dayState,
        usage: getGeminiUsageSummary(),
      });
      res.end();
    } catch (err) {
      sendEvent('error', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OpsCien Instinct server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
