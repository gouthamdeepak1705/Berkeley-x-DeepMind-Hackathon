import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { diffDays, formatShortDate, LIVE_START_DATE } from '../../engine/calendar';
import { DayByDayChartEvent, DayByDayChartPoint, Fact } from '../../types/domain';
import { FactValue } from '../FactValue';
import { formatWholeUsd } from './SimpleHelpers';

export interface DayByDayChartViewProps {
  points: DayByDayChartPoint[];
  events: DayByDayChartEvent[];
  totalDays: number;
  mode: 'sales' | 'money';
  currentDate: string;
  onInspectFact: (fact: Fact) => void;
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PAD_LEFT = 54;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 42;

function dotColor(kind: DayByDayChartEvent['kind']): string {
  if (kind === 'acted') return '#15803D';
  if (kind === 'raised') return '#D97706';
  return '#9CA3AF';
}

function dotLabel(kind: DayByDayChartEvent['kind']): string {
  if (kind === 'acted') return 'Action taken';
  if (kind === 'raised') return 'Warning raised';
  return 'Checked, stayed quiet';
}

function buildPositiveFillPath(
  coords: Array<{ x: number; topY: number; baseY: number; active: boolean }>,
): string {
  const paths: string[] = [];
  let span: Array<{ x: number; topY: number; baseY: number }> = [];

  const flush = () => {
    if (span.length >= 2) {
      const upper = span.map((p) => `${p.x.toFixed(1)},${p.topY.toFixed(1)}`).join(' L ');
      const lower = span
        .slice()
        .reverse()
        .map((p) => `${p.x.toFixed(1)},${p.baseY.toFixed(1)}`)
        .join(' L ');
      paths.push(`M ${upper} L ${lower} Z`);
    }
    span = [];
  };

  for (const pt of coords) {
    if (pt.active) {
      span.push(pt);
    } else {
      flush();
    }
  }
  flush();
  return paths.join(' ');
}

export function DayByDayChartView({
  points,
  events,
  totalDays,
  mode,
  currentDate,
  onInspectFact,
}: DayByDayChartViewProps) {
  const [selectedEventDate, setSelectedEventDate] = useState<string | null>(null);

  useEffect(() => {
    if (selectedEventDate && !events.some((e) => e.date === selectedEventDate)) {
      setSelectedEventDate(null);
    }
  }, [events, selectedEventDate]);

  if (points.length === 0) return null;

  const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const spanDays = Math.max(1, totalDays - 1);

  const xForDate = (d: string) => {
    const idx = Math.max(0, Math.min(spanDays, diffDays(LIVE_START_DATE, d)));
    return PAD_LEFT + (idx / spanDays) * plotW;
  };
  const xForIndex = (idx: number) => PAD_LEFT + (idx / spanDays) * plotW;

  let minVal = 0;
  let maxVal = mode === 'sales' ? 320_000 : 100_000;

  if (mode === 'sales') {
    minVal = Infinity;
    maxVal = -Infinity;
    for (const p of points) {
      const lo = Math.min(p.sales7dWithOpscien, p.sales7dWithoutOpscien);
      const hi = Math.max(p.sales7dWithOpscien, p.sales7dWithoutOpscien);
      if (lo < minVal) minVal = lo;
      if (hi > maxVal) maxVal = hi;
    }
    minVal = Math.max(0, Math.floor((minVal - 15_000) / 25_000) * 25_000);
    maxVal = Math.max(minVal + 50_000, Math.ceil((maxVal + 15_000) / 25_000) * 25_000);
  } else {
    minVal = 0;
    let peak = 50_000;
    for (const p of points) {
      peak = Math.max(peak, p.withoutOpscienUsd, p.lostSoFarUsd);
    }
    maxVal = Math.ceil(peak / 50_000) * 50_000;
  }

  const yForValue = (val: number) =>
    PAD_TOP + plotH - ((val - minVal) / Math.max(1, maxVal - minVal)) * plotH;

  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];

  const coords = points.map((p) => {
    const x = xForDate(p.date);
    if (mode === 'sales') {
      const yWith = yForValue(p.sales7dWithOpscien);
      const yWithout = yForValue(p.sales7dWithoutOpscien);
      return {
        x,
        primaryY: yWith,
        baselineY: yWithout,
        protectedFill: p.sales7dWithOpscien > p.sales7dWithoutOpscien + 50,
      };
    }
    const yWithout = yForValue(p.withoutOpscienUsd);
    const yLost = yForValue(p.lostSoFarUsd);
    return {
      x,
      primaryY: yLost,
      baselineY: yWithout,
      protectedFill: p.withoutOpscienUsd > p.lostSoFarUsd + 10,
    };
  });

  const baselineLinePath =
    coords.length > 1
      ? `M ${coords.map((c) => `${c.x.toFixed(1)},${c.baselineY.toFixed(1)}`).join(' L ')}`
      : '';
  const primaryLinePath =
    coords.length > 1
      ? `M ${coords.map((c) => `${c.x.toFixed(1)},${c.primaryY.toFixed(1)}`).join(' L ')}`
      : '';
  const greenFillPath = buildPositiveFillPath(
    coords.map((c) => ({
      x: c.x,
      topY: Math.min(c.primaryY, c.baselineY),
      baseY: Math.max(c.primaryY, c.baselineY),
      active: c.protectedFill,
    })),
  );

  const axisMarks = [
    { idx: 0, label: 'Aug 1', anchor: 'start' as const },
    { idx: 31, label: 'Sep 1', anchor: 'middle' as const },
    { idx: 61, label: 'Oct 1', anchor: 'middle' as const },
    { idx: 92, label: 'Nov 1', anchor: 'middle' as const },
    { idx: 105, label: 'Nov 14', anchor: 'end' as const },
  ];

  const axisY = PAD_TOP + plotH;
  const lastCoord = coords[coords.length - 1];
  const lastPoint = points[points.length - 1];
  const selectedEvent = selectedEventDate
    ? events.find((e) => e.date === selectedEventDate) ?? null
    : null;

  return (
    <div className="space-y-2.5">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#56695D]">
        {mode === 'sales' ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#25372C] inline-block" />
              <span className="text-[#25372C] font-medium">
                Actual 7-day sales ({formatWholeUsd(lastPoint.sales7dWithOpscien)})
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#64748B] inline-block" />
              <span>Without Opscien ({formatWholeUsd(lastPoint.sales7dWithoutOpscien)})</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#16A34A]/30 border border-[#16A34A] inline-block" />
              <span className="text-[#14532D] font-medium">Sales Opscien protected</span>
            </span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#64748B] inline-block" />
              <span>Without Opscien ({formatWholeUsd(lastPoint.withoutOpscienUsd)})</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-[#DC2626] inline-block" />
              <span className="text-[#991B1B] font-medium">
                Actual lost ({formatWholeUsd(lastPoint.lostSoFarUsd)})
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#16A34A]/30 border border-[#16A34A] inline-block" />
              <span className="text-[#14532D] font-medium">
                Saved ({formatWholeUsd(lastPoint.savedSoFarUsd)})
              </span>
            </span>
          </>
        )}
      </div>

      {/* Responsive SVG plot (~220px height on desktop) */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-[195px] sm:h-[220px] overflow-visible select-none"
          role="img"
          aria-label={`Day by day ${mode} chart through ${currentDate}`}
        >
          {/* Horizontal gridlines */}
          {yTicks.map((val) => {
            const y = yForValue(val);
            return (
              <g key={`yt-${val}`}>
                <line
                  x1={PAD_LEFT}
                  x2={CHART_WIDTH - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="#EFE8D6"
                  strokeWidth="1"
                />
                <text
                  x={PAD_LEFT - 7}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[#56695D] text-[10px]"
                >
                  {val === 0 ? '$0' : `$${Math.round(val / 1000)}k`}
                </text>
              </g>
            );
          })}

          {/* Baseline axis */}
          <line
            x1={PAD_LEFT}
            x2={CHART_WIDTH - PAD_RIGHT}
            y1={axisY}
            y2={axisY}
            stroke="#DFD5BE"
            strokeWidth="1"
          />

          {/* Shaded saved/protected area */}
          {greenFillPath && <path d={greenFillPath} fill="#16A34A" opacity="0.18" />}

          {/* Dashed counterfactual line */}
          {baselineLinePath && (
            <path
              d={baselineLinePath}
              fill="none"
              stroke="#64748B"
              strokeWidth="1.75"
              strokeDasharray="4 3"
            />
          )}

          {/* Primary solid line */}
          {primaryLinePath && (
            <path
              d={primaryLinePath}
              fill="none"
              stroke={mode === 'sales' ? '#25372C' : '#DC2626'}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Current day endpoint marker */}
          <circle
            cx={lastCoord.x}
            cy={lastCoord.primaryY}
            r="3.8"
            fill={mode === 'sales' ? '#25372C' : '#DC2626'}
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />

          {/* Date axis labels */}
          {axisMarks.map((m) => {
            const x = xForIndex(m.idx);
            return (
              <g key={m.label}>
                <line x1={x} x2={x} y1={axisY} y2={axisY + 4} stroke="#C8BEA5" strokeWidth="1" />
                <text
                  x={x}
                  y={axisY + 29}
                  textAnchor={m.anchor}
                  className="fill-[#56695D] text-[10px]"
                >
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* Clickable event dots along X-axis (quiet behind raised behind acted) */}
          {events
            .slice()
            .sort((a, b) => {
              const rank = (k: DayByDayChartEvent['kind']) =>
                k === 'quiet' ? 0 : k === 'raised' ? 1 : 2;
              return rank(a.kind) - rank(b.kind);
            })
            .map((ev) => {
              const x = xForDate(ev.date);
              const y = axisY + 11;
              const isSelected = selectedEventDate === ev.date;
              return (
                <g
                  key={`ev-${ev.date}`}
                  role="button"
                  tabIndex={0}
                  data-testid={`chart-event-dot-${ev.date}`}
                  aria-label={`${formatShortDate(ev.date)}: ${ev.title}`}
                  onClick={() =>
                    setSelectedEventDate((cur) => (cur === ev.date ? null : ev.date))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedEventDate((cur) => (cur === ev.date ? null : ev.date));
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  <circle cx={x} cy={y} r="5" fill="transparent" />
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r="6"
                      fill="none"
                      stroke="#25372C"
                      strokeWidth="1.5"
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={isSelected ? '4.5' : '3.6'}
                    fill={dotColor(ev.kind)}
                    stroke="#FFFFFF"
                    strokeWidth="1.1"
                  />
                </g>
              );
            })}
        </svg>
      </div>

      {/* Dot legend + hint */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#56695D]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#9CA3AF] inline-block" />
            <span>Quiet</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#D97706] inline-block" />
            <span>Warning raised</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#15803D] inline-block" />
            <span>Action taken</span>
          </span>
        </div>
        <span>Tap any dot to read that day</span>
      </div>

      {/* Selected dot detail box */}
      {selectedEvent && (
        <div
          data-testid="chart-event-detail"
          className="p-3 rounded-xl bg-[#FFFDF7] border border-[#DFD5BE] text-xs space-y-1.5"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold text-[#25372C]">
                {formatShortDate(selectedEvent.date)} · {selectedEvent.title}
              </span>
              <span className="ml-2 text-[11px] text-[#56695D]">
                ({dotLabel(selectedEvent.kind)})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedEventDate(null)}
              aria-label="Close day detail"
              className="p-0.5 text-[#56695D] hover:text-[#25372C] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[#43564A] leading-snug">{selectedEvent.summary}</p>
          {selectedEvent.facts.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[#56695D]">
              {selectedEvent.facts.map((f) => (
                <span key={f.id}>
                  {f.label}:{' '}
                  <FactValue
                    fact={f}
                    onInspect={onInspectFact}
                    noPlus
                    plainFont
                    className="font-semibold text-[#25372C]"
                  />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DayByDayChartCardProps {
  points: DayByDayChartPoint[];
  events: DayByDayChartEvent[];
  totalDays: number;
  activeTab: 'sales' | 'money';
  currentDate: string;
  onChangeTab: (tab: 'sales' | 'money') => void;
  onInspectFact: (fact: Fact) => void;
}

export function DayByDayChartCard({
  points,
  events,
  totalDays,
  activeTab,
  currentDate,
  onChangeTab,
  onInspectFact,
}: DayByDayChartCardProps) {
  if (points.length === 0) return null;

  return (
    <section
      aria-labelledby="day-by-day-heading"
      data-testid="day-by-day-chart-card"
      className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="day-by-day-heading" className="text-base font-semibold text-[#25372C]">
            Day by day
          </h2>
          <p className="text-xs text-[#56695D]">
            {activeTab === 'sales'
              ? 'Weekly store sales compared with taking no action.'
              : 'Running total lost and saved compared with taking no action.'}
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Chart view"
          className="inline-flex rounded-lg border border-[#D8CEB8] bg-[#FFF8E8] p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sales'}
            data-testid="chart-tab-sales"
            onClick={() => onChangeTab('sales')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'sales'
                ? 'bg-[#25372C] text-white'
                : 'text-[#56695D] hover:text-[#25372C]'
            }`}
          >
            Sales
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'money'}
            data-testid="chart-tab-money"
            onClick={() => onChangeTab('money')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'money'
                ? 'bg-[#25372C] text-white'
                : 'text-[#56695D] hover:text-[#25372C]'
            }`}
          >
            Money
          </button>
        </div>
      </div>

      <DayByDayChartView
        points={points}
        events={events}
        totalDays={totalDays}
        mode={activeTab}
        currentDate={currentDate}
        onInspectFact={onInspectFact}
      />
    </section>
  );
}
