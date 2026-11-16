import { useState } from 'react';
import { Eye, Search, Wrench, X } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { DayState, TraceLane } from '../../types/domain';
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

export function TeamPanel({
  dayState,
  activeInvestigation,
  builderProgressByCandidate,
}: TeamPanelProps) {
  const [openLane, setOpenLane] = useState<TraceLane | null>(null);

  const builderActive = Object.keys(builderProgressByCandidate).length > 0;

  const getNowText = (lane: TraceLane): string => {
    if (lane === 'developer') {
      if (builderActive) return 'Building and testing the refund desk.';
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
      return 'Ready when an unusual drop appears.';
    }
    // Manager
    if (dayState.raised.length > 0) {
      return `Raised ${dayState.raised.length} warning for your decision.`;
    }
    return 'Watching all 10 stores today.';
  };

  const getEntriesForLane = (lane: TraceLane) =>
    dayState.trace
      .filter((t) => t.lane === lane)
      .slice(-20)
      .reverse();

  const openRole = ROLES.find((r) => r.lane === openLane) ?? null;

  return (
    <section aria-labelledby="team-panel-heading" className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="team-panel-heading" className="text-base font-semibold text-[#25372C]">
          Your three helpers
        </h2>
        <span className="text-xs text-[#56695D]">Tap any helper to see its log</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ROLES.map((role) => {
          const Icon = role.icon;
          const count = dayState.trace.filter((t) => t.lane === role.lane).length;
          return (
            <button
              key={role.lane}
              type="button"
              onClick={() => setOpenLane(role.lane)}
              className="text-left bg-white hover:bg-[#FFFDF7] border border-[#E5DCC7] rounded-2xl p-3.5 space-y-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#25372C]">
                  <Icon className="w-4 h-4 text-[#25372C]" />
                  {role.title}
                </span>
                <span className="text-xs text-[#56695D]">
                  {count} {count === 1 ? 'note' : 'notes'}
                </span>
              </div>
              <p className="text-xs text-[#56695D] leading-snug">{role.roleLine}</p>
              <p className="text-xs font-medium text-[#25372C] pt-0.5">Now: {getNowText(role.lane)}</p>
            </button>
          );
        })}
      </div>

      {openRole && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-log-title"
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
              {getEntriesForLane(openRole.lane).length === 0 ? (
                <p className="text-sm text-[#56695D]">No entries recorded yet.</p>
              ) : (
                getEntriesForLane(openRole.lane).map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl bg-white border border-[#E5DCC7] text-xs space-y-1"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-[#25372C]">
                        {toSimpleEnglish(entry.headline)}
                      </span>
                      <span className="text-[#56695D] shrink-0">
                        {formatShortDate(entry.date)}
                      </span>
                    </div>
                    <p className="text-[#43564A] leading-snug">
                      {toSimpleEnglish(entry.detail)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
