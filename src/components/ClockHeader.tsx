import { FastForward, PanelRightOpen, Pause, Play, RotateCcw } from 'lucide-react';
import { formatDisplayDate } from '../engine/calendar';

export type PlaybackSpeed = 1 | 2 | 4;

interface ClockHeaderProps {
  currentDate: string;
  dayIndex: number;
  totalDays: number;
  isPlaying: boolean;
  isBusy?: boolean;
  speed: PlaybackSpeed;
  hasNextEvent: boolean;
  isWatchDemo?: boolean;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onSkipToNextEvent: () => void;
  onReset: () => void;
  onOpenTraceDrawer?: () => void;
}

export function ClockHeader({
  currentDate,
  dayIndex,
  totalDays,
  isPlaying,
  isBusy = false,
  speed,
  hasNextEvent,
  isWatchDemo = false,
  onTogglePlay,
  onChangeSpeed,
  onSkipToNextEvent,
  onReset,
  onOpenTraceDrawer,
}: ClockHeaderProps) {
  const isAtEnd = dayIndex >= totalDays - 1;

  return (
    <header className="pb-4 border-b border-[#E6E1D8]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-[#78716C]">Linden &amp; Rye</p>
            {isWatchDemo && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[#EEF2FF] text-[#312E81] border border-[#C7D2FE]">
                Watching scripted run
              </span>
            )}
          </div>
          <h1 className="mt-0.5 font-display text-2xl font-semibold tracking-tight text-[#171717] tabular-nums">
            {formatDisplayDate(currentDate)}
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono tabular-nums text-[#78716C]">
            Day {dayIndex + 1} / {totalDays}
          </span>
          <button
            type="button"
            onClick={onReset}
            aria-label="Restart run"
            title="Restart from Day 1"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#57534E] hover:text-[#171717] rounded-lg border border-[#E6E1D8] bg-white hover:bg-[#F3F0EA] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restart</span>
          </button>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!isPlaying && (isAtEnd || isBusy)}
          aria-label={isPlaying ? 'Pause simulation clock' : 'Play simulation clock'}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#312E81] text-white hover:bg-[#26236B] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          <span>{isPlaying ? 'Pause' : isAtEnd ? 'Finished' : 'Play'}</span>
        </button>

        <div
          role="group"
          aria-label="Clock playback speed"
          className="inline-flex items-center p-0.5 bg-[#F3F0EA] rounded-lg border border-[#E6E1D8] shrink-0"
        >
          {([1, 2, 4] as PlaybackSpeed[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChangeSpeed(s)}
              aria-pressed={speed === s}
              className={`px-2 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                speed === s
                  ? 'bg-white text-[#171717] shadow-xs'
                  : 'text-[#57534E] hover:text-[#171717]'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onSkipToNextEvent}
          disabled={!hasNextEvent || isAtEnd || isBusy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#E6E1D8] bg-white text-[#171717] hover:bg-[#F3F0EA] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FastForward className="w-3.5 h-3.5 text-[#312E81]" />
          <span>Skip to next event</span>
        </button>

        {onOpenTraceDrawer && (
          <button
            type="button"
            onClick={onOpenTraceDrawer}
            className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#E6E1D8] bg-white text-[#312E81] hover:bg-[#EEF2FF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            <span>Behind the screen</span>
          </button>
        )}
      </div>
    </header>
  );
}
