import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClockHeader, PlaybackSpeed } from './components/ClockHeader';
import { DayOneScreen } from './components/DayOneScreen';
import { DevDiagnosticsPage } from './components/DevDiagnosticsPage';
import { FactPopover } from './components/FactPopover';
import { ActiveInvestigationBanner, OwnerFeed } from './components/OwnerFeed';
import { RealityNoteModal } from './components/RealityNoteModal';
import { SalesChart } from './components/SalesChart';
import { GeminiTelemetrySnapshot, TracePanel } from './components/TracePanel';
import { DEFAULT_SEED } from './engine/prng';
import { buildLiveTimeline, runFullDiagnostics } from './engine/runner';
import {
  ActionDecision,
  CardReaction,
  DayOneBrief,
  DayState,
  DismissReason,
  Fact,
  InvestigationResult,
  RaisedItem,
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
  // Deterministic baseline used for instant Day 0 / Day One render & diagnostics
  const baseTimeline = useMemo(() => buildLiveTimeline(DEFAULT_SEED), []);
  const diagnostics = useMemo(() => runFullDiagnostics(DEFAULT_SEED), []);

  const [showDevPage, setShowDevPage] = useState<boolean>(isDevRoute);
  const [started, setStarted] = useState<boolean>(isAutostart);
  const [dayOneBrief, setDayOneBrief] = useState<DayOneBrief>(baseTimeline.sim.dayOneBrief);
  const [loadingBrief, setLoadingBrief] = useState<boolean>(false);

  const [dayIndex, setDayIndex] = useState<number>(0);
  const [currentDayState, setCurrentDayState] = useState<DayState>(baseTimeline.dayStates[0]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [stepping, setStepping] = useState<boolean>(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeInvestigation, setActiveInvestigation] =
    useState<ActiveInvestigationBanner | null>(null);
  const [telemetry, setTelemetry] = useState<UsageBannerState | null>(null);

  const [inspectedFact, setInspectedFact] = useState<Fact | null>(null);
  const [showRealityNote, setShowRealityNote] = useState<boolean>(false);

  const decisionsRef = useRef<ActionDecision[]>([]);
  const reactionsRef = useRef<CardReaction[]>([]);
  const completedInvRef = useRef<Record<string, InvestigationResult>>({});
  const resumeAfterInvestigationRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const inFlightRef = useRef<boolean>(false);

  const totalDays = baseTimeline.dayStates.length;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load Gemini-authored Day One brief from server
  useEffect(() => {
    let cancelled = false;
    setLoadingBrief(true);
    fetch('/api/day-one')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.brief) setDayOneBrief(data.brief as DayOneBrief);
        if (data.usage) setTelemetry(data.usage as UsageBannerState);
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
  }, []);

  // Sync browser back/forward navigation for /dev
  useEffect(() => {
    const onPopState = () => {
      setShowDevPage(isDevRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Escape closes any open fact popover or reality note modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspectedFact(null);
        setShowRealityNote(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const streamInvestigation = useCallback(
    async (targetDayIdx: number, pending: RaisedItem, wasPlaying: boolean) => {
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
            seed: DEFAULT_SEED,
            dayIndex: targetDayIdx,
            decisions: decisionsRef.current,
            reactions: reactionsRef.current,
            controlStores: [],
            situationId: pending.candidateId,
            completedInvestigations: completedInvRef.current,
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

            if (eventType === 'step' && isMountedRef.current) {
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
            } else if (eventType === 'done' && isMountedRef.current) {
              if (parsed.investigation) {
                completedInvRef.current = {
                  ...completedInvRef.current,
                  [pending.candidateId]: parsed.investigation as InvestigationResult,
                };
              }
              if (parsed.dayState) {
                setCurrentDayState(parsed.dayState as DayState);
              }
              if (parsed.usage) {
                setTelemetry(parsed.usage as UsageBannerState);
              }
            }
          }
        }
      } catch {
        // Fallback: re-fetch step with investigateTargetDay=true
        const fallbackRes = await fetch('/api/timeline/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seed: DEFAULT_SEED,
            dayIndex: targetDayIdx,
            decisions: decisionsRef.current,
            reactions: reactionsRef.current,
            controlStores: [],
            investigateTargetDay: true,
            completedInvestigations: completedInvRef.current,
          }),
        });
        if (fallbackRes.ok && isMountedRef.current) {
          const data = await fallbackRes.json();
          if (data.dayState) {
            const ds = data.dayState as DayState;
            setCurrentDayState(ds);
            for (const r of ds.raised) {
              if (r.investigation) {
                completedInvRef.current[r.candidateId] = r.investigation;
              }
            }
          }
          if (data.usage) setTelemetry(data.usage as UsageBannerState);
        }
      } finally {
        if (isMountedRef.current) {
          setActiveInvestigation(null);
          if (resumeAfterInvestigationRef.current && targetDayIdx < totalDays - 1) {
            setIsPlaying(true);
          }
          resumeAfterInvestigationRef.current = false;
        }
      }
    },
    [totalDays],
  );

  const stepToDay = useCallback(
    async (targetIdx: number, playModeActive: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setStepping(true);
      setActionError(null);
      try {
        const res = await fetch('/api/timeline/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seed: DEFAULT_SEED,
            dayIndex: targetIdx,
            decisions: decisionsRef.current,
            reactions: reactionsRef.current,
            controlStores: [],
            investigateTargetDay: false,
            completedInvestigations: completedInvRef.current,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMountedRef.current) return;

        if (data.dayState) {
          const ds = data.dayState as DayState;
          setDayIndex(targetIdx);
          setCurrentDayState(ds);
          for (const r of ds.raised) {
            if (r.investigation) {
              completedInvRef.current[r.candidateId] = r.investigation;
            }
          }
        }
        if (data.usage) {
          setTelemetry(data.usage as UsageBannerState);
        }

        if (data.pendingSituation) {
          await streamInvestigation(
            targetIdx,
            data.pendingSituation as RaisedItem,
            playModeActive,
          );
        }
      } finally {
        inFlightRef.current = false;
        if (isMountedRef.current) {
          setStepping(false);
        }
      }
    },
    [streamInvestigation],
  );

  // Sync Day 0 once simulation starts
  useEffect(() => {
    if (!started || showDevPage) return;
    if (dayIndex === 0 && !currentDayState.watcherEvalLog) {
      void stepToDay(0, false);
    }
  }, [started, showDevPage, dayIndex, currentDayState.watcherEvalLog, stepToDay]);

  // Sequential playback loop so slow Gemini/SSE steps never overlap
  useEffect(() => {
    if (!started || !isPlaying || showDevPage || activeInvestigation || stepping) return;
    if (dayIndex >= totalDays - 1) {
      setIsPlaying(false);
      return;
    }

    const intervalMs = Math.round(500 / speed);
    const timer = window.setTimeout(() => {
      void stepToDay(dayIndex + 1, true);
    }, intervalMs);

    return () => window.clearTimeout(timer);
  }, [
    started,
    isPlaying,
    speed,
    dayIndex,
    totalDays,
    showDevPage,
    activeInvestigation,
    stepping,
    stepToDay,
  ]);

  const handleSkipToNextEvent = async () => {
    setIsPlaying(false);
    if (activeInvestigation || stepping || dayIndex >= totalDays - 1) return;
    setStepping(true);
    try {
      const res = await fetch('/api/timeline/next-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: DEFAULT_SEED,
          fromDayIndex: dayIndex,
          decisions: decisionsRef.current,
          reactions: reactionsRef.current,
          controlStores: [],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { nextDayIndex: number | null };
        if (typeof data.nextDayIndex === 'number') {
          setStepping(false);
          await stepToDay(data.nextDayIndex, false);
          return;
        }
      }
    } finally {
      setStepping(false);
    }
  };

  const handleReset = async () => {
    setIsPlaying(false);
    setActiveInvestigation(null);
    setActionError(null);
    resumeAfterInvestigationRef.current = false;
    decisionsRef.current = [];
    reactionsRef.current = [];
    completedInvRef.current = {};
    setDayIndex(0);
    setCurrentDayState(baseTimeline.dayStates[0]);
    try {
      await fetch('/api/timeline/reset-log', { method: 'POST' });
    } catch {
      // ignore
    }
    void stepToDay(0, false);
  };

  const handleApproveCard = async (candidateId: string) => {
    if (actionBusyId) return;
    setIsPlaying(false);
    setActionBusyId(candidateId);
    setActionError(null);
    try {
      const res = await fetch('/api/action/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: DEFAULT_SEED,
          dayIndex,
          candidateId,
          decisions: decisionsRef.current,
          reactions: reactionsRef.current,
          completedInvestigations: completedInvRef.current,
        }),
      });
      const data = await res.json();
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
      if (data.dayState) setCurrentDayState(data.dayState as DayState);
      if (data.usage) setTelemetry(data.usage as UsageBannerState);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleReactCard = async (
    candidateId: string,
    reaction: 'not_now' | 'dismiss',
    reason?: DismissReason,
  ) => {
    if (actionBusyId) return;
    setIsPlaying(false);
    setActionBusyId(candidateId);
    setActionError(null);
    try {
      const res = await fetch('/api/action/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: DEFAULT_SEED,
          dayIndex,
          candidateId,
          reaction,
          reason,
          decisions: decisionsRef.current,
          reactions: reactionsRef.current,
          completedInvestigations: completedInvRef.current,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        if (data.reaction) {
          reactionsRef.current = [...reactionsRef.current, data.reaction as CardReaction];
        }
        if (data.dayState) setCurrentDayState(data.dayState as DayState);
        if (data.usage) setTelemetry(data.usage as UsageBannerState);
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleLookAgainCard = async (candidateId: string) => {
    if (actionBusyId) return;
    setIsPlaying(false);
    setActionBusyId(candidateId);
    setActionError(null);
    try {
      const res = await fetch('/api/action/look-again', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: DEFAULT_SEED,
          dayIndex,
          candidateId,
          decisions: decisionsRef.current,
          reactions: reactionsRef.current,
          completedInvestigations: completedInvRef.current,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        if (data.investigation) {
          completedInvRef.current = {
            ...completedInvRef.current,
            [candidateId]: data.investigation as InvestigationResult,
          };
        }
        if (data.dayState) setCurrentDayState(data.dayState as DayState);
        if (data.usage) setTelemetry(data.usage as UsageBannerState);
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const navigateToDev = () => {
    setIsPlaying(false);
    setShowDevPage(true);
    window.history.pushState({}, '', '/dev');
  };

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
          onStart={() => setStarted(true)}
          onInspectFact={setInspectedFact}
          onOpenRealityNote={() => setShowRealityNote(true)}
        />
        <FactPopover fact={inspectedFact} onClose={() => setInspectedFact(null)} />
        <RealityNoteModal open={showRealityNote} onClose={() => setShowRealityNote(false)} />
      </>
    );
  }

  const capReachedBanner =
    telemetry && (telemetry.decisionCapReached || telemetry.otherCapReached);

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#171717]" data-day={currentDayState.date}>
      {capReachedBanner && (
        <div
          role="status"
          className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 py-2 text-xs text-center text-[#92400E] font-medium"
        >
          Daily Gemini call cap reached — continuing on fallback rules for remaining uncached calls.
        </div>
      )}

      <div className="max-w-[1360px] mx-auto px-4 py-6 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[460px_minmax(0,1fr)] gap-8 items-start">
        {/* Left column: calm, phone-shaped owner view */}
        <main className="w-full max-w-[460px] mx-auto lg:mx-0">
          <ClockHeader
            currentDate={currentDayState.date}
            dayIndex={dayIndex}
            totalDays={totalDays}
            isPlaying={isPlaying}
            speed={speed}
            hasNextEvent={dayIndex < totalDays - 1}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onChangeSpeed={setSpeed}
            onSkipToNextEvent={handleSkipToNextEvent}
            onReset={handleReset}
          />

          <SalesChart
            dayState={currentDayState}
            totalDays={totalDays}
            onInspectFact={setInspectedFact}
          />

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
            onInspectFact={setInspectedFact}
            onApproveCard={handleApproveCard}
            onNotNowCard={(id) => handleReactCard(id, 'not_now')}
            onDismissCard={(id, reason) => handleReactCard(id, 'dismiss', reason)}
            onLookAgainCard={handleLookAgainCard}
          />

          <footer className="mt-8 pt-4 border-t border-[#E6E1D8] flex items-center justify-between text-xs text-[#78716C]">
            <span>OpsCien Instinct</span>
            <button
              type="button"
              onClick={() => setShowRealityNote(true)}
              className="text-[#57534E] hover:text-[#312E81] underline underline-offset-4 cursor-pointer"
            >
              What is real here?
            </button>
          </footer>
        </main>

        {/* Right column: behind the screen (hidden on phone width) */}
        <TracePanel
          trace={currentDayState.trace}
          telemetry={telemetry}
          onInspectFact={setInspectedFact}
          onOpenDevPage={navigateToDev}
        />
      </div>

      <FactPopover fact={inspectedFact} onClose={() => setInspectedFact(null)} />
      <RealityNoteModal open={showRealityNote} onClose={() => setShowRealityNote(false)} />
    </div>
  );
}
