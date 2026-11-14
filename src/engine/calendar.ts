export const HISTORY_START_DATE = '2025-01-01';
export const LIVE_START_DATE = '2026-08-01';
export const LIVE_END_DATE = '2026-11-14';

export interface CalendarEventSpan {
  id: string;
  label: string;
  kind: 'season' | 'event';
  year: 2025 | 2026;
  startDate: string;
  endDate: string;
  factor: number;
}

export const TRADING_CALENDAR: CalendarEventSpan[] = [
  {
    id: 'january_dip_2025',
    label: 'January winter lull',
    kind: 'season',
    year: 2025,
    startDate: '2025-01-01',
    endDate: '2025-01-31',
    factor: 0.80,
  },
  {
    id: 'summer_lull_2025',
    label: 'Summer lull',
    kind: 'season',
    year: 2025,
    startDate: '2025-08-01',
    endDate: '2025-09-07',
    factor: 0.70,
  },
  {
    id: 'labor_day_2025',
    label: 'Labor Day weekend',
    kind: 'event',
    year: 2025,
    startDate: '2025-08-30',
    endDate: '2025-09-01',
    factor: 1.35,
  },
  {
    id: 'thanksgiving_2025',
    label: 'Thanksgiving to Cyber Monday',
    kind: 'event',
    year: 2025,
    startDate: '2025-11-27',
    endDate: '2025-12-01',
    factor: 1.60,
  },
  {
    id: 'december_peak_2025',
    label: 'December holiday peak',
    kind: 'season',
    year: 2025,
    startDate: '2025-12-01',
    endDate: '2025-12-31',
    factor: 1.25,
  },
  {
    id: 'january_dip_2026',
    label: 'January winter lull',
    kind: 'season',
    year: 2026,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    factor: 0.80,
  },
  {
    id: 'summer_lull_2026',
    label: 'Summer lull',
    kind: 'season',
    year: 2026,
    startDate: '2026-08-01',
    endDate: '2026-09-07',
    factor: 0.70,
  },
  {
    id: 'labor_day_2026',
    label: 'Labor Day weekend',
    kind: 'event',
    year: 2026,
    startDate: '2026-09-05',
    endDate: '2026-09-07',
    factor: 1.35,
  },
  {
    id: 'thanksgiving_2026',
    label: 'Thanksgiving to Cyber Monday',
    kind: 'event',
    year: 2026,
    startDate: '2026-11-26',
    endDate: '2026-11-30',
    factor: 1.60,
  },
];

// Mon=0 .. Sun=6 -> 0.75, 0.78, 0.82, 0.90, 1.10, 1.45, 1.20
export const WEEKDAY_FACTORS = [0.75, 0.78, 0.82, 0.90, 1.10, 1.45, 1.20] as const;
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseDateUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatDateUTC(dt);
}

export function diffDays(startStr: string, endStr: string): number {
  const ms = parseDateUTC(endStr).getTime() - parseDateUTC(startStr).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * 0 = Monday .. 6 = Sunday
 */
export function getIsoWeekdayIndex(dateStr: string): number {
  const day = parseDateUTC(dateStr).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 6 : day - 1;
}

export function formatDisplayDate(dateStr: string): string {
  const dt = parseDateUTC(dateStr);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatShortDate(dateStr: string): string {
  const dt = parseDateUTC(dateStr);
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function enumerateDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function getIsoWeekKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getSeasonSpanForDate(dateStr: string): CalendarEventSpan | null {
  for (const span of TRADING_CALENDAR) {
    if (span.kind === 'season' && dateStr >= span.startDate && dateStr <= span.endDate) {
      return span;
    }
  }
  return null;
}

export function getSeasonFactor(dateStr: string): number {
  const span = getSeasonSpanForDate(dateStr);
  return span ? span.factor : 1.0;
}

export function getEventSpanForDate(dateStr: string): CalendarEventSpan | null {
  for (const span of TRADING_CALENDAR) {
    if (span.kind === 'event' && dateStr >= span.startDate && dateStr <= span.endDate) {
      return span;
    }
  }
  return null;
}

export function getEventFactor(dateStr: string): number {
  const span = getEventSpanForDate(dateStr);
  return span ? span.factor : 1.00;
}

export function getCalendarSpansOverlappingRange(
  startDate: string,
  endDate: string,
): CalendarEventSpan[] {
  return TRADING_CALENDAR.filter(
    (span) => startDate <= span.endDate && endDate >= span.startDate,
  );
}

export function getCalendarLabelsForDate(dateStr: string): string[] {
  const labels: string[] = [];
  for (const span of TRADING_CALENDAR) {
    if (dateStr >= span.startDate && dateStr <= span.endDate) {
      labels.push(span.label);
    }
  }
  return labels;
}

/**
 * Matching day in the prior year for expected sales:
 * - If dateStr is an event day (e.g. Labor Day Sat/Sun/Mon 2026), match the same day offset of the same event in 2025.
 * - Otherwise, take same weekday 364 days earlier. If that 364-day counterpart was an event day, step back another 7 days (371 days earlier).
 */
export function getMatchingPriorYearDate(dateStr: string): {
  matchedDate: string;
  reason: string;
} {
  const currentEvent = getEventSpanForDate(dateStr);
  if (currentEvent) {
    const offset = diffDays(currentEvent.startDate, dateStr);
    const baseEventId = currentEvent.id.replace(/_\d{4}$/, '');
    const priorEvent = TRADING_CALENDAR.find(
      (s) => s.kind === 'event' && s.year === currentEvent.year - 1 && s.id.startsWith(baseEventId),
    );
    if (priorEvent) {
      return {
        matchedDate: addDays(priorEvent.startDate, offset),
        reason: `Matched day ${offset + 1} of ${currentEvent.label} (${currentEvent.year - 1})`,
      };
    }
  }

  const candidate364 = addDays(dateStr, -364);
  const candidateEvent = getEventSpanForDate(candidate364);
  if (candidateEvent) {
    return {
      matchedDate: addDays(candidate364, -7),
      reason: `364 days earlier (${candidate364}) was ${candidateEvent.label}; stepped back 1 week`,
    };
  }

  return {
    matchedDate: candidate364,
    reason: `Same weekday 364 days earlier (${candidate364})`,
  };
}
