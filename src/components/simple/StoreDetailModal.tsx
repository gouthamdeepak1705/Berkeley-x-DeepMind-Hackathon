import { X } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { Fact, StoreBoardEntry } from '../../types/domain';
import { FactValue } from '../FactValue';

interface StoreDetailModalProps {
  store: StoreBoardEntry | null;
  asOfDate: string;
  onClose: () => void;
  onInspectFact: (fact: Fact) => void;
}

export function StoreDetailModal({
  store,
  asOfDate,
  onClose,
  onInspectFact,
}: StoreDetailModalProps) {
  if (!store) return null;

  const points = store.chartPoints;
  const maxY = Math.max(
    1,
    ...points.map((p) => Math.max(p.actual7d, p.expected7d)),
  );
  const minY = Math.min(
    maxY * 0.6,
    ...points.map((p) => Math.min(p.actual7d, p.expected7d)),
  );
  const ySpan = Math.max(1, maxY - minY);

  const width = 480;
  const height = 160;
  const padX = 12;
  const padY = 14;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const toX = (idx: number) =>
    points.length <= 1 ? padX : padX + (idx / (points.length - 1)) * innerW;
  const toY = (val: number) => padY + innerH - ((val - minY) / ySpan) * innerH;

  const expectedPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.expected7d).toFixed(1)}`)
    .join(' ');
  const actualPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.actual7d).toFixed(1)}`)
    .join(' ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-detail-title"
      className="fixed inset-0 z-50 bg-[#25372C]/35 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-[#FFF8E8] border border-[#D8CEB8] rounded-2xl max-w-xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-xl">
        <div className="px-5 py-4 bg-white border-b border-[#E5DCC7] flex items-start justify-between gap-3">
          <div>
            <h2 id="store-detail-title" className="text-lg font-semibold text-[#25372C]">
              {store.storeName}
            </h2>
            <p className="text-xs text-[#56695D]">
              {store.statusLabel} · Through {formatShortDate(asOfDate)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close store details"
            className="p-1.5 rounded-lg border border-[#E5DCC7] bg-white hover:bg-[#F5EEDD] text-[#56695D] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* 7-day sales & saved/lost */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-white border border-[#E5DCC7]">
              <p className="text-[#56695D]">Last 7 days sales</p>
              <p className="mt-1 text-sm font-semibold text-[#25372C]">
                <FactValue fact={store.sales7dActualFact} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-[#E5DCC7]">
              <p className="text-[#56695D]">Expected 7 days</p>
              <p className="mt-1 text-sm font-semibold text-[#25372C]">
                <FactValue fact={store.sales7dExpectedFact} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-[#CFE0D4]">
              <p className="text-[#43564A]">Saved here</p>
              <p className="mt-1 text-sm font-semibold text-[#15803D]">
                <FactValue fact={store.savedSoFarFact} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white border border-[#EBD2CC]">
              <p className="text-[#5C3A36]">Lost here</p>
              <p className="mt-1 text-sm font-semibold text-[#991B1B]">
                <FactValue fact={store.lostSoFarFact} onInspect={onInspectFact} noPlus plainFont />
              </p>
            </div>
          </div>

          {/* Chart: Sales this week against what was expected */}
          {points.length > 1 && (
            <div className="p-3.5 rounded-xl bg-white border border-[#E5DCC7] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[#25372C]">
                  Sales this week against what was expected
                </p>
                <div className="flex items-center gap-3 text-[11px] text-[#56695D]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-[#25372C] inline-block" /> Actual
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 border-t border-dashed border-[#8DA496] inline-block" /> Expected
                  </span>
                </div>
              </div>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-36 overflow-visible"
                aria-label={`Sales chart for ${store.storeName}`}
              >
                <path
                  d={expectedPath}
                  fill="none"
                  stroke="#8DA496"
                  strokeWidth="1.75"
                  strokeDasharray="4 3"
                />
                <path
                  d={actualPath}
                  fill="none"
                  stroke="#25372C"
                  strokeWidth="2.25"
                />
              </svg>
              <p className="text-[11px] text-[#56695D]">
                Shows 7-day rolling totals up to {formatShortDate(asOfDate)} only.
              </p>
            </div>
          )}

          {/* Stock left */}
          {store.isOpen && (
            <div className="p-3.5 rounded-xl bg-white border border-[#E5DCC7] space-y-2">
              <p className="font-semibold text-[#25372C]">Stock left today (alarm line: 2.5 weeks)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[#56695D]">Best-sellers</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#25372C]">
                    {store.bestSellersCoverFact ? (
                      <FactValue
                        fact={store.bestSellersCoverFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                    ) : (
                      'Not open'
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[#56695D]">Knitwear</p>
                  <p className="mt-0.5 text-sm font-semibold text-[#25372C]">
                    {store.knitwearCoverFact ? (
                      <FactValue
                        fact={store.knitwearCoverFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                    ) : (
                      'Not open'
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Store events */}
          <div className="p-3.5 rounded-xl bg-white border border-[#E5DCC7] space-y-2">
            <p className="font-semibold text-[#25372C]">What happened at this store</p>
            {store.events.length === 0 ? (
              <p className="text-[#56695D]">Normal trading through {formatShortDate(asOfDate)}.</p>
            ) : (
              <ul className="space-y-1.5">
                {store.events.map((ev, idx) => (
                  <li key={`${ev.date}-${idx}`} className="flex items-baseline justify-between gap-2">
                    <span className="text-[#25372C]">{ev.summary}</span>
                    <span className="text-[#56695D] shrink-0">{formatShortDate(ev.date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
