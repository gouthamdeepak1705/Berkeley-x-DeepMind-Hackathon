import { useEffect, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { TourStopSpec } from '../../engine/tourDriver';

interface TourOverlayProps {
  stop: TourStopSpec;
  isBusy: boolean;
  onNext: () => void;
  onExit: () => void;
}

export function TourOverlay({ stop, isBusy, onNext, onExit }: TourOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const isFinal = stop.stepNumber >= stop.totalSteps;

  useEffect(() => {
    setExpanded(false);
  }, [stop.stepNumber]);

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 sm:px-6 sm:pb-4 pointer-events-none">
      <aside
        aria-label="Guided tour"
        data-testid="tour-overlay"
        className="max-w-[1220px] mx-auto pointer-events-auto bg-[#25372C] text-[#FFF8E8] rounded-2xl p-3.5 sm:px-5 sm:py-4 shadow-xl border border-[#3B5244] space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[#CFE0D4]">
            <span className="font-semibold text-white">
              Step {stop.stepNumber} of {stop.totalSteps}
            </span>
            <span>·</span>
            <span>{formatShortDate(stop.targetDate)}</span>
            {stop.highlight ? (
              <span className="hidden sm:inline text-[#CFE0D4]">
                · Next up: {stop.highlight.label}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1 text-xs text-[#CFE0D4] hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Exit tour</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5 sm:gap-5">
          <div className="space-y-1 min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-semibold text-white leading-snug">
              {stop.title}
            </h2>
            <p
              className={`text-xs sm:text-sm text-[#E8F1EC] leading-relaxed ${
                expanded ? '' : 'line-clamp-2 sm:line-clamp-none'
              }`}
            >
              {stop.explanation}
            </p>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="sm:hidden text-xs font-medium text-[#CFE0D4] underline cursor-pointer"
            >
              {expanded ? 'less' : 'more'}
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
            <span className="sm:hidden text-[11px] text-[#CFE0D4]">
              {stop.highlight
                ? `Next up: ${stop.highlight.label}`
                : isFinal
                  ? 'Tour complete.'
                  : 'Read-only stop.'}
            </span>

            <button
              type="button"
              data-testid="tour-next-btn"
              disabled={isBusy}
              onClick={onNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFF8E8] hover:bg-white disabled:opacity-55 text-[#25372C] text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <span>{isBusy ? 'Working...' : isFinal ? 'Finish tour' : 'Next'}</span>
              {!isFinal && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
