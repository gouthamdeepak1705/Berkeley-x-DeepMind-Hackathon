import { DayState, Fact } from '../types/domain';
import { formatShortDate } from '../engine/calendar';
import { FactValue } from './FactValue';

interface SalesChartProps {
  dayState: DayState;
  totalDays: number;
  onInspectFact: (fact: Fact) => void;
}

const CHART_WIDTH = 460;
const CHART_HEIGHT = 185;
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 34;

export function SalesChart({ dayState, totalDays, onInspectFact }: SalesChartProps) {
  const points = dayState.chartPoints;
  const plotW = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  let minVal = 140_000;
  let maxVal = 340_000;
  for (const p of points) {
    if (p.actual7d < minVal) minVal = Math.floor(p.actual7d / 20_000) * 20_000;
    if (p.bandLow < minVal) minVal = Math.floor(p.bandLow / 20_000) * 20_000;
    if (p.actual7d > maxVal) maxVal = Math.ceil(p.actual7d / 20_000) * 20_000;
    if (p.bandHigh > maxVal) maxVal = Math.ceil(p.bandHigh / 20_000) * 20_000;
  }

  const xForIndex = (idx: number) =>
    PAD_LEFT + (totalDays > 1 ? (idx / (totalDays - 1)) * plotW : 0);
  const yForValue = (val: number) =>
    PAD_TOP + plotH - ((val - minVal) / Math.max(1, maxVal - minVal)) * plotH;

  let bandPath = '';
  if (points.length > 1) {
    const upper = points.map((p, i) => `${xForIndex(i).toFixed(1)},${yForValue(p.bandHigh).toFixed(1)}`);
    const lower = points
      .slice()
      .reverse()
      .map((p, i) => {
        const origIdx = points.length - 1 - i;
        return `${xForIndex(origIdx).toFixed(1)},${yForValue(p.bandLow).toFixed(1)}`;
      });
    bandPath = `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
  }

  const expectedPath =
    points.length > 1
      ? `M ${points
          .map((p, i) => `${xForIndex(i).toFixed(1)},${yForValue(p.expected7d).toFixed(1)}`)
          .join(' L ')}`
      : '';

  const segments: { d: string; amber: boolean; key: string }[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const amber = prev.outOfBand || curr.outOfBand;
    segments.push({
      key: `${prev.date}-${curr.date}`,
      amber,
      d: `M ${xForIndex(i - 1).toFixed(1)},${yForValue(prev.actual7d).toFixed(1)} L ${xForIndex(i).toFixed(1)},${yForValue(curr.actual7d).toFixed(1)}`,
    });
  }

  const lastPt = points[points.length - 1];
  const lastX = xForIndex(points.length - 1);
  const lastY = yForValue(lastPt.actual7d);

  const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];
  const axisMarkers = [
    { idx: 0, label: 'Aug 1', event: 'Lull' },
    { idx: 37, label: 'Sep 7', event: 'Labor Day' },
    { idx: 61, label: 'Oct 1', event: '' },
    { idx: 92, label: 'Nov 1', event: '' },
  ];

  const { total28dSales, total28dChangePct, lfl28dVsExpectedPct } = dayState.headlineFacts;

  return (
    <section aria-label="Sales this week against what was expected" className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="text-xs font-semibold text-[#57534E]">
          Sales this week against what was expected
        </h2>
        <span className="text-xs font-mono tabular-nums text-[#57534E] whitespace-nowrap shrink-0">
          Comparable stores:{' '}
          <FactValue fact={lfl28dVsExpectedPct} onInspect={onInspectFact} />
        </span>
      </div>

      <div className="bg-white border border-[#E6E1D8] rounded-xl p-3">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label={`Sales this week against what was expected through ${dayState.date}`}
        >
          {yTicks.map((val) => {
            const y = yForValue(val);
            return (
              <g key={val}>
                <line
                  x1={PAD_LEFT}
                  x2={CHART_WIDTH - PAD_RIGHT}
                  y1={y}
                  y2={y}
                  stroke="#E6E1D8"
                  strokeWidth="1"
                />
                <text
                  x={PAD_LEFT - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-[#78716C] text-[10px] font-mono tabular-nums"
                >
                  ${Math.round(val / 1000)}k
                </text>
              </g>
            );
          })}

          <rect
            x={xForIndex(0)}
            y={PAD_TOP}
            width={Math.max(0, xForIndex(37) - xForIndex(0))}
            height={plotH}
            fill="#F3F0EA"
            opacity="0.55"
          />

          <rect
            x={xForIndex(35)}
            y={PAD_TOP}
            width={Math.max(2, xForIndex(37) - xForIndex(35))}
            height={plotH}
            fill="#E6E1D8"
            opacity="0.85"
          />

          {bandPath && <path d={bandPath} fill="#312E81" opacity="0.10" />}

          {expectedPath && (
            <path
              d={expectedPath}
              fill="none"
              stroke="#78716C"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.7"
            />
          )}

          {segments.map((seg) => (
            <path
              key={seg.key}
              d={seg.d}
              fill="none"
              stroke={seg.amber ? '#B45309' : '#312E81'}
              strokeWidth="2.25"
              strokeLinecap="round"
            />
          ))}

          <circle
            cx={lastX}
            cy={lastY}
            r="3.5"
            fill={lastPt.outOfBand ? '#B45309' : '#312E81'}
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />

          {axisMarkers.map((m) => {
            const x = xForIndex(m.idx);
            return (
              <g key={m.label}>
                <line
                  x1={x}
                  x2={x}
                  y1={PAD_TOP + plotH}
                  y2={PAD_TOP + plotH + 4}
                  stroke="#A8A29E"
                  strokeWidth="1"
                />
                <text
                  x={x}
                  y={PAD_TOP + plotH + 15}
                  textAnchor={m.idx === 0 ? 'start' : 'middle'}
                  className="fill-[#78716C] text-[10px] font-mono"
                >
                  {m.label}
                </text>
                {m.event && (
                  <text
                    x={x}
                    y={PAD_TOP + plotH + 26}
                    textAnchor={m.idx === 0 ? 'start' : 'middle'}
                    className="fill-[#57534E] text-[9px]"
                  >
                    {m.event}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div className="mt-2 pt-2.5 border-t border-[#E6E1D8] flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E]">
          <span>
            Last 28 days, all stores:{' '}
            <FactValue
              fact={total28dSales}
              onInspect={onInspectFact}
              className="font-semibold text-[#171717]"
            />{' '}
            (<FactValue
              fact={total28dChangePct}
              onInspect={onInspectFact}
              className="font-semibold text-[#171717]"
            />{' '}
            vs last year)
          </span>
          <span className="text-[11px] font-mono text-[#78716C] shrink-0">
            {formatShortDate(dayState.date)}
          </span>
        </div>
      </div>
    </section>
  );
}
