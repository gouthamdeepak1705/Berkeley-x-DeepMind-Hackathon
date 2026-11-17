import { useState } from 'react';
import { Fact, StoreBoardEntry, StoreBoardStatus } from '../../types/domain';
import { FactValue } from '../FactValue';
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

function compactStatusLabel(status: StoreBoardStatus, rawLabel: string): string {
  if (status === 'held_back') return 'Comparison';
  if (status === 'stock_on_the_way') return 'On the way';
  if (status === 'losing_sales') return 'Losing sales';
  return rawLabel;
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
      <div className="flex items-center justify-between text-[10px] text-[#56695D]">
        <span>{label}</span>
        <span>Closed</span>
      </div>
    );
  }
  const weeks = fact.value;
  const maxWeeks = 8;
  const pct = Math.min(100, Math.max(4, (weeks / maxWeeks) * 100));
  const alarmPct = (2.5 / maxWeeks) * 100;
  const low = weeks < 2.5;

  return (
    <div className="space-y-0.5 text-[10px] leading-tight">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[#56695D] truncate">{label}</span>
        <span
          className={low ? 'font-semibold text-[#991B1B]' : 'text-[#25372C]'}
          onClick={(e) => e.stopPropagation()}
        >
          <FactValue fact={fact} onInspect={onInspectFact} noPlus plainFont />
        </span>
      </div>
      <div className="relative h-1 rounded-full bg-[#EFE8D6] overflow-hidden">
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
      <aside aria-labelledby="store-board-heading" className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="store-board-heading" className="text-sm font-semibold text-[#25372C]">
            All 10 stores
          </h2>
          <p className="text-[11px] text-[#56695D]">
            Tap any store for detail. Orange line = 2.5 wks left.
          </p>
        </div>

        <ul
          className="grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          data-testid="simple-store-board"
        >
          {stores.map((store) => (
            <li
              key={store.storeId}
              onClick={() => setSelectedStoreId(store.storeId)}
              className="bg-white hover:bg-[#FFFDF7] border border-[#E5DCC7] rounded-xl px-2 py-1.5 space-y-0.5 transition-colors cursor-pointer shadow-2xs"
            >
              <div className="flex items-center justify-between gap-1.5 leading-tight">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedStoreId(store.storeId);
                  }}
                  className="text-xs font-semibold text-[#25372C] hover:underline text-left truncate cursor-pointer"
                >
                  {store.storeName}
                </button>
                <span
                  title={store.statusLabel}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 leading-none ${statusStyles(
                    store.status,
                  )}`}
                >
                  {compactStatusLabel(store.status, store.statusLabel)}
                </span>
              </div>

              <div className="space-y-0.5">
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
