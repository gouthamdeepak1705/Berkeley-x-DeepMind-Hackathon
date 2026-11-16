import { Eye, Play, Search, SlidersHorizontal, Sparkles, Wrench, X } from 'lucide-react';
import { DayOneBrief, Fact } from '../../types/domain';
import { FactValue } from '../FactValue';
import { SimpleTextSegments } from './SimpleHelpers';

interface WelcomeScreenProps {
  onStartTour: () => void;
  onStartWatch: () => void;
  onStartDrive: () => void;
  onOpenAbout: () => void;
  onToggleTechnicalDetail: () => void;
}

export function WelcomeScreen({
  onStartTour,
  onStartWatch,
  onStartDrive,
  onOpenAbout,
  onToggleTechnicalDetail,
}: WelcomeScreenProps) {
  return (
    <div className="simple-shell min-h-screen flex flex-col justify-center px-4 py-8 sm:px-8">
      <main className="max-w-3xl w-full mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-base font-semibold tracking-tight text-[#25372C]">
            Opscien Instinct
          </span>
          <div className="flex items-center gap-4 text-xs">
            <button
              type="button"
              onClick={onOpenAbout}
              className="text-[#43564A] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              About this business
            </button>
            <button
              type="button"
              onClick={onToggleTechnicalDetail}
              className="text-[#56695D] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              Show technical detail
            </button>
          </div>
        </div>

        <section className="bg-white border border-[#DFD5BE] rounded-2xl p-6 sm:p-8 space-y-5 shadow-2xs">
          <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-[#25372C] leading-tight text-balance">
            Your business has never told you anything. You had to ask.
          </h1>
          <p className="text-base text-[#43564A] leading-relaxed">
            Opscien watches your stores every day, checks what really changed, and only speaks up when an action can save money.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="p-4 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#25372C]">
                <Eye className="w-4 h-4 shrink-0" />
                <span>Manager</span>
              </div>
              <p className="text-xs text-[#56695D] leading-snug">
                Watches daily sales and stock, and stays quiet during normal seasonal swings.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#25372C]">
                <Search className="w-4 h-4 shrink-0" />
                <span>Data scientist</span>
              </div>
              <p className="text-xs text-[#56695D] leading-snug">
                Finds why numbers changed and holds one store back to prove what worked.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#25372C]">
                <Wrench className="w-4 h-4 shrink-0" />
                <span>Developer</span>
              </div>
              <p className="text-xs text-[#56695D] leading-snug">
                Builds simple store tools when needed and checks them three times before handover.
              </p>
            </div>
          </div>

          <p className="text-xs text-[#56695D] pt-1">
            Built around Linden &amp; Rye, a simulated 10-store womenswear chain across 106 days (1 August to 14 November 2026).
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="start-tour-btn"
              onClick={onStartTour}
              className="inline-flex items-center gap-2 px-5 py-3 bg-[#25372C] hover:bg-[#1C2A21] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Take the guided tour</span>
            </button>

            <button
              type="button"
              data-testid="start-watch-btn"
              onClick={onStartWatch}
              className="inline-flex items-center gap-2 px-4 py-3 bg-white hover:bg-[#F5EEDD] border border-[#D8CEB8] text-[#25372C] text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Watch it run</span>
            </button>

            <button
              type="button"
              data-testid="start-drive-btn"
              onClick={onStartDrive}
              className="inline-flex items-center gap-2 px-4 py-3 bg-white hover:bg-[#F5EEDD] border border-[#D8CEB8] text-[#25372C] text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Drive it yourself</span>
            </button>
          </div>
        </section>

        <footer className="text-xs text-[#56695D] flex flex-wrap items-center justify-between gap-2">
          <span>
            Opscien, by{' '}
            <a
              href="https://goodatnumbers.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[#25372C]"
            >
              Good at Numbers
            </a>
            . Find the story in your business.
          </span>
        </footer>
      </main>
    </div>
  );
}

interface AboutBusinessModalProps {
  open: boolean;
  brief: DayOneBrief;
  onClose: () => void;
  onInspectFact: (fact: Fact) => void;
  onOpenRealityNote: () => void;
}

export function AboutBusinessModal({
  open,
  brief,
  onClose,
  onInspectFact,
  onOpenRealityNote,
}: AboutBusinessModalProps) {
  if (!open) return null;

  const f = brief.summaryFacts;
  const paragraphs = brief.narrativeSegments;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-business-title"
      className="fixed inset-0 z-50 bg-[#25372C]/35 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-[#FFF8E8] border border-[#D8CEB8] rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 bg-white border-b border-[#E5DCC7] flex items-start justify-between gap-3">
          <div>
            <h2 id="about-business-title" className="text-lg font-semibold text-[#25372C]">
              About {brief.businessName}
            </h2>
            <p className="text-xs text-[#56695D]">
              What the numbers showed before 1 August 2026. Tap any figure to see how it was computed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about business"
            className="p-1.5 rounded-lg border border-[#E5DCC7] bg-white hover:bg-[#F5EEDD] text-[#56695D] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-sm text-[#25372C]">
          <div className="bg-white border border-[#E5DCC7] rounded-xl p-4 space-y-2.5 leading-relaxed">
            {paragraphs && paragraphs.length > 0 ? (
              paragraphs.map((segs, idx) => (
                <p key={`ab-p-${idx}`}>
                  <SimpleTextSegments segments={segs} onInspectFact={onInspectFact} />
                </p>
              ))
            ) : (
              <>
                <p>
                  {brief.businessName} runs{' '}
                  <FactValue fact={f.storeCount} onInspect={onInspectFact} noPlus plainFont /> womenswear
                  stores in California:{' '}
                  <FactValue fact={f.establishedCount} onInspect={onInspectFact} noPlus plainFont />{' '}
                  open more than 18 months and{' '}
                  <FactValue fact={f.newStoreCount} onInspect={onInspectFact} noPlus plainFont />{' '}
                  newer stores.
                </p>
                <p>
                  Weekends are strongest: Saturdays run{' '}
                  <FactValue fact={f.strongestWeekdayShare} onInspect={onInspectFact} noPlus plainFont />{' '}
                  above the daily average. December lifts sales{' '}
                  <FactValue fact={f.decemberIndex} onInspect={onInspectFact} noPlus plainFont /> while
                  late summer softens{' '}
                  <FactValue fact={f.lullIndex} onInspect={onInspectFact} noPlus plainFont />.
                </p>
                <p>
                  Best-sellers make up{' '}
                  <FactValue fact={f.bestSellersShare} onInspect={onInspectFact} noPlus plainFont /> of
                  sales, and Knitwear{' '}
                  <FactValue fact={f.knitwearShare} onInspect={onInspectFact} noPlus plainFont />.
                </p>
              </>
            )}
          </div>

          <div className="bg-white border border-[#E5DCC7] rounded-xl divide-y divide-[#EFE8D6]">
            {brief.confirmedRules.map((rule, idx) => (
              <div key={rule.id} className="p-3.5 flex items-baseline gap-3">
                <span className="text-xs font-semibold text-[#56695D] shrink-0">
                  {idx + 1}.
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#25372C]">{rule.title}</p>
                  <p className="text-xs text-[#56695D] leading-snug">{rule.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <button
              type="button"
              onClick={onOpenRealityNote}
              className="text-[#43564A] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              What is real here?
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#25372C] text-white rounded-lg font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
