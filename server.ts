import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runSituationInvestigation } from './src/checker/checker';
import { DEFAULT_SEED } from './src/engine/prng';
import { runSimulation } from './src/engine/simulation';
import { buildLiveTimeline, runFullDiagnostics } from './src/engine/runner';
import { evaluateStage2UpToDay } from './src/engine/stage2Timeline';
import {
  clearGeminiMemoryCache,
  getGeminiUsageSummary,
  runConnectionTests,
} from './src/gemini/client';
import { generateDayOneBriefWithGemini } from './src/gemini/dayOne';
import { ActionDecision, InvestigationResult } from './src/types/domain';

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
    res.json({ ok: true, service: 'opscien-instinct', stage: 2 });
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

  app.post('/api/dev/clear-cache', (_req, res) => {
    clearGeminiMemoryCache();
    res.json({ ok: true });
  });

  app.post('/api/timeline/step', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        seed?: number;
        dayIndex?: number;
        decisions?: ActionDecision[];
        controlStores?: string[];
        investigateTargetDay?: boolean;
        completedInvestigations?: Record<string, InvestigationResult>;
      };
      const result = await evaluateStage2UpToDay({
        seed: typeof body.seed === 'number' ? body.seed : DEFAULT_SEED,
        targetDayIndex: typeof body.dayIndex === 'number' ? body.dayIndex : 0,
        decisions: Array.isArray(body.decisions) ? body.decisions : [],
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
        controlStores?: string[];
      };
      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const fromDayIndex = typeof body.fromDayIndex === 'number' ? body.fromDayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);

      const timeline = buildLiveTimeline(seed, decisions, controlStores);
      const baseCount = timeline.dayStates[fromDayIndex]?.trace.length ?? 0;
      let nextDayIndex: number | null = null;
      for (let i = fromDayIndex + 1; i < timeline.dayStates.length; i++) {
        if (timeline.dayStates[i].trace.length > baseCount) {
          nextDayIndex = i;
          break;
        }
      }
      res.json({ nextDayIndex });
    } catch (err) {
      res.status(500).json({
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
        controlStores?: string[];
        situationId?: string;
        completedInvestigations?: Record<string, InvestigationResult>;
      };

      const seed = typeof body.seed === 'number' ? body.seed : DEFAULT_SEED;
      const dayIndex = typeof body.dayIndex === 'number' ? body.dayIndex : 0;
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const controlStores = new Set(Array.isArray(body.controlStores) ? body.controlStores : []);
      const provided = toInvestigationMap(body.completedInvestigations);

      const preStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
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
        onEvent: (ev) => {
          sendEvent('step', ev);
        },
      });

      provided.set(targetSituation.candidateId, invResult);

      const finalStep = await evaluateStage2UpToDay({
        seed,
        targetDayIndex: dayIndex,
        decisions,
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
