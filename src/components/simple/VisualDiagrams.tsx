import { ArrowDown, ArrowRight } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { CardVisualMetrics, Fact, TransferPlan } from '../../types/domain';
import { FactValue } from '../FactValue';

/**
 * 1. Stock shortage bar: stock left vs days until next delivery + empty red gap.
 */
export function StockShortageVisual({
  metrics,
  onInspectFact,
}: {
  metrics: CardVisualMetrics;
  onInspectFact: (fact: Fact) => void;
}) {
  const daysLeft = metrics.daysOfStockLeftFact;
  const daysDelivery = metrics.daysUntilDeliveryFact;
  const emptyDays = metrics.emptyShelfDaysFact;
  const doNothingLoss = metrics.doNothingLossFact;

  if (!daysLeft) return null;

  const hasDelivery = Boolean(daysDelivery && daysDelivery.value > 0);
  const horizonDays = hasDelivery
    ? Math.max(daysLeft.value, daysDelivery!.value, 14)
    : Math.max(daysLeft.value, 42);
  const stockPct = Math.min(100, Math.max(6, (daysLeft.value / horizonDays) * 100));
  const deliveryPct = hasDelivery
    ? Math.min(100, Math.max(stockPct, (daysDelivery!.value / horizonDays) * 100))
    : 100;
  const gapPct = Math.max(0, deliveryPct - stockPct);

  return (
    <div className="p-3.5 rounded-xl bg-[#FFFDF7] border border-[#E7DEC8] space-y-2.5 text-xs">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[#25372C]">
          <span>
            Stock lasts <FactValue fact={daysLeft} onInspect={onInspectFact} noPlus plainFont />
          </span>
          {hasDelivery ? (
            <span className="text-[#56695D]">
              Next delivery in{' '}
              <FactValue fact={daysDelivery!} onInspect={onInspectFact} noPlus plainFont />
            </span>
          ) : (
            <span className="text-[#56695D]">Next scheduled delivery: none on schedule</span>
          )}
        </div>

        <div
          className="relative h-5 w-full rounded-lg bg-[#EFE8D6] overflow-hidden flex"
          aria-label="Stock days compared with next delivery"
        >
          <div
            className="h-full bg-[#25372C] transition-all"
            style={{ width: `${stockPct}%` }}
          />
          {gapPct > 0 && (
            <div
              className="h-full bg-[#DC2626]/80 transition-all"
              style={{ width: `${gapPct}%` }}
            />
          )}
        </div>

        {emptyDays && emptyDays.value > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[#991B1B] font-medium">
            <span>
              Empty shelves for{' '}
              <FactValue fact={emptyDays} onInspect={onInspectFact} noPlus plainFont />
            </span>
            {doNothingLoss && (
              <span>
                Loss if you wait:{' '}
                <FactValue fact={doNothingLoss} onInspect={onInspectFact} noPlus plainFont />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 2. Transfer flow diagram: stores with spare stock -> receiving stores (+ held-back box if any).
 */
export function TransferFlowVisual({
  plan,
  onInspectFact,
}: {
  plan: TransferPlan;
  onInspectFact: (fact: Fact) => void;
}) {
  const fromTotals = new Map<string, number>();
  const toTotals = new Map<string, number>();

  for (const line of plan.transferLines) {
    fromTotals.set(line.fromStoreName, (fromTotals.get(line.fromStoreName) ?? 0) + line.units);
    toTotals.set(line.toStoreName, (toTotals.get(line.toStoreName) ?? 0) + line.units);
  }

  return (
    <div className="p-3.5 rounded-xl bg-[#F7FAF7] border border-[#CFE0D4] space-y-2.5 text-xs">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-stretch sm:items-center gap-2.5">
        <div className="space-y-1">
          <p className="text-[#56695D] font-medium">Stores with spare stock</p>
          <ul className="space-y-1">
            {Array.from(fromTotals.entries()).map(([name, units]) => (
              <li
                key={`from-${name}`}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#DCE6DF] flex items-center justify-between gap-2"
              >
                <span className="font-medium text-[#25372C] sm:truncate">{name}</span>
                <span className="text-[#56695D] shrink-0">-{units.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-row sm:flex-col items-center justify-center gap-2 sm:gap-0 px-1 py-1 sm:py-0 text-center">
          <ArrowRight className="hidden sm:block w-4 h-4 text-[#25372C]" />
          <ArrowDown className="sm:hidden w-4 h-4 text-[#25372C]" />
          <span className="sm:mt-1 font-semibold text-[#25372C]">
            <FactValue fact={plan.totalUnitsFact} onInspect={onInspectFact} noPlus plainFont />
          </span>
          <span className="text-[11px] text-[#56695D]">
            Arrives {formatShortDate(plan.arrivalDate)}
          </span>
        </div>

        <div className="space-y-1">
          <p className="text-[#56695D] font-medium">Stores receiving stock</p>
          <ul className="space-y-1">
            {Array.from(toTotals.entries()).map(([name, units]) => (
              <li
                key={`to-${name}`}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#B7D7C1] flex items-center justify-between gap-2"
              >
                <span className="font-medium text-[#25372C] sm:truncate">{name}</span>
                <span className="font-semibold text-[#15803D] shrink-0">
                  +{units.toLocaleString('en-US')}
                </span>
              </li>
            ))}
            {plan.holdoutStoreName && (
              <li className="px-2.5 py-1.5 rounded-lg bg-[#FFF8E8] border border-dashed border-[#B7AE97] flex items-center justify-between gap-2">
                <span className="font-medium text-[#43564A] sm:truncate">
                  {plan.holdoutStoreName}
                </span>
                <span className="text-[11px] text-[#56695D] shrink-0">Held back</span>
              </li>
            )}
          </ul>
        </div>
      </div>
      <p className="text-[11px] text-[#56695D]">
        Each store with spare stock keeps enough to reach its own next delivery.
      </p>
    </div>
  );
}

/**
 * 3. Proof comparison bars: stores that got stock vs the store held back for comparison.
 */
export function ProofComparisonVisual({
  data,
  onInspectFact,
}: {
  data: NonNullable<CardVisualMetrics['proofBarData']>;
  onInspectFact: (fact: Fact) => void;
}) {
  const maxPct = Math.max(
    Math.abs(data.treatedPctFact.value),
    Math.abs(data.holdoutPctFact.value),
    20,
  );
  const treatedWidth = Math.min(100, Math.max(12, (Math.abs(data.treatedPctFact.value) / maxPct) * 100));
  const holdoutWidth = Math.min(100, Math.max(12, (Math.abs(data.holdoutPctFact.value) / maxPct) * 100));

  return (
    <div className="p-3.5 rounded-xl bg-[#F4FBF6] border border-[#BBF7D0] space-y-2.5 text-xs">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-[#14532D]">
            {data.treatedNames} (got stock)
          </span>
          <span className="font-semibold text-[#15803D]">
            <FactValue fact={data.treatedPctFact} onInspect={onInspectFact} noPlus plainFont /> (
            <FactValue
              fact={data.treatedActualSalesFact}
              onInspect={onInspectFact}
              noPlus
              plainFont
            />
            )
          </span>
        </div>
        <div className="h-3.5 w-full rounded-full bg-[#DCFCE7] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#15803D]"
            style={{ width: `${treatedWidth}%` }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-[#43564A]">
            {data.holdoutName} (held back for comparison)
          </span>
          <span className="font-semibold text-[#991B1B]">
            <FactValue fact={data.holdoutPctFact} onInspect={onInspectFact} noPlus plainFont /> (
            <FactValue
              fact={data.holdoutActualSalesFact}
              onInspect={onInspectFact}
              noPlus
              plainFont
            />
            )
          </span>
        </div>
        <div className="h-3.5 w-full rounded-full bg-[#EFE8D6] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#DC2626]/75"
            style={{ width: `${holdoutWidth}%` }}
          />
        </div>
      </div>

      <p className="text-[11px] text-[#43564A]">
        The only difference was the stock. So the stock caused the gain.
      </p>
    </div>
  );
}

/**
 * 4. Refund store comparison: Walnut Creek vs the other 7 established stores + 3 plain clues.
 */
export function RefundComparisonVisual({
  rows,
  onInspectFact,
}: {
  rows: NonNullable<CardVisualMetrics['refundStoreComparison']>;
  onInspectFact: (fact: Fact) => void;
}) {
  const maxRate = Math.max(...rows.map((r) => r.refundRateFact.value), 10);

  return (
    <div className="p-3.5 rounded-xl bg-[#FFFDF7] border border-[#E7DEC8] space-y-3 text-xs">
      <div className="space-y-1.5">
        <p className="font-medium text-[#25372C]">
          Cash refund rate across stores open more than 18 months
        </p>
        <div className="space-y-1.5">
          {rows.map((row) => {
            const width = Math.min(100, Math.max(6, (row.refundRateFact.value / maxRate) * 100));
            return (
              <div key={row.storeId} className="grid grid-cols-[110px_1fr_48px] items-center gap-2">
                <span
                  className={`truncate ${
                    row.isFlagged ? 'font-semibold text-[#991B1B]' : 'text-[#56695D]'
                  }`}
                >
                  {row.storeName}
                </span>
                <div className="h-2.5 rounded-full bg-[#EFE8D6] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      row.isFlagged ? 'bg-[#DC2626]' : 'bg-[#8DA496]'
                    }`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="text-right">
                  <FactValue
                    fact={row.refundRateFact}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                    className={row.isFlagged ? 'font-semibold text-[#991B1B]' : 'text-[#56695D]'}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-[#EFE8D6]">
        <div className="p-2 rounded-lg bg-[#FFF8E8]">
          <p className="font-semibold text-[#25372C]">Till 2</p>
          <p className="text-[11px] text-[#56695D]">Most unmatched cash refunds happen on one till.</p>
        </div>
        <div className="p-2 rounded-lg bg-[#FFF8E8]">
          <p className="font-semibold text-[#25372C]">One staff member</p>
          <p className="text-[11px] text-[#56695D]">One login appears on most extra evening refunds.</p>
        </div>
        <div className="p-2 rounded-lg bg-[#FFF8E8]">
          <p className="font-semibold text-[#25372C]">Cash, after 8 pm</p>
          <p className="text-[11px] text-[#56695D]">Happens late in the evening without a sale receipt.</p>
        </div>
      </div>
    </div>
  );
}
