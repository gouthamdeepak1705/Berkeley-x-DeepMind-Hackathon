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
  const isFinal = stop.stepNumber >= stop.totalSteps;

  return (
    <aside
      aria-label="Guided tour"
      data-testid="tour-overlay"
      className="bg-[#25372C] text-[#FFF8E8] rounded-2xl p-4 sm:p-5 shadow-md space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-[#CFE0D4]">
          <span className="font-semibold text-white">
            Step {stop.stepNumber} of {stop.totalSteps}
          </span>
          <span>·</span>
          <span>{formatShortDate(stop.targetDate)}</span>
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

      <h2 className="text-base sm:text-lg font-semibold text-white leading-snug">
        {stop.title}
      </h2>
      <p className="text-sm text-[#E8F1EC] leading-relaxed">{stop.explanation}</p>

      <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
        {stop.highlight ? (
          <span className="text-xs text-[#CFE0D4]">
            Next up: {stop.highlight.label}
          </span>
        ) : (
          <span className="text-xs text-[#CFE0D4]">
            {isFinal ? 'Tour complete.' : 'Nothing to approve on this stop.'}
          </span>
        )}

        <button
          type="button"
          data-testid="tour-next-btn"
          disabled={isBusy}
          onClick={onNext}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FFF8E8] hover:bg-white disabled:opacity-55 text-[#25372C] text-xs font-semibold rounded-lg transition-colors cursor-pointer"
        >
          <span>{isBusy ? 'Working...' : isFinal ? 'Finish tour' : 'Next'}</span>
          {!isFinal && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </aside>
  );
}
