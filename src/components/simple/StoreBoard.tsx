import { useState } from 'react';
import { Fact, StoreBoardEntry, StoreBoardStatus } from '../../types/domain';
import { FactValue } from '../FactValue';
import { formatWholeUsd } from './SimpleHelpers';
import { StoreDetailModal } from './StoreDetailModal';

interface StoreBoardProps {
  stores: StoreBoardEntry[];
  asOfDate: string;
  onInspectFact: (fact: Fact) => void;
}

function statusStyles(status: StoreBoardStatus): string {
  switch (status) {
    case 'losing_sales':
      return 'bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]';
    case 'at_risk':
      return 'bg-[#FEF3C7] text-[#78350F] border-[#FDE68A]';
    case 'stock_on_the_way':
      return 'bg-[#E8F1EC] text-[#25372C] border-[#C6DBC9]';
    case 'held_back':
      return 'bg-[#F3EFE3] text-[#43564A] border-[#DFD7C2]';
    case 'not_open':
      return 'bg-[#F5EEDD] text-[#56695D] border-[#DFD5BE]';
    case 'fine':
    default:
      return 'bg-[#DCFCE7] text-[#14532D] border-[#BBF7D0]';
  }
}

function StockMiniBar({
  label,
  fact,
  onInspectFact,
}: {
  label: string;
  fact: Fact | null;
  onInspectFact: (fact: Fact) => void;
}) {
  if (!fact) {
    return (
      <div className="flex items-center justify-between text-[11px] text-[#56695D]">
        <span>{label}</span>
        <span>Not open yet</span>
      </div>
    );
  }
  const weeks = fact.value;
  const maxWeeks = 8;
  const pct = Math.min(100, Math.max(4, (weeks / maxWeeks) * 100));
  const alarmPct = (2.5 / maxWeeks) * 100;
  const low = weeks < 2.5;

  return (
    <div className="space-y-0.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[#56695D]">{label}</span>
        <span
          className={low ? 'font-semibold text-[#991B1B]' : 'text-[#25372C]'}
          onClick={(e) => e.stopPropagation()}
        >
          <FactValue fact={fact} onInspect={onInspectFact} noPlus plainFont />
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-[#EFE8D6] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            low ? 'bg-[#DC2626]' : 'bg-[#25372C]'
          }`}
          style={{ width: `${pct}%` }}
        />
        <span
          aria-hidden="true"
          title="2.5 week alarm line"
          className="absolute top-0 bottom-0 w-0.5 bg-[#B45309]"
          style={{ left: `${alarmPct}%` }}
        />
      </div>
    </div>
  );
}

export function StoreBoard({ stores, asOfDate, onInspectFact }: StoreBoardProps) {
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const selectedStore = stores.find((s) => s.storeId === selectedStoreId) ?? null;

  return (
    <>
      <aside aria-labelledby="store-board-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 id="store-board-heading" className="text-base font-semibold text-[#25372C]">
              All 10 stores
            </h2>
            <p className="text-xs text-[#56695D]">
              Largest stores first. Orange tick marks the 2.5 week alarm line.
            </p>
          </div>
        </div>

        <ul className="space-y-2.5" data-testid="simple-store-board">
          {stores.map((store) => (
            <li
              key={store.storeId}
              onClick={() => setSelectedStoreId(store.storeId)}
              className="bg-white hover:bg-[#FFFDF7] border border-[#E5DCC7] rounded-2xl p-3.5 space-y-2.5 transition-colors cursor-pointer shadow-2xs"
            >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedStoreId(store.storeId);
                    }}
                    className="text-sm font-semibold text-[#25372C] hover:underline text-left cursor-pointer"
                  >
                    {store.storeName}
                  </button>
                  <span
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${statusStyles(
                      store.status,
                    )}`}
                  >
                    {store.statusLabel}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StockMiniBar
                    label="Best-sellers"
                    fact={store.bestSellersCoverFact}
                    onInspectFact={onInspectFact}
                  />
                  <StockMiniBar
                    label="Knitwear"
                    fact={store.knitwearCoverFact}
                    onInspectFact={onInspectFact}
                  />
                </div>

                {store.isOpen && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#EFE8D6] text-[11px] text-[#56695D]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>
                      7-day sales:{' '}
                      <FactValue
                        fact={store.sales7dActualFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                        className="text-[#25372C] font-medium"
                      />{' '}
                      (expected{' '}
                      <FactValue
                        fact={store.sales7dExpectedFact}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                      />
                      )
                    </span>
                    <div className="flex items-center gap-2">
                      {store.savedSoFarFact.value > 0 && (
                        <span className="text-[#15803D] font-medium">
                          Saved {formatWholeUsd(store.savedSoFarFact.value)}
                        </span>
                      )}
                      {store.lostSoFarFact.value > 0 && (
                        <span className="text-[#991B1B] font-medium">
                          Lost {formatWholeUsd(store.lostSoFarFact.value)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
            </li>
          ))}
        </ul>
      </aside>

      <StoreDetailModal
        store={selectedStore}
        asOfDate={asOfDate}
        onClose={() => setSelectedStoreId(null)}
        onInspectFact={onInspectFact}
      />
    </>
  );
}
