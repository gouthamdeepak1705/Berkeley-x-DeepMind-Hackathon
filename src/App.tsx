import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runSandboxedToolTests } from './builder/tester';
import { BuiltToolPanel } from './components/BuiltToolPanel';
import { ClockHeader, PlaybackSpeed } from './components/ClockHeader';
import { DayOneScreen } from './components/DayOneScreen';
import { DevDiagnosticsPage } from './components/DevDiagnosticsPage';
import { EndStatement } from './components/EndStatement';
import { FactPopover } from './components/FactPopover';
import {
  ActiveInvestigationBanner,
  BuilderErrorState,
  DemoHighlightState,
  OwnerFeed,
} from './components/OwnerFeed';
import { RealityNoteModal } from './components/RealityNoteModal';
import { SalesChart } from './components/SalesChart';
import { GeminiTelemetrySnapshot, TracePanel } from './components/TracePanel';
import {
  computeCalmStatusLine,
  selectNextWatchDemoBeat,
  selectWatchCaptionForDay,
} from './engine/demoDriver';
import { DEFAULT_SEED } from './engine/prng';
import { buildLiveTimeline, runFullDiagnostics } from './engine/runner';
import {
  ActionDecision,
  AutonomyReaction,
  BuilderRequirement,
  BuiltToolRecord,
  CardReaction,
  DayOneBrief,
  DayState,
  DismissReason,
  Fact,
  InvestigationResult,
  RaisedItem,
  RefundRecord,
  TraceEntry,
} from './types/domain';

interface UsageBannerState extends GeminiTelemetrySnapshot {
  decisionCapReached: boolean;
  otherCapReached: boolean;
}

function isDevRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return window.location.pathname === '/dev' || params.get('dev') === '1';
}

function isAutostart(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('autostart') === '1';
}

export default function App() {
  const baseTimeline = useMemo(() => buildLiveTimeline(DEFAULT_SEED), []);
  const diagnostics = useMemo(() => runFullDiagnostics(DEFAULT_SEED), []);

  const [showDevPage, setShowDevPage] = useState<boolean>(isDevRoute);
  const [started, setStarted] = useState<boolean>(isAutostart);
  const [runMode, setRunMode] = useState<'drive' | 'watch'>('drive');
  const [dayOneBrief, setDayOneBrief] = useState<DayOneBrief>(baseTimeline.sim.dayOneBrief);
  const [loadingBrief, setLoadingBrief] = useState<boolean>(false);

  const [dayIndex, setDayIndex] = useState<number>(0);
  const [currentDayState, setCurrentDayState] = useState<DayState>(baseTimeline.dayStates[0]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [requestInFlight, setRequestInFlight] = useState<boolean>(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeInvestigation, setActiveInvestigation] =
    useState<ActiveInvestigationBanner | null>(null);
  const [telemetry, setTelemetry] = useState<UsageBannerState | null>(null);

  const [geminiMode, setGeminiMode] = useState<'replay' | 'live'>('replay');
  const [capBanner, setCapBanner] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState<boolean>(false);
  const [traceDrawerOpen, setTraceDrawerOpen] = useState<boolean>(false);

  const [pendingRequirements, setPendingRequirements] = useState<
    Record<string, BuilderRequirement>
  >({});
  const [builderProgressByCandidate, setBuilderProgressByCandidate] = useState<
    Record<string, string>
  >({});
  const [builderErrorByCandidate, setBuilderErrorByCandidate] = useState<
    Record<string, BuilderErrorState>
  >({});
  const [openToolId, setOpenToolId] = useState<string | null>(null);

  const [demoHighlight, setDemoHighlight] = useState<DemoHighlightState | null>(null);
  const [demoCaption, setDemoCaption] = useState<string | null>(null);

  const [inspectedFact, setInspectedFact] = useState<Fact | null>(null);
  const [showRealityNote, setShowRealityNote] = useState<boolean>(false);

  const decisionsRef = useRef<ActionDecision[]>([]);
  const reactionsRef = useRef<CardReaction[]>([]);
  const autonomyReactionsRef = useRef<AutonomyReaction[]>([]);
  const completedInvRef = useRef<Record<string, InvestigationResult>>({});
  const builtToolsRef = useRef<BuiltToolRecord[]>([]);
  const reviewedRefundIdsRef = useRef<string[]>([]);
  const builderTraceRef = useRef<TraceEntry[]>([]);
  const executedBeatKeysRef = useRef<Set<string>>(new Set());

  const resumeAfterInvestigationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);
  const requestSeqRef = useRef<number>(0);
  const dayIndexRef = useRef<number>(0);

  const totalDays = baseTimeline.dayStates.length;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncUsageMeta = useCallback((usage?: UsageBannerState | null) => {
    if (!usage) return;
    setTelemetry(usage);
    if (usage.geminiMode === 'live' || usage.geminiMode === 'replay') {
      setGeminiMode(usage.geminiMode);
    }
    setCapBanner(usage.capBanner ?? null);
  }, []);

  const applyDayState = useCallback((ds: DayState, options?: { allowReset?: boolean }) => {
    if (!options?.allowReset && ds.dayIndex < dayIndexRef.current) {
      return;
    }
    dayIndexRef.current = ds.dayIndex;
    setDayIndex(ds.dayIndex);
    setCurrentDayState(ds);
    if (ds.geminiMode === 'live' || ds.geminiMode === 'replay') {
      setGeminiMode(ds.geminiMode);
    }
    if (ds.geminiCapBanner) {
      setCapBanner(ds.geminiCapBanner);
    }
    for (const r of ds.raised) {
      if (r.investigation) {
        const key =
          r.detectorKind === 'stock_running_out' && r.groupId === 'knitwear' && r.stores?.length
            ? `${r.candidateId}:${r.stores.map((s) => s.storeId).sort().join(',')}:${r.firstDetectedOn}`
            : r.candidateId;
        completedInvRef.current[key] = r.investigation;
      }
    }
  }, []);

  const commonStatePayload = useCallback(
    () => ({
      seed: DEFAULT_SEED,
      decisions: decisionsRef.current,
      reactions: reactionsRef.current,
      autonomyReactions: autonomyReactionsRef.current,
      completedInvestigations: completedInvRef.current,
      builtTools: builtToolsRef.current,
      reviewedRefundIds: reviewedRefundIdsRef.current,
      builderTraceEntries: builderTraceRef.current,
    }),
    [],
  );

  // Load initial Day One brief & Gemini playback mode
  useEffect(() => {
    let cancelled = false;
    setLoadingBrief(true);
    fetch('/api/day-one')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.brief) setDayOneBrief(data.brief as DayOneBrief);
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      })
      .catch(() => {
        // Keep code fallback DayOneBrief
      })
      .finally(() => {
        if (!cancelled) setLoadingBrief(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncUsageMeta]);

  useEffect(() => {
    const onPopState = () => {
      setShowDevPage(isDevRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspectedFact(null);
        setShowRealityNote(false);
        setTraceDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const streamInvestigation = useCallback(
    async (targetDayIdx: number, pending: RaisedItem, wasPlaying: boolean, seq: number) => {
      setIsPlaying(false);
      resumeAfterInvestigationRef.current = wasPlaying;
      setActiveInvestigation({
        situationId: pending.candidateId,
        title: pending.title,
        headline: `Noticed: ${pending.title}. Checking now.`,
        steps: [],
      });

      try {
        const res = await fetch('/api/timeline/investigate-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: targetDayIdx,
            controlStores: [],
            situationId: pending.candidateId,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (seq !== requestSeqRef.current || !isMountedRef.current) return;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            let eventType = 'message';
            let dataStr = '';
            for (const line of rawEvent.split('\n')) {
              if (line.startsWith('event:')) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataStr += line.slice(5).trim();
              }
            }

            if (!dataStr) continue;
            const parsed = JSON.parse(dataStr);

            if (eventType === 'step' && seq === requestSeqRef.current && isMountedRef.current) {
              const stepMsg = String(parsed.message ?? '');
              if (stepMsg) {
                setActiveInvestigation((prev) =>
                  prev
                    ? {
                        ...prev,
                        steps: [...prev.steps, stepMsg].slice(-8),
                      }
                    : prev,
                );
              }
            } else if (
              eventType === 'done' &&
              seq === requestSeqRef.current &&
              isMountedRef.current
            ) {
              if (parsed.investigation) {
                const storeKey = String(parsed.investigationKey ?? pending.candidateId);
                completedInvRef.current = {
                  ...completedInvRef.current,
                  [storeKey]: parsed.investigation as InvestigationResult,
                };
              }
              if (parsed.dayState) {
                applyDayState(parsed.dayState as DayState);
              }
              if (parsed.usage) {
                syncUsageMeta(parsed.usage as UsageBannerState);
              }
            }
          }
        }
      } catch {
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        const fallbackRes = await fetch('/api/timeline/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: targetDayIdx,
            controlStores: [],
            investigateTargetDay: true,
          }),
        });
        if (fallbackRes.ok && seq === requestSeqRef.current && isMountedRef.current) {
          const data = await fallbackRes.json();
          if (Array.isArray(data.decisions)) {
            decisionsRef.current = data.decisions as ActionDecision[];
          }
          if (data.dayState) {
            applyDayState(data.dayState as DayState);
          }
          if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
        }
      } finally {
        if (seq === requestSeqRef.current && isMountedRef.current) {
          setActiveInvestigation(null);
          if (resumeAfterInvestigationRef.current && targetDayIdx < totalDays - 1) {
            setIsPlaying(true);
          }
          resumeAfterInvestigationRef.current = false;
        }
      }
    },
    [applyDayState, commonStatePayload, syncUsageMeta, totalDays],
  );

  const stepToDayLocked = useCallback(
    async (targetIdx: number, playModeActive: boolean, seq: number) => {
      if (targetIdx < dayIndexRef.current) return;
      const res = await fetch('/api/timeline/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commonStatePayload(),
          dayIndex: targetIdx,
          controlStores: [],
          investigateTargetDay: false,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== requestSeqRef.current || !isMountedRef.current) return;

      if (Array.isArray(data.decisions)) {
        decisionsRef.current = data.decisions as ActionDecision[];
      }
      if (data.dayState) {
        applyDayState(data.dayState as DayState);
      }
      if (data.usage) {
        syncUsageMeta(data.usage as UsageBannerState);
      }

      if (data.pendingSituation) {
        await streamInvestigation(
          targetIdx,
          data.pendingSituation as RaisedItem,
          playModeActive,
          seq,
        );
      }
    },
    [applyDayState, commonStatePayload, streamInvestigation, syncUsageMeta],
  );

  const runSingleFlight = useCallback(async (fn: (seq: number) => Promise<void>) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRequestInFlight(true);
    setActionError(null);
    const seq = ++requestSeqRef.current;
    try {
      await fn(seq);
    } finally {
      if (seq === requestSeqRef.current) {
        inFlightRef.current = false;
        if (isMountedRef.current) {
          setRequestInFlight(false);
          setActionBusyId(null);
        }
      }
    }
  }, []);

  const stepToDay = useCallback(
    (targetIdx: number, playModeActive: boolean) =>
      runSingleFlight(async (seq) => {
        await stepToDayLocked(targetIdx, playModeActive, seq);
      }),
    [runSingleFlight, stepToDayLocked],
  );

  useEffect(() => {
    if (!started || showDevPage) return;
    if (dayIndex === 0 && !currentDayState.watcherEvalLog && !inFlightRef.current) {
      void stepToDay(0, isPlaying);
    }
  }, [started, showDevPage, dayIndex, currentDayState.watcherEvalLog, stepToDay, isPlaying]);

  const handleReset = async (returnToDayOne: boolean = true) => {
    requestSeqRef.current += 1;
    inFlightRef.current = false;
    setRequestInFlight(false);
    setActionBusyId(null);
    setIsPlaying(false);
    setActiveInvestigation(null);
    setActionError(null);
    setPendingRequirements({});
    setBuilderProgressByCandidate({});
    setBuilderErrorByCandidate({});
    setOpenToolId(null);
    setDemoHighlight(null);
    setDemoCaption(null);
    resumeAfterInvestigationRef.current = false;

    decisionsRef.current = [];
    reactionsRef.current = [];
    autonomyReactionsRef.current = [];
    completedInvRef.current = {};
    builtToolsRef.current = [];
    reviewedRefundIdsRef.current = [];
    builderTraceRef.current = [];
    executedBeatKeysRef.current = new Set();

    dayIndexRef.current = 0;
    setDayIndex(0);
    setCurrentDayState(baseTimeline.dayStates[0]);
    try {
      await fetch('/api/timeline/reset-log', { method: 'POST' });
    } catch {
      // ignore
    }
    if (returnToDayOne) {
      setStarted(false);
      setRunMode('drive');
      setSpeed(1);
    } else {
      void stepToDay(0, false);
    }
  };

  const handleStartWatch = async () => {
    await handleReset(false);
    setRunMode('watch');
    setSpeed(2);
    setStarted(true);
    setIsPlaying(true);
    setDemoCaption('Starting Watch it run from 1 August 2026.');
  };

  const handleStartDrive = async () => {
    await handleReset(false);
    setRunMode('drive');
    setSpeed(1);
    setStarted(true);
    setIsPlaying(false);
    setDemoCaption(null);
  };

  const handleSkipToNextEvent = () => {
    setIsPlaying(false);
    setRunMode('drive');
    setDemoHighlight(null);
    if (dayIndexRef.current >= totalDays - 1) return;
    void runSingleFlight(async (seq) => {
      const fromIdx = dayIndexRef.current;
      const res = await fetch('/api/timeline/next-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commonStatePayload(),
          fromDayIndex: fromIdx,
          controlStores: [],
          openCandidateIds: currentDayState.raised.map((r) => r.candidateId),
        }),
      });
      if (!res.ok || seq !== requestSeqRef.current || !isMountedRef.current) return;
      const data = (await res.json()) as { nextDayIndex: number | null };
      if (typeof data.nextDayIndex === 'number' && data.nextDayIndex > fromIdx) {
        await stepToDayLocked(data.nextDayIndex, false, seq);
      }
    });
  };

  const handleApproveCard = useCallback(
    (candidateId: string) => {
      void runSingleFlight(async (seq) => {
        setActionBusyId(candidateId);
        try {
          const res = await fetch('/api/action/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...commonStatePayload(),
              dayIndex: dayIndexRef.current,
              candidateId,
            }),
          });
          const data = await res.json();
          if (seq !== requestSeqRef.current || !isMountedRef.current) return;
          if (!res.ok || !data.ok) {
            setActionError(data.refusalReason ?? data.error ?? 'Action could not be approved.');
            return;
          }
          if (data.decision) {
            decisionsRef.current = [...decisionsRef.current, data.decision as ActionDecision];
          }
          if (data.reaction) {
            reactionsRef.current = [...reactionsRef.current, data.reaction as CardReaction];
          }
          if (data.dayState) applyDayState(data.dayState as DayState);
          if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
        } catch (err) {
          if (seq === requestSeqRef.current && isMountedRef.current) {
            setActionError(err instanceof Error ? err.message : String(err));
          }
        }
      });
    },
    [applyDayState, commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleReactCard = useCallback(
    (candidateId: string, reaction: 'not_now' | 'dismiss', reason?: DismissReason) => {
      setIsPlaying(false);
      void runSingleFlight(async (seq) => {
        setActionBusyId(candidateId);
        const res = await fetch('/api/action/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: dayIndexRef.current,
            candidateId,
            reaction,
            reason,
          }),
        });
        const data = await res.json();
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        if (res.ok && data.ok) {
          if (data.reaction) {
            reactionsRef.current = [...reactionsRef.current, data.reaction as CardReaction];
          }
          if (data.dayState) applyDayState(data.dayState as DayState);
          if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
        }
      });
    },
    [applyDayState, commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleLookAgainCard = (candidateId: string) => {
    setIsPlaying(false);
    void runSingleFlight(async (seq) => {
      setActionBusyId(candidateId);
      const res = await fetch('/api/action/look-again', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commonStatePayload(),
          dayIndex: dayIndexRef.current,
          candidateId,
        }),
      });
      const data = await res.json();
      if (seq !== requestSeqRef.current || !isMountedRef.current) return;
      if (res.ok && data.ok) {
        if (data.investigation) {
          completedInvRef.current = {
            ...completedInvRef.current,
            [candidateId]: data.investigation as InvestigationResult,
          };
        }
        if (data.dayState) applyDayState(data.dayState as DayState);
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      }
    });
  };

  const handleAskStoreManager = (candidateId: string) => {
    setIsPlaying(false);
    void runSingleFlight(async (seq) => {
      setActionBusyId(candidateId);
      const res = await fetch('/api/action/store-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commonStatePayload(),
          dayIndex: dayIndexRef.current,
          candidateId,
        }),
      });
      const data = await res.json();
      if (seq !== requestSeqRef.current || !isMountedRef.current) return;
      if (!res.ok || !data.ok) {
        setActionError(data.refusalReason ?? data.error ?? 'Could not log store manager task.');
        return;
      }
      if (data.decision) {
        decisionsRef.current = [...decisionsRef.current, data.decision as ActionDecision];
      }
      if (data.dayState) applyDayState(data.dayState as DayState);
      if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
    });
  };

  const handleStartBuildRequirement = useCallback(
    (candidateId: string) => {
      void runSingleFlight(async (seq) => {
        setActionBusyId(candidateId);
        setBuilderErrorByCandidate((prev) => {
          const next = { ...prev };
          delete next[candidateId];
          return next;
        });
        const res = await fetch('/api/builder/requirement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: dayIndexRef.current,
            candidateId,
          }),
        });
        const data = await res.json();
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        if (!res.ok || !data.ok) {
          setActionError(data.error ?? 'Could not draft tool requirement.');
          return;
        }
        if (data.traceEntry) {
          builderTraceRef.current = [...builderTraceRef.current, data.traceEntry as TraceEntry];
          setCurrentDayState((prev) => ({
            ...prev,
            trace: [...prev.trace, data.traceEntry as TraceEntry],
          }));
        }
        if (data.requirement) {
          setPendingRequirements((prev) => ({
            ...prev,
            [candidateId]: data.requirement as BuilderRequirement,
          }));
        }
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      });
    },
    [commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleConfirmBuildTool = useCallback(
    (candidateId: string) => {
      const req = pendingRequirements[candidateId];
      if (!req) return;
      void runSingleFlight(async (seq) => {
        setActionBusyId(candidateId);
        setBuilderErrorByCandidate((prev) => {
          const next = { ...prev };
          delete next[candidateId];
          return next;
        });
        setBuilderProgressByCandidate((prev) => ({
          ...prev,
          [candidateId]: 'Writing single-file tool with Gemini...',
        }));

        try {
          const buildRes = await fetch('/api/builder/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seed: DEFAULT_SEED,
              dayIndex: dayIndexRef.current,
              requirement: req,
              decisions: decisionsRef.current,
            }),
          });
          const buildData = await buildRes.json();
          if (seq !== requestSeqRef.current || !isMountedRef.current) return;
          if (!buildRes.ok || !buildData.ok) {
            setActionError(buildData.error ?? 'Tool build request failed.');
            return;
          }
          if (buildData.traceEntry) {
            builderTraceRef.current = [
              ...builderTraceRef.current,
              buildData.traceEntry as TraceEntry,
            ];
            setCurrentDayState((prev) => ({
              ...prev,
              trace: [...prev.trace, buildData.traceEntry as TraceEntry],
            }));
          }
          if (buildData.usage) syncUsageMeta(buildData.usage as UsageBannerState);

          const rows = (buildData.rows ?? []) as RefundRecord[];
          const builtDate = String(buildData.date ?? currentDayState.date);
          let finalBuild = buildData.buildResult as {
            html: string;
            model: string;
            mode: 'live' | 'replayed' | 'fallback';
            latencyMs: number;
            inputTokens: number;
            outputTokens: number;
            byteSize: number;
            usedFallbackCopy: boolean;
          };

          setBuilderProgressByCandidate((prev) => ({
            ...prev,
            [candidateId]: 'Running 3 verification checks inside browser sandbox...',
          }));

          let suite = await runSandboxedToolTests(finalBuild.html, rows);
          if (seq !== requestSeqRef.current || !isMountedRef.current) return;

          let repairedOnce = false;
          let repairReason: string | undefined;

          if (!suite.allPassed) {
            repairedOnce = true;
            repairReason = suite.failureReasons.join(' | ');
            setBuilderProgressByCandidate((prev) => ({
              ...prev,
              [candidateId]: 'First check failed. Asking Gemini to repair once...',
            }));

            const repairRes = await fetch('/api/builder/repair', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                seed: DEFAULT_SEED,
                dayIndex: dayIndexRef.current,
                requirement: req,
                brokenHtml: finalBuild.html,
                failureReasons: suite.failureReasons,
                decisions: decisionsRef.current,
              }),
            });
            const repairData = await repairRes.json();
            if (seq !== requestSeqRef.current || !isMountedRef.current) return;

            if (repairRes.ok && repairData.ok && repairData.repairResult) {
              finalBuild = repairData.repairResult;
              if (repairData.traceEntry) {
                builderTraceRef.current = [
                  ...builderTraceRef.current,
                  repairData.traceEntry as TraceEntry,
                ];
                setCurrentDayState((prev) => ({
                  ...prev,
                  trace: [...prev.trace, repairData.traceEntry as TraceEntry],
                }));
              }
              if (repairData.usage) syncUsageMeta(repairData.usage as UsageBannerState);
              suite = await runSandboxedToolTests(finalBuild.html, rows);
              if (seq !== requestSeqRef.current || !isMountedRef.current) return;
            }
          }

          if (!suite.allPassed) {
            const failEntry: TraceEntry = {
              id: `trace:${builtDate}:dev:tool-fail:${Date.now()}`,
              date: builtDate,
              lane: 'developer',
              kind: 'builder',
              headline: 'Tool failed twice — not installed',
              detail: suite.failureReasons.join(' · '),
              outcome: 'let_go',
            };
            builderTraceRef.current = [...builderTraceRef.current, failEntry];
            setCurrentDayState((prev) => ({
              ...prev,
              trace: [...prev.trace, failEntry],
            }));
            setBuilderErrorByCandidate((prev) => ({
              ...prev,
              [candidateId]: {
                message: 'I could not build this to standard. Here is what failed.',
                failures: suite.failureReasons,
              },
            }));
            return;
          }

          setBuilderProgressByCandidate((prev) => ({
            ...prev,
            [candidateId]: 'All 3 checks passed. Installing tool...',
          }));

          const builtTool: BuiltToolRecord = {
            id: 'tool:refund_exceptions_desk:walnut_creek',
            situationId: candidateId,
            title: req.title,
            storeId: 'walnut_creek',
            storeName: 'Walnut Creek',
            installedOn: builtDate,
            html: finalBuild.html,
            model: finalBuild.model,
            mode: finalBuild.mode,
            latencyMs: finalBuild.latencyMs,
            inputTokens: finalBuild.inputTokens,
            outputTokens: finalBuild.outputTokens,
            byteSize: finalBuild.byteSize,
            usedFallbackCopy: finalBuild.usedFallbackCopy,
            repairedOnce,
            repairReason,
            requirement: req,
            testResults: suite.results,
          };

          const installRes = await fetch('/api/builder/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...commonStatePayload(),
              dayIndex: dayIndexRef.current,
              candidateId,
              builtTool,
            }),
          });
          const installData = await installRes.json();
          if (seq !== requestSeqRef.current || !isMountedRef.current) return;

          if (!installRes.ok || !installData.ok) {
            setActionError(installData.error ?? 'Could not install tool.');
            return;
          }

          if (installData.reaction) {
            reactionsRef.current = [...reactionsRef.current, installData.reaction as CardReaction];
          }
          if (Array.isArray(installData.builtTools)) {
            builtToolsRef.current = installData.builtTools as BuiltToolRecord[];
          }
          if (Array.isArray(installData.builderTraceEntries)) {
            builderTraceRef.current = installData.builderTraceEntries as TraceEntry[];
          }
          if (installData.dayState) {
            applyDayState(installData.dayState as DayState);
          }
          if (installData.usage) {
            syncUsageMeta(installData.usage as UsageBannerState);
          }

          setPendingRequirements((prev) => {
            const next = { ...prev };
            delete next[candidateId];
            return next;
          });
        } finally {
          if (isMountedRef.current) {
            setBuilderProgressByCandidate((prev) => {
              const next = { ...prev };
              delete next[candidateId];
              return next;
            });
          }
        }
      });
    },
    [
      applyDayState,
      commonStatePayload,
      currentDayState.date,
      pendingRequirements,
      runSingleFlight,
      syncUsageMeta,
    ],
  );

  const handleCancelRequirement = (candidateId: string) => {
    setPendingRequirements((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    setBuilderErrorByCandidate((prev) => {
      const next = { ...prev };
      delete next[candidateId];
      return next;
    });
    handleReactCard(candidateId, 'not_now');
  };

  const handleToggleRefundReviewed = (refundId: string, reviewed: boolean) => {
    const next = new Set(reviewedRefundIdsRef.current);
    if (reviewed) next.add(refundId);
    else next.delete(refundId);
    reviewedRefundIdsRef.current = [...next];
    void stepToDay(dayIndexRef.current, false);
  };

  const handleApproveRefundSwitch = useCallback(
    async (toolId: string, candidateId: string): Promise<boolean> => {
      let approved = false;
      await runSingleFlight(async (seq) => {
        const res = await fetch('/api/builder/switch-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: dayIndexRef.current,
            toolId,
            candidateId,
          }),
        });
        const data = await res.json();
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        if (!res.ok || !data.ok) {
          setActionError(data.refusalReason ?? data.error ?? 'Rule change refused by Gateway.');
          return;
        }
        approved = true;
        if (data.decision) {
          decisionsRef.current = [...decisionsRef.current, data.decision as ActionDecision];
        }
        if (data.dayState) applyDayState(data.dayState as DayState);
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      });
      return approved;
    },
    [applyDayState, commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleRespondAutonomy = useCallback(
    (offerId: string, reaction: 'enable_autonomy' | 'keep_asking') => {
      void runSingleFlight(async (seq) => {
        const res = await fetch('/api/autonomy/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: dayIndexRef.current,
            offerId,
            reaction,
          }),
        });
        const data = await res.json();
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        if (!res.ok || !data.ok) {
          setActionError(data.error ?? 'Could not save choice.');
          return;
        }
        if (data.autonomyReaction) {
          autonomyReactionsRef.current = [
            ...autonomyReactionsRef.current,
            data.autonomyReaction as AutonomyReaction,
          ];
        }
        if (data.dayState) applyDayState(data.dayState as DayState);
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      });
    },
    [applyDayState, commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleUndoAction = useCallback(
    (decisionId: string) => {
      setIsPlaying(false);
      void runSingleFlight(async (seq) => {
        const res = await fetch('/api/action/undo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...commonStatePayload(),
            dayIndex: dayIndexRef.current,
            decisionId,
          }),
        });
        const data = await res.json();
        if (seq !== requestSeqRef.current || !isMountedRef.current) return;
        if (!res.ok || !data.ok) {
          setActionError(data.error ?? 'Could not undo action.');
          return;
        }
        if (Array.isArray(data.decisions)) {
          decisionsRef.current = data.decisions as ActionDecision[];
        }
        if (data.dayState) applyDayState(data.dayState as DayState);
        if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
      });
    },
    [applyDayState, commonStatePayload, runSingleFlight, syncUsageMeta],
  );

  const handleChangeGeminiMode = async (nextMode: 'replay' | 'live') => {
    setSwitchingMode(true);
    try {
      const res = await fetch('/api/gemini/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await res.json();
      if (data.mode === 'live' || data.mode === 'replay') {
        setGeminiMode(data.mode);
      }
      setCapBanner(data.capBanner ?? null);
      if (data.usage) syncUsageMeta(data.usage as UsageBannerState);
    } finally {
      setSwitchingMode(false);
    }
  };

  // Playback loop: supports Drive it yourself (pauses for cards) and Watch it run (scripted 3s pauses)
  useEffect(() => {
    if (
      !started ||
      !isPlaying ||
      showDevPage ||
      activeInvestigation ||
      requestInFlight ||
      openToolId
    ) {
      return;
    }

    if (dayIndex >= totalDays - 1) {
      setIsPlaying(false);
      if (runMode === 'watch') {
        setDemoHighlight(null);
        setDemoCaption(selectWatchCaptionForDay(currentDayState));
      }
      return;
    }

    const hasWaitingDecision =
      currentDayState.raised.length > 0 ||
      currentDayState.autonomyRecord?.offerCard?.status === 'pending';

    if (runMode === 'drive') {
      if (hasWaitingDecision) {
        setIsPlaying(false);
        return;
      }
      const intervalMs = Math.round(500 / speed);
      const timer = window.setTimeout(() => {
        void stepToDay(dayIndex + 1, true);
      }, intervalMs);
      return () => window.clearTimeout(timer);
    }

    // runMode === 'watch'
    const beat = selectNextWatchDemoBeat({
      dayState: currentDayState,
      pendingRequirements,
      executedBeatKeys: executedBeatKeysRef.current,
    });

    if (beat) {
      setDemoHighlight(beat.highlight);
      setDemoCaption(beat.caption);
      const pauseTimer = window.setTimeout(() => {
        executedBeatKeysRef.current.add(beat.id);
        setDemoHighlight(null);
        if (beat.action.type === 'approve_card') {
          handleApproveCard(beat.action.candidateId);
        } else if (beat.action.type === 'start_build') {
          handleStartBuildRequirement(beat.action.candidateId);
        } else if (beat.action.type === 'confirm_build') {
          handleConfirmBuildTool(beat.action.candidateId);
        } else if (beat.action.type === 'accept_autonomy') {
          handleRespondAutonomy(beat.action.offerId, 'enable_autonomy');
        } else if (beat.action.type === 'open_and_switch') {
          const { toolId, candidateId } = beat.action;
          setOpenToolId(toolId);
          window.setTimeout(async () => {
            if (!isMountedRef.current) return;
            await handleApproveRefundSwitch(toolId, candidateId);
            window.setTimeout(() => {
              if (isMountedRef.current) {
                setOpenToolId(null);
              }
            }, 600);
          }, 900);
        }
      }, 3000);
      return () => window.clearTimeout(pauseTimer);
    }

    setDemoHighlight(null);
    setDemoCaption(selectWatchCaptionForDay(currentDayState));
    const stepMs = Math.round(750 / speed); // at 2x speed -> 375 ms/day (~80-95s total including 3s pauses)
    const timer = window.setTimeout(() => {
      void stepToDay(dayIndex + 1, true);
    }, stepMs);
    return () => window.clearTimeout(timer);
  }, [
    started,
    isPlaying,
    speed,
    dayIndex,
    totalDays,
    showDevPage,
    activeInvestigation,
    requestInFlight,
    openToolId,
    runMode,
    currentDayState,
    pendingRequirements,
    stepToDay,
    handleApproveCard,
    handleStartBuildRequirement,
    handleConfirmBuildTool,
    handleRespondAutonomy,
    handleApproveRefundSwitch,
  ]);

  const navigateFromDev = () => {
    setShowDevPage(false);
    window.history.pushState({}, '', '/');
  };

  if (showDevPage) {
    return <DevDiagnosticsPage report={diagnostics} onBack={navigateFromDev} />;
  }

  if (!started) {
    return (
      <>
        <DayOneScreen
          brief={dayOneBrief}
          loadingNarrative={loadingBrief}
          onStartWatch={handleStartWatch}
          onStartDrive={handleStartDrive}
          onInspectFact={setInspectedFact}
          onOpenRealityNote={() => setShowRealityNote(true)}
        />
        <FactPopover fact={inspectedFact} onClose={() => setInspectedFact(null)} />
        <RealityNoteModal open={showRealityNote} onClose={() => setShowRealityNote(false)} />
      </>
    );
  }

  const capReachedBanner =
    capBanner || (telemetry && (telemetry.decisionCapReached || telemetry.otherCapReached));
  const openTool = (currentDayState.builtTools ?? []).find((t) => t.id === openToolId) ?? null;
  const calmStatusLine = computeCalmStatusLine({
    dayState: currentDayState,
    activeInvestigation,
    builderProgressByCandidate,
  });

  return (
    <div
      className="min-h-screen bg-[#FAF8F5] text-[#171717] overflow-x-hidden"
      data-day={currentDayState.date}
    >
      {capReachedBanner && (
        <div
          role="status"
          className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 py-2 text-xs text-center text-[#92400E] font-medium"
        >
          {typeof capReachedBanner === 'string'
            ? capReachedBanner
            : 'Daily Gemini limit reached — using code backup rules for unrecorded calls this session.'}
        </div>
      )}

      <div className="max-w-[1360px] mx-auto px-4 py-5 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[460px_minmax(0,1fr)] gap-8 items-start">
        {/* Left column: calm, phone-shaped owner view */}
        <main className="w-full max-w-[460px] mx-auto lg:mx-0">
          <ClockHeader
            currentDate={currentDayState.date}
            dayIndex={dayIndex}
            totalDays={totalDays}
            isPlaying={isPlaying}
            isBusy={requestInFlight}
            speed={speed}
            hasNextEvent={dayIndex < totalDays - 1}
            isWatchDemo={runMode === 'watch'}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onChangeSpeed={setSpeed}
            onSkipToNextEvent={handleSkipToNextEvent}
            onReset={() => void handleReset(true)}
            onOpenTraceDrawer={() => setTraceDrawerOpen(true)}
          />

          {/* Part B #3: Single calm status line at top of left column (+ Part C 1-sentence demo caption) */}
          <div className="mt-3 px-3 py-2 rounded-lg bg-white border border-[#E6E1D8] space-y-1">
            <p data-testid="calm-status-line" className="text-xs font-medium text-[#312E81]">
              {calmStatusLine}
            </p>
            {demoCaption && (
              <p data-testid="demo-caption" className="text-xs text-[#57534E] leading-snug">
                {demoCaption.replace(/\{\{[^}]*\}\}/g, '').replace(/\{\{|\}\}/g, '')}
              </p>
            )}
          </div>

          <SalesChart
            dayState={currentDayState}
            totalDays={totalDays}
            onInspectFact={setInspectedFact}
          />

          {currentDayState.endStatement && (
            <EndStatement
              statement={currentDayState.endStatement}
              onInspectFact={setInspectedFact}
            />
          )}

          {actionError && (
            <div
              role="alert"
              className="mt-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
            >
              {actionError}
            </div>
          )}

          <OwnerFeed
            dayState={currentDayState}
            activeInvestigation={activeInvestigation}
            actionBusyId={actionBusyId}
            isRequestInFlight={requestInFlight}
            pendingRequirements={pendingRequirements}
            builderProgressByCandidate={builderProgressByCandidate}
            builderErrorByCandidate={builderErrorByCandidate}
            demoHighlight={demoHighlight}
            onInspectFact={setInspectedFact}
            onApproveCard={(id) => {
              setIsPlaying(false);
              handleApproveCard(id);
            }}
            onNotNowCard={(id) => handleReactCard(id, 'not_now')}
            onDismissCard={(id, reason) => handleReactCard(id, 'dismiss', reason)}
            onLookAgainCard={handleLookAgainCard}
            onStartBuildRequirement={(id) => {
              setIsPlaying(false);
              handleStartBuildRequirement(id);
            }}
            onConfirmBuildTool={(id) => {
              setIsPlaying(false);
              handleConfirmBuildTool(id);
            }}
            onCancelRequirement={handleCancelRequirement}
            onAskStoreManager={handleAskStoreManager}
            onOpenBuiltTool={(toolId) => setOpenToolId(toolId)}
            onRespondAutonomy={(offerId, reaction) => {
              setIsPlaying(false);
              handleRespondAutonomy(offerId, reaction);
            }}
            onUndoAction={handleUndoAction}
          />

          <footer className="mt-8 pt-4 border-t border-[#E6E1D8] flex flex-wrap items-center justify-between gap-2 text-xs text-[#78716C]">
            <span>Simulated business. Built with Gemini in Google AI Studio.</span>
            <button
              type="button"
              onClick={() => setShowRealityNote(true)}
              className="text-[#57534E] hover:text-[#312E81] underline underline-offset-4 cursor-pointer"
            >
              What is real here?
            </button>
          </footer>
        </main>

        {/* Right column: behind the screen */}
        <TracePanel
          trace={currentDayState.trace}
          telemetry={telemetry}
          geminiMode={geminiMode}
          capBanner={capBanner}
          switchingMode={switchingMode}
          onChangeGeminiMode={handleChangeGeminiMode}
          onInspectFact={setInspectedFact}
        />
      </div>

      {/* Mobile slide-over drawer for Behind the screen at 390px */}
      {traceDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Behind the screen drawer"
          className="lg:hidden fixed inset-0 z-50 bg-black/35 flex justify-end"
        >
          <div className="w-full max-w-[390px] bg-[#FAF8F5] h-full overflow-y-auto p-4 shadow-xl">
            <TracePanel
              trace={currentDayState.trace}
              telemetry={telemetry}
              geminiMode={geminiMode}
              capBanner={capBanner}
              switchingMode={switchingMode}
              inDrawer
              onChangeGeminiMode={handleChangeGeminiMode}
              onCloseDrawer={() => setTraceDrawerOpen(false)}
              onInspectFact={setInspectedFact}
            />
          </div>
        </div>
      )}

      {openTool && (
        <BuiltToolPanel
          tool={openTool}
          rows={currentDayState.refundRows ?? []}
          switchEnabled={Boolean(currentDayState.refundSwitchEnabled)}
          reviewedIds={currentDayState.reviewedRefundIds ?? []}
          isBusy={requestInFlight}
          onClose={() => setOpenToolId(null)}
          onToggleReviewed={handleToggleRefundReviewed}
          onApproveRefundSwitch={(toolId, candId) => {
            setIsPlaying(false);
            return handleApproveRefundSwitch(toolId, candId);
          }}
        />
      )}

      <FactPopover fact={inspectedFact} onClose={() => setInspectedFact(null)} />
      <RealityNoteModal open={showRealityNote} onClose={() => setShowRealityNote(false)} />
    </div>
  );
}
