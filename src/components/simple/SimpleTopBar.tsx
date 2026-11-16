import { FastForward, Info, Pause, Play, RotateCcw } from 'lucide-react';
import { formatDisplayDate } from '../../engine/calendar';
import { PlaybackSpeed } from '../ClockHeader';

interface SimpleTopBarProps {
  currentDate: string;
  dayIndex: number;
  totalDays: number;
  isPlaying: boolean;
  isBusy?: boolean;
  speed: PlaybackSpeed;
  hasNextEvent: boolean;
  runMode: 'drive' | 'watch' | 'tour';
  showTechnicalDetail: boolean;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onSkipToNextEvent: () => void;
  onReset: () => void;
  onOpenAbout: () => void;
  onToggleTechnicalDetail: (show: boolean) => void;
}

export function SimpleTopBar({
  currentDate,
  dayIndex,
  totalDays,
  isPlaying,
  isBusy = false,
  speed,
  hasNextEvent,
  runMode,
  showTechnicalDetail,
  onTogglePlay,
  onChangeSpeed,
  onSkipToNextEvent,
  onReset,
  onOpenAbout,
  onToggleTechnicalDetail,
}: SimpleTopBarProps) {
  const isAtEnd = dayIndex >= totalDays - 1;
  const pct = Math.min(100, Math.max(0, Math.round(((dayIndex + 1) / totalDays) * 100)));

  return (
    <header className="bg-[#FFF8E8] border-b border-[#E5DCC7]">
      <div className="max-w-[1220px] mx-auto px-4 sm:px-6 py-3 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold tracking-tight text-[#25372C]">
              Opscien Instinct
            </span>
            <span className="text-sm text-[#56695D]">Linden &amp; Rye</span>
            {runMode === 'watch' && (
              <span className="px-2.5 py-0.5 text-xs font-medium rounded-md bg-[#E8F1EC] text-[#25372C] border border-[#C6DBC9]">
                Watch it run: choosing for you
              </span>
            )}
            {runMode === 'tour' && (
              <span className="px-2.5 py-0.5 text-xs font-medium rounded-md bg-[#E8F1EC] text-[#25372C] border border-[#C6DBC9]">
                Guided tour
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={onOpenAbout}
              className="inline-flex items-center gap-1 text-[#43564A] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              <span>About this business</span>
            </button>

            <label className="inline-flex items-center gap-2 cursor-pointer text-[#43564A] hover:text-[#25372C]">
              <input
                type="checkbox"
                checked={showTechnicalDetail}
                onChange={(e) => onToggleTechnicalDetail(e.target.checked)}
                className="w-4 h-4 accent-[#25372C] rounded cursor-pointer"
              />
              <span className="font-medium">Show technical detail</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#25372C]">
              {formatDisplayDate(currentDate)}
            </h1>
            <span className="text-xs text-[#56695D]">
              Day {dayIndex + 1} of {totalDays}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!isPlaying && (isAtEnd || isBusy)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#25372C] text-white hover:bg-[#1C2A21] disabled:opacity-45 transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause' : isAtEnd ? 'Finished' : 'Play'}</span>
            </button>

            <div
              role="group"
              aria-label="Speed"
              className="inline-flex items-center p-0.5 bg-[#F2E9D5] rounded-lg border border-[#E0D5BC]"
            >
              {([1, 2, 4] as PlaybackSpeed[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChangeSpeed(s)}
                  aria-pressed={speed === s}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    speed === s
                      ? 'bg-white text-[#25372C] shadow-2xs'
                      : 'text-[#56695D] hover:text-[#25372C]'
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
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8CEB8] bg-white text-[#25372C] hover:bg-[#F5EEDD] disabled:opacity-45 transition-colors cursor-pointer"
            >
              <FastForward className="w-3.5 h-3.5 text-[#25372C]" />
              <span>Skip to next event</span>
            </button>

            <button
              type="button"
              onClick={onReset}
              aria-label="Restart"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#43564A] hover:text-[#25372C] rounded-lg border border-[#D8CEB8] bg-white hover:bg-[#F5EEDD] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restart</span>
            </button>
          </div>
        </div>
      </div>

      {/* Thin 106-day progress bar */}
      <div className="h-1 w-full bg-[#EDE3CC]">
        <div
          className="h-full bg-[#25372C] transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </header>
  );
}
