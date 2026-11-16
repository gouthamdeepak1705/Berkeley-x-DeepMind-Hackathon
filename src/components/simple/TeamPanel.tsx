import { useEffect, useState } from 'react';
import { Eye, Search, Wrench, X } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { DayState, TraceEntry, TraceLane } from '../../types/domain';
import { ActiveInvestigationBanner } from '../OwnerFeed';
import { toSimpleEnglish } from './SimpleHelpers';

interface TeamPanelProps {
  dayState: DayState;
  activeInvestigation: ActiveInvestigationBanner | null;
  builderProgressByCandidate: Record<string, string>;
}

interface RoleConfig {
  lane: TraceLane;
  title: string;
  roleLine: string;
  icon: typeof Eye;
}

const ROLES: RoleConfig[] = [
  {
    lane: 'manager',
    title: 'Manager',
    roleLine: 'Watches daily trading and lets normal swings pass.',
    icon: Eye,
  },
  {
    lane: 'data_scientist',
    title: 'Data scientist',
    roleLine: 'Checks why sales changed and sets up safe comparisons.',
    icon: Search,
  },
  {
    lane: 'developer',
    title: 'Developer',
    roleLine: 'Builds store tools and tests them three times before handover.',
    icon: Wrench,
  },
];

function stripTechnicalNoise(text: string): string {
  return toSimpleEnglish(
    text
      .replace(/Model\s+[a-z0-9._-]+/gi, '')
      .replace(/\bgemini-[a-z0-9._-]+/gi, '')
      .replace(/\bOpscien-[a-z0-9._-]+/gi, '')
      .replace(/\([^)]*\b\d+\s*ms\b[^)]*\)/gi, '')
      .replace(/\b\d+\s*ms\b/gi, '')
      .replace(/\b(replayed|recorded|live|fallback|code)\s*,\s*/gi, '')
      .replace(/\(\s*(replayed|recorded|live|fallback|code)\s*\)/gi, '')
      .replace(/Facts returned:\s*[^\n.]+\.?/gi, '')
      .replace(/\b[a-z]+(?:_[a-z0-9]+)+(?:\([^)]*\))?/g, (match) =>
        match.replace(/_/g, ' ').replace(/\([^)]*\)/g, ''),
      )
      .replace(/\b(?:fact|tool|sit|situation|trace|dec|rollout|vis|td|money|work|sb|inprog|proof|proofbar|record):[a-z0-9_:-]+/gi, '')
      .replace(/\s*·\s*·\s*/g, ' · ')
      .replace(/^\s*[·:\-]+\s*/, '')
      .replace(/\s{2,}/g, ' ')
      .trim(),
  );
}

export function formatTraceEntryForSimple(entry: TraceEntry): {
  headline: string;
  detail: string;
} {
  const datePrefix = formatShortDate(entry.date);
  const rawHead = entry.headline ?? '';
  const rawDetail = entry.detail ?? '';
  const lowerHead = rawHead.toLowerCase();
  const lowerDetail = rawDetail.toLowerCase();

  if (entry.kind === 'tool_call') {
    if (lowerHead.includes('second check') || lowerHead.includes('python')) {
      if (lowerHead.includes('disagreed') || lowerDetail.includes('disagreed')) {
        return {
          headline: `${datePrefix}. Checked the figure a second way.`,
          detail: 'The two checks disagreed. Rechecking the store figures.',
        };
      }
      return {
        headline: `${datePrefix}. Checked the figure a second way.`,
        detail: 'Both agree.',
      };
    }
    if (lowerHead.includes('recompute_figure') || lowerHead.includes('recompute figure')) {
      return {
        headline: `${datePrefix}. Checked the main figure again from scratch.`,
        detail: 'Confirmed the weekly pace and store total from daily till records.',
      };
    }
    if (lowerHead.includes('test_calendar') || lowerHead.includes('calendar')) {
      return {
        headline: `${datePrefix}. Checked the calendar.`,
        detail:
          lowerDetail.includes('no') || lowerDetail.includes('0')
            ? 'No holiday or seasonal event explains this.'
            : 'Checked seasonal and holiday dates for this period.',
      };
    }
    if (lowerHead.includes('test_store_mix') || lowerHead.includes('store_mix') || lowerHead.includes('store mix')) {
      return {
        headline: `${datePrefix}. Checked whether new stores skewed the total.`,
        detail: 'Separated new stores from stores open more than 18 months.',
      };
    }
    if (lowerHead.includes('test_data_fault') || lowerHead.includes('data_fault') || lowerHead.includes('data fault')) {
      return {
        headline: `${datePrefix}. Checked the data for missing or broken records.`,
        detail: 'Checked for missing days, duplicate dates, or zero-sales store days.',
      };
    }
    if (lowerHead.includes('compare_with_last_year') || lowerHead.includes('last year')) {
      return {
        headline: `${datePrefix}. Compared this period against last year.`,
        detail: 'Checked how current sales compare with matching calendar days a year ago.',
      };
    }
    if (lowerHead.includes('compare_store_with_established') || lowerHead.includes('established')) {
      return {
        headline: `${datePrefix}. Compared this store with mature stores.`,
        detail: 'Checked trading pace against stores open more than 18 months.',
      };
    }
    if (lowerHead.includes('compute_transfer_plan') || lowerHead.includes('transfer_plan')) {
      return {
        headline: `${datePrefix}. Planned which stores should send stock.`,
        detail: 'Matched short stores with spare-stock stores and held back a comparison store if needed.',
      };
    }
    if (lowerHead.includes('get_stock_cover') || lowerHead.includes('stock_cover') || lowerHead.includes('stock')) {
      return {
        headline: `${datePrefix}. Checked weeks of stock left at every store.`,
        detail: 'Listed short stores and stores with stock to spare above safety limits.',
      };
    }
    if (lowerHead.includes('refund') || lowerDetail.includes('refund')) {
      return {
        headline: `${datePrefix}. Checked store till refunds.`,
        detail: 'Looked at cash refund receipts by till, hour, and staff member.',
      };
    }
    return {
      headline: `${datePrefix}. Checked the store records.`,
      detail: 'Reviewed daily till sales and stock balances.',
    };
  }

  if (entry.kind === 'decision') {
    const rows = entry.decisionRows ?? [];
    if (rows.length > 0) {
      const raised = rows.filter((r) => r.choice === 'raise_now');
      const waiting = rows.filter((r) => r.choice === 'keep_watching');
      const quiet = rows.filter((r) => r.choice === 'stay_quiet');
      if (raised.length > 0) {
        return {
          headline: `${datePrefix}. Decided to check ${raised.map((r) => toSimpleEnglish(r.title)).join(', ')}.`,
          detail: 'Looked strong enough to verify before waking you.',
        };
      }
      if (waiting.length > 0) {
        return {
          headline: `${datePrefix}. Kept watching ${waiting.length} store ${waiting.length === 1 ? 'sign' : 'signs'}.`,
          detail: 'Waiting to see whether the change lasts before asking you.',
        };
      }
      return {
        headline: `${datePrefix}. Stayed quiet on ${quiet.length} normal ${quiet.length === 1 ? 'swing' : 'swings'}.`,
        detail: 'Explained by normal calendar timing or recent actions.',
      };
    }
    return {
      headline: `${datePrefix}. Reviewed today's store checks.`,
      detail: stripTechnicalNoise(rawDetail) || 'Checked whether anything needed your attention.',
    };
  }

  if (entry.kind === 'investigation') {
    if (lowerHead.includes('let go')) {
      return {
        headline: `${datePrefix}. Checked and stayed quiet.`,
        detail: 'Found no real problem worth asking you about.',
      };
    }
    const cleanTopic = stripTechnicalNoise(rawHead.replace(/^Confirmed:\s*/i, ''));
    return {
      headline: `${datePrefix}. Checked ${cleanTopic || 'this change'} and found the cause.`,
      detail:
        stripTechnicalNoise(rawDetail.replace(/Outcome:[^·.]*[·.]?/i, '')) ||
        'Prepared a clear suggestion within your safety limits.',
    };
  }

  if (entry.kind === 'followup') {
    if (lowerHead.includes('proof calculation') || lowerHead.includes('proven')) {
      return {
        headline: `${datePrefix}. Compared stores that got stock with the store held back.`,
        detail:
          stripTechnicalNoise(rawDetail) ||
          'Stores that received stock kept selling, proving the transfer worked.',
      };
    }
    if (lowerHead.includes('7-day checkpoint') || lowerHead.includes('before-and-after')) {
      return {
        headline: `${datePrefix}. Completed the 7-day check after stock arrived.`,
        detail: stripTechnicalNoise(rawDetail) || 'Checked sales and remaining stock after arrival.',
      };
    }
    return {
      headline: `${datePrefix}. ${stripTechnicalNoise(rawHead) || 'Updated progress check.'}`,
      detail: stripTechnicalNoise(rawDetail) || 'Checked progress on active actions.',
    };
  }

  if (entry.kind === 'gateway') {
    return {
      headline: `${datePrefix}. Checked all safety limits.`,
      detail:
        stripTechnicalNoise(rawDetail) ||
        'Confirmed every spare-stock store keeps enough to reach its next delivery.',
    };
  }

  if (entry.kind === 'builder') {
    if (lowerHead.startsWith('requirement written:')) {
      return {
        headline: `${datePrefix}. Wrote the plan for the store refund desk.`,
        detail: 'Set out what the screen must show, who uses it, and how it is tested.',
      };
    }
    if (lowerHead.startsWith('tool written from fallback copy')) {
      return {
        headline: `${datePrefix}. Prepared backup copy for the store refund desk.`,
        detail: 'Used the tested backup screen layout and readied it for checks.',
      };
    }
    if (lowerHead.startsWith('tool written by')) {
      return {
        headline: `${datePrefix}. Built the store refund desk screen.`,
        detail: 'Wrote the single-file refund check screen and readied it for testing.',
      };
    }
    if (lowerHead.includes('repair')) {
      return {
        headline: `${datePrefix}. Fixed and retested the store refund desk.`,
        detail: 'Updated the screen after the first check caught a fault.',
      };
    }
    if (lowerHead.includes('failed twice')) {
      return {
        headline: `${datePrefix}. Stopped before installing the refund desk.`,
        detail: 'Two sandbox checks failed, so nothing was installed.',
      };
    }
    if (lowerHead.includes('verified & installed') || lowerHead.includes('installed')) {
      return {
        headline: `${datePrefix}. Tested and installed the Walnut Creek refund desk.`,
        detail: 'Passed all three checks inside the sandbox before handover.',
      };
    }
    return {
      headline: `${datePrefix}. Built and checked the Walnut Creek refund desk.`,
      detail: 'Wrote the screen and tested it three times before handover.',
    };
  }

  if (entry.kind === 'silence_check') {
    return {
      headline: `${datePrefix}. Checked the calendar and trading rules.`,
      detail: stripTechnicalNoise(rawDetail) || 'Normal pattern. Stayed quiet.',
    };
  }

  return {
    headline: `${datePrefix}. ${stripTechnicalNoise(rawHead) || 'Updated daily log.'}`,
    detail: stripTechnicalNoise(rawDetail) || 'Logged activity for this day.',
  };
}

export function TeamPanel({
  dayState,
  activeInvestigation,
  builderProgressByCandidate,
}: TeamPanelProps) {
  const [openLane, setOpenLane] = useState<TraceLane | null>(null);

  useEffect(() => {
    if (!openLane) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenLane(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openLane]);

  const builderActive = Object.keys(builderProgressByCandidate).length > 0;
  const activeLane: TraceLane = builderActive
    ? 'developer'
    : activeInvestigation
      ? 'data_scientist'
      : 'manager';

  const getNowText = (lane: TraceLane): string => {
    if (lane === 'developer') {
      if (builderActive) return 'Building the refund desk.';
      if ((dayState.builtTools?.length ?? 0) > 0) {
        return `Installed ${dayState.builtTools!.length} store desk.`;
      }
      return 'Standing by for tool requests.';
    }
    if (lane === 'data_scientist') {
      if (activeInvestigation) return `Checking ${toSimpleEnglish(activeInvestigation.title)}.`;
      if ((dayState.inProgress?.length ?? 0) > 0) {
        return 'Measuring results while actions run.';
      }
      return 'Ready if a surprise appears.';
    }
    if (dayState.raised.length > 0) {
      return `Raised ${dayState.raised.length} ${dayState.raised.length === 1 ? 'card' : 'cards'} for you.`;
    }
    return 'Watching all 10 stores today.';
  };

  const getFormattedEntriesForLane = (lane: TraceLane) => {
    const sorted = dayState.trace
      .filter((t) => t.lane === lane)
      .slice()
      .sort((a, b) => (a.date === b.date ? 0 : b.date.localeCompare(a.date)));
    const seen = new Set<string>();
    const out: Array<{ id: string; headline: string; detail: string }> = [];
    for (const entry of sorted) {
      const formatted = formatTraceEntryForSimple(entry);
      const dedupeKey = `${formatted.headline}::${formatted.detail}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ id: entry.id, ...formatted });
      if (out.length >= 20) break;
    }
    return out;
  };

  const openRole = ROLES.find((r) => r.lane === openLane) ?? null;

  return (
    <section
      aria-labelledby="team-panel-heading"
      data-testid="team-panel"
      className="space-y-1.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="team-panel-heading" className="text-xs font-semibold text-[#56695D]">
          Your three helpers
        </h2>
        <span className="text-[11px] text-[#56695D]">Tap any helper to see its log</span>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-1 sm:pb-0 sm:grid sm:grid-cols-3 sm:overflow-visible">
        {ROLES.map((role) => {
          const Icon = role.icon;
          const count = dayState.trace.filter((t) => t.lane === role.lane).length;
          const isCurrent = role.lane === activeLane;
          return (
            <button
              key={role.lane}
              type="button"
              data-testid={`team-helper-${role.lane}`}
              onClick={() => setOpenLane(role.lane)}
              className={`min-w-[235px] sm:min-w-0 shrink-0 sm:shrink text-left rounded-xl px-3 py-2.5 space-y-1 transition-colors cursor-pointer border shadow-2xs ${
                isCurrent
                  ? 'bg-[#F4F8F5] border-[#25372C]/40 hover:bg-[#ECF4EE]'
                  : 'bg-white border-[#E5DCC7] hover:bg-[#FFFDF7]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#25372C]">
                  <Icon className="w-3.5 h-3.5 text-[#25372C]" />
                  {role.title}
                </span>
                <span className="text-[11px] text-[#56695D]">
                  {count} {count === 1 ? 'note' : 'notes'}
                </span>
              </div>
              <p className="text-[11px] text-[#56695D] leading-snug line-clamp-1">{role.roleLine}</p>
              <p className="text-[11px] font-medium text-[#25372C] truncate">
                Now: {getNowText(role.lane)}
              </p>
            </button>
          );
        })}
      </div>

      {openRole && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-log-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenLane(null);
          }}
          className="fixed inset-0 z-50 bg-[#25372C]/35 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="bg-[#FFF8E8] border border-[#D8CEB8] rounded-2xl max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-xl">
            <div className="px-5 py-4 bg-white border-b border-[#E5DCC7] flex items-center justify-between gap-3">
              <div>
                <h3 id="team-log-title" className="text-base font-semibold text-[#25372C]">
                  {openRole.title} activity log
                </h3>
                <p className="text-xs text-[#56695D]">{openRole.roleLine}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenLane(null)}
                aria-label="Close helper log"
                className="p-1.5 rounded-lg border border-[#E5DCC7] bg-white hover:bg-[#F5EEDD] text-[#56695D] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2">
              {(() => {
                const items = getFormattedEntriesForLane(openRole.lane);
                if (items.length === 0) {
                  return <p className="text-sm text-[#56695D]">No entries recorded yet.</p>;
                }
                return items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-white border border-[#E5DCC7] text-xs space-y-1"
                  >
                    <p className="font-semibold text-[#25372C] leading-snug">{item.headline}</p>
                    <p className="text-[#43564A] leading-snug">{item.detail}</p>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
