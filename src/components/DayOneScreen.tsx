import { Play, SlidersHorizontal } from 'lucide-react';
import { DayOneBrief, Fact, TextSegment } from '../types/domain';
import { FactValue } from './FactValue';

interface DayOneScreenProps {
  brief: DayOneBrief;
  loadingNarrative?: boolean;
  onStartWatch: () => void;
  onStartDrive: () => void;
  onInspectFact: (fact: Fact) => void;
  onOpenRealityNote: () => void;
}

function renderSegments(segments: TextSegment[], onInspectFact: (fact: Fact) => void) {
  return segments.map((seg, idx) =>
    seg.type === 'text' ? (
      <span key={`t-${idx}`}>{seg.text}</span>
    ) : (
      <FactValue key={`${seg.fact.id}-${idx}`} fact={seg.fact} onInspect={onInspectFact} />
    ),
  );
}

function formatSecondsFromMs(ms: number): string {
  return `${Math.max(0.1, ms / 1000).toFixed(1)} seconds`;
}

export function DayOneScreen({
  brief,
  loadingNarrative,
  onStartWatch,
  onStartDrive,
  onInspectFact,
  onOpenRealityNote,
}: DayOneScreenProps) {
  const f = brief.summaryFacts;
  const paragraphs = brief.narrativeSegments;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#171717] flex flex-col justify-center px-4 py-4 sm:px-8">
      <main className="max-w-2xl w-full mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#E6E1D8] pb-3">
          <div>
            <p className="text-sm font-medium text-[#78716C]">OpsCien Instinct</p>
            <h1 className="mt-0.5 font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#171717] text-balance">
              Day one: {brief.businessName}
            </h1>
          </div>
          <button
            type="button"
            onClick={onOpenRealityNote}
            className="text-sm text-[#57534E] hover:text-[#312E81] underline underline-offset-4 shrink-0 cursor-pointer"
          >
            What is real here?
          </button>
        </div>

        <section className="mt-3.5" aria-labelledby="business-summary-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="business-summary-heading" className="text-sm font-semibold text-[#78716C]">
              What the numbers show so far
            </h2>
            {loadingNarrative ? (
              <span className="text-[11px] font-mono text-[#78716C]">Reading the history...</span>
            ) : brief.narrativeMeta ? (
              <span className="text-[11px] font-mono text-[#78716C]">
                {brief.narrativeMeta.model} ·{' '}
                {brief.narrativeMeta.latencyMs > 0
                  ? `${formatSecondsFromMs(brief.narrativeMeta.latencyMs)}${brief.narrativeMeta.mode === 'replayed' ? ' (replayed)' : ''} · `
                  : ''}
                {brief.narrativeMeta.mode}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 bg-white border border-[#E6E1D8] rounded-xl p-4 space-y-2 text-[14.5px] leading-relaxed text-[#171717]">
            {paragraphs && paragraphs.length > 0 ? (
              paragraphs.map((segs, idx) => (
                <p key={`p-${idx}`}>{renderSegments(segs, onInspectFact)}</p>
              ))
            ) : (
              <>
                <p>
                  {brief.businessName} is a California womenswear chain with{' '}
                  <FactValue fact={f.storeCount} onInspect={onInspectFact} /> stores:{' '}
                  <FactValue fact={f.establishedCount} onInspect={onInspectFact} /> established
                  locations open more than 18 months and{' '}
                  <FactValue fact={f.newStoreCount} onInspect={onInspectFact} /> newer openings
                  (Burlingame in June and Napa opening 22 August).
                </p>
                <p>
                  Trading peaks sharply at the weekend—Saturdays run{' '}
                  <FactValue fact={f.strongestWeekdayShare} onInspect={onInspectFact} /> above the
                  weekly daily average—and follows clear seasonal swings, with December lifting{' '}
                  <FactValue fact={f.decemberIndex} onInspect={onInspectFact} /> while August through
                  early September softens{' '}
                  <FactValue fact={f.lullIndex} onInspect={onInspectFact} />.
                </p>
                <p>
                  Sales split across three product groups: Best-sellers at{' '}
                  <FactValue fact={f.bestSellersShare} onInspect={onInspectFact} />, Knitwear at{' '}
                  <FactValue fact={f.knitwearShare} onInspect={onInspectFact} />, and Everything else
                  making up the remaining half.
                </p>
              </>
            )}
            <p className="text-xs text-[#78716C]">
              Tap any figure to see how it was computed.
            </p>
          </div>
        </section>

        <section className="mt-3.5" aria-labelledby="confirmed-rules-heading">
          <h2 id="confirmed-rules-heading" className="text-sm font-semibold text-[#78716C]">
            Confirmed starting rules
          </h2>
          <div className="mt-1.5 bg-white border border-[#E6E1D8] rounded-xl divide-y divide-[#E6E1D8]">
            {brief.confirmedRules.map((rule, index) => (
              <div key={rule.id} className="px-4 py-2 flex items-baseline gap-3.5">
                <span className="font-mono tabular-nums text-xs text-[#78716C] shrink-0">
                  0{index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#171717]">{rule.title}</p>
                  <p className="text-[13px] text-[#57534E] leading-snug">{rule.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-5 pt-4 border-t border-[#E6E1D8] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs sm:text-sm text-[#57534E]">
            Live window runs 1 August 2026 to 14 November 2026.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onStartWatch}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#312E81] hover:bg-[#26236B] text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#312E81]"
            >
              <Play className="w-4 h-4" />
              <span>Watch it run</span>
            </button>
            <button
              type="button"
              onClick={onStartDrive}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F3F0EA] border border-[#E6E1D8] text-[#171717] text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#312E81]"
            >
              <SlidersHorizontal className="w-4 h-4 text-[#312E81]" />
              <span>Drive it yourself</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
