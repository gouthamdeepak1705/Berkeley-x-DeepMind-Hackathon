import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runSituationInvestigation } from './src/checker/checker';
import { addDays } from './src/engine/calendar';
import { DEFAULT_SEED } from './src/engine/prng';
import { runSimulation } from './src/engine/simulation';
import { buildLiveTimeline, runFullDiagnostics } from './src/engine/runner';
import { evaluateStage2UpToDay } from './src/engine/stage2Timeline';
import { evaluateActionsUpToDate } from './src/followup/proof';
import {
  clearGeminiMemoryCache,
  getGeminiUsageSummary,
  runConnectionTests,
} from './src/gemini/client';
import { generateDayOneBriefWithGemini } from './src/gemini/dayOne';
import {
  clearGatewayAttemptLog,
  executeActionThroughGateway,
  runGatewaySelfTests,
} from './src/gateway/gateway';
import {
  ActionDecision,
  CardReaction,
  DismissReason,
  InvestigationResult,
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
    res.json({ ok: true, service: 'opscien-instinct', stage: 3 });
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
        controlStores?: string[];
        investigateTargetDay?: boolean;
        completedInvestigations?: Record<string, InvestigationResult>;
      };
      const result = await evaluateStage2UpToDay({
        seed: typeof body.seed === 'number' ? body.seed : DEFAULT_SEED,
        targetDayIndex: typeof body.dayIndex === 'number' ? body.dayIndex : 0,
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
        reactions: Array.isArray(body.reactions) ? body.reactions : [],
        controlStores: new Set(Array.isArray(body.controlStores) ? body.controlStores : []),
        investigateTargetDay: Boolean(body.investigateTargetDay),
        providedInvestigations: toInvestigationMap(body.completedInvestigations),
      });

      res.json({
        dayState: result.dayState,
        pendingSituation: result.pendingSituation ?? null,
        usage: getGeminiUsageSummary(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/timeline/next-event', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        fromDayIndex?: number;
        decisions?: ActionDecision[];
        reactions?: CardReaction[];
        controlStores?: string[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const fromDayIndex = typeof body.fromDayIndex === 'number' ? body.fromDayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);

      const timeline = buildLiveTimeline(seed, decisions, controlStores);
      const baseCount = timeline.dayStates[fromDayIndex]?.trace.length ?? 0;
      const handledRollouts = new Set(
        reactions
          .filter((r) => r.candidateId.startsWith('rollout:') && r.reaction !== 'not_now')
          .map((r) => r.candidateId),
      );
      const prevFollow = evaluateActionsUpToDate({
        sim: timeline.sim,
        decisions,
        date: timeline.dayStates[fromDayIndex]?.date ?? timeline.sim.liveDates[0],
        handledRolloutIds: handledRollouts,
      });

      // Detect currently active deferred stock items (not subsequently approved/dismissed) that may lose sales for 3 days running
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

      for (let i = fromDayIndex + 1; i < timeline.dayStates.length; i++) {
        const ds = timeline.dayStates[i];
        const d = ds.date;

        if (ds.trace.length > baseCount) {
          nextDayIndex = i;
          break;
        }

        const curFollow = evaluateActionsUpToDate({
          sim: timeline.sim,
          decisions,
          date: d,
          handledRolloutIds: handledRollouts,
        });
        if (
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
        completedInvestigations?: Record<string, InvestigationResult>;
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? [...body.decisions] : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const provided = toInvestigationMap(body.completedInvestigations);

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
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
        investigateTargetDay: false,
        providedInvestigations: provided,
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
        completedInvestigations?: Record<string, InvestigationResult>;
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? [...body.reactions] : [];
      const provided = toInvestigationMap(body.completedInvestigations);

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
        investigateTargetDay: false,
        providedInvestigations: provided,
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
        completedInvestigations?: Record<string, InvestigationResult>;
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const provided = toInvestigationMap(body.completedInvestigations);

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
      });

      const targetItem = preStep.dayState.raised.find((r) => r.candidateId === body.candidateId);
      if (!targetItem) {
        res.status(404).json({ ok: false, error: 'Card not found.' });
        return;
      }

      const freshInv = await runSituationInvestigation({
        situation: targetItem,
        sim: preStep.sim,
        date: preStep.dayState.date,
        bypassCache: true,
      });
      provided.set(targetItem.candidateId, freshInv);

      const postStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        investigateTargetDay: false,
        providedInvestigations: provided,
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
      };

      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const reactions = Array.isArray(body.reactions) ? body.reactions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);
      const provided = toInvestigationMap(body.completedInvestigations);

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        controlStores,
        investigateTargetDay: false,
        providedInvestigations: provided,
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

      const invResult = await runSituationInvestigation({
        situation: targetSituation,
        sim: preStep.sim,
        date: preStep.dayState.date,
        controlStores,
        onEvent: (ev) => {
          sendEvent('step', ev);
        },
      });

      provided.set(targetSituation.candidateId, invResult);

      const finalStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
        reactions,
        controlStores,
        investigateTargetDay: false,
        providedInvestigations: provided,
      });

      sendEvent('done', {
        investigation: invResult,
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
