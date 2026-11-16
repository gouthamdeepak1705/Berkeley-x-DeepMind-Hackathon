import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DayState, Fact } from '../../types/domain';
import { FactValue } from '../FactValue';
import { DayByDayChartView } from './DayByDayChartCard';
import { formatWholeUsd, ProofPill } from './SimpleHelpers';

interface SimpleResultPageProps {
  dayState: DayState;
  onInspectFact: (fact: Fact) => void;
  onRunAgainAndSayNo: () => void;
  onShowTechnicalDetail: () => void;
}

export function SimpleResultPage({
  dayState,
  onInspectFact,
  onRunAgainAndSayNo,
  onShowTechnicalDetail,
}: SimpleResultPageProps) {
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({});
  const account = dayState.moneyAccount;
  const statement = dayState.endStatement;

  if (!account || !statement) return null;

  const toggleProblem = (id: string) => {
    setExpandedProblems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const { workCounters } = account;
  const unprovenProblems = account.byProblem.filter(
    (p) => p.proofStatus === 'likely' || p.proofStatus === 'none',
  );

  return (
    <section
      data-testid="simple-result-page"
      data-tour-target="result_page"
      aria-labelledby="simple-result-heading"
      className="bg-white border-2 border-[#25372C] rounded-2xl p-5 sm:p-7 space-y-6 shadow-xs"
    >
      {/* 1. Headline & Big Money Comparison */}
      <div className="space-y-2 pb-5 border-b border-[#E5DCC7]">
        <p className="text-xs font-medium text-[#56695D]">14 November 2026 · 106-day season summary</p>
        <h2 id="simple-result-heading" className="text-2xl font-semibold text-[#25372C]">
          What Opscien saved across 10 stores
        </h2>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
            <p className="text-xs text-[#56695D]">Lost without Opscien</p>
            <p className="mt-1 text-2xl font-semibold text-[#25372C]">
              <FactValue
                fact={account.withoutOpscienFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
              />
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA]">
            <p className="text-xs text-[#5C3A36]">Lost with Opscien</p>
            <p className="mt-1 text-2xl font-semibold text-[#991B1B]">
              <FactValue
                fact={account.lostSoFarFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
              />
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[#F4FBF6] border border-[#BBF7D0]">
            <p className="text-xs text-[#14532D]">Opscien saved</p>
            <p className="mt-1 text-2xl font-semibold text-[#15803D]">
              <FactValue
                fact={account.savedSoFarFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
              />
            </p>
            <p className="mt-1 text-xs text-[#43564A]">
              From proven actions:{' '}
              <FactValue
                fact={account.savedProvenFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
              />{' '}
              · From likely actions:{' '}
              <FactValue
                fact={account.savedLikelyFact}
                onInspect={onInspectFact}
                noPlus
                plainFont
              />
            </p>
          </div>
        </div>

        {account.dayByDayPoints && account.dayByDayPoints.length > 0 && (
          <div className="pt-4">
            <DayByDayChartView
              points={account.dayByDayPoints}
              events={account.dayByDayEvents ?? []}
              totalDays={dayState.totalDays}
              mode="money"
              currentDate={dayState.date}
              onInspectFact={onInspectFact}
            />
          </div>
        )}
      </div>

      {/* 2. Where the money was saved and lost */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-[#25372C]">
          Where the money was saved and lost
        </h3>
        <div className="space-y-2">
          {account.byProblem.map((pb) => {
            const isOpen = !!expandedProblems[pb.problemId];
            return (
              <div
                key={pb.problemId}
                className="rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] p-3.5 text-xs space-y-2"
              >
                <button
                  type="button"
                  onClick={() => toggleProblem(pb.problemId)}
                  className="w-full text-left flex items-start justify-between gap-2 cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-sm text-[#25372C]">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 shrink-0" />
                      )}
                      <span>{pb.title}</span>
                    </div>
                    <p className="text-[#56695D] mt-0.5">
                      {pb.storeNames} · {pb.decisionLabel}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-[#15803D]">
                      Saved {formatWholeUsd(pb.savedFact.value)}
                    </p>
                    <p className="text-[#991B1B]">
                      Lost {formatWholeUsd(pb.lostSoFarFact.value)}
                    </p>
                  </div>
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ProofPill proof={pb.proofStatus} />
                  <span className="text-[#56695D]">Loss note: {pb.lossReason}</span>
                </div>

                {isOpen && (
                  <div className="pt-2 border-t border-[#EFE8D6] space-y-1.5">
                    {pb.stores.map((st) => (
                      <div
                        key={`res-${pb.problemId}-${st.storeId}`}
                        className="p-2 rounded-lg bg-white border border-[#EFE8D6] flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-medium text-[#25372C]">{st.storeName}</span>
                          <span className="ml-2 text-[#56695D]">({st.lossReason})</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span>
                            Without:{' '}
                            <FactValue
                              fact={st.withoutOpscienFact}
                              onInspect={onInspectFact}
                              noPlus
                              plainFont
                            />
                          </span>
                          <span className="text-[#991B1B]">
                            Lost:{' '}
                            <FactValue
                              fact={st.lostSoFarFact}
                              onInspect={onInspectFact}
                              noPlus
                              plainFont
                            />
                          </span>
                          <span className="text-[#15803D] font-semibold">
                            Saved:{' '}
                            <FactValue
                              fact={st.savedFact}
                              onInspect={onInspectFact}
                              noPlus
                              plainFont
                            />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. How well it noticed */}
      <div className="space-y-2.5 pt-4 border-t border-[#E5DCC7]">
        <h3 className="text-base font-semibold text-[#25372C]">How well it noticed</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-3 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
            <p className="text-[#56695D]">Real problems raised</p>
            <p className="mt-1 text-base font-semibold text-[#15803D]">
              <FactValue fact={statement.noticing.realRaisedFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              of{' '}
              <FactValue fact={statement.noticing.realTotalFact} onInspect={onInspectFact} noPlus plainFont />
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
            <p className="text-[#56695D]">Typical time before running out</p>
            <p className="mt-1 text-base font-semibold text-[#25372C]">
              <FactValue fact={statement.noticing.medianDaysEarlyFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              early
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
            <p className="text-[#56695D]">Things that looked like problems but were not</p>
            <p className="mt-1 text-base font-semibold text-[#15803D]">
              <FactValue fact={statement.noticing.lookAlikesRaisedFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              of{' '}
              <FactValue fact={statement.noticing.lookAlikesTotalFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              raised
            </p>
          </div>
        </div>
      </div>

      {/* 4. What it did for you */}
      <div className="space-y-2.5 pt-4 border-t border-[#E5DCC7]">
        <h3 className="text-base font-semibold text-[#25372C]">What it did for you</h3>
        <p className="text-sm text-[#43564A] leading-relaxed">
          Moved{' '}
          <FactValue fact={workCounters.unitsMovedFact} onInspect={onInspectFact} noPlus plainFont className="font-semibold text-[#25372C]" />{' '}
          between stores without buying any extra stock. Asked you{' '}
          <FactValue fact={workCounters.askedOwnerFact} onInspect={onInspectFact} noPlus plainFont className="font-semibold text-[#25372C]" />{' '}
          {workCounters.askedOwnerFact.value === 1 ? 'time' : 'times'}. Acted alone within your limits{' '}
          <FactValue fact={workCounters.actedAloneFact} onInspect={onInspectFact} noPlus plainFont className="font-semibold text-[#25372C]" />{' '}
          {workCounters.actedAloneFact.value === 1 ? 'time' : 'times'}. Built and checked{' '}
          <FactValue fact={workCounters.toolsBuiltFact} onInspect={onInspectFact} noPlus plainFont className="font-semibold text-[#25372C]" />{' '}
          store {workCounters.toolsBuiltFact.value === 1 ? 'tool' : 'tools'}.
        </p>
      </div>

      {/* 5. What it could not prove */}
      <div className="space-y-2 pt-4 border-t border-[#E5DCC7]">
        <h3 className="text-base font-semibold text-[#25372C]">What it could not prove</h3>
        {unprovenProblems.length === 0 ? (
          <p className="text-sm text-[#43564A]">Every gain in this run was checked against a store held back for comparison.</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-[#43564A]">
            {unprovenProblems.map((pb) => (
              <li key={`unp-${pb.problemId}`} className="p-3 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
                <span className="font-semibold text-[#25372C]">{pb.title}</span> — Saved{' '}
                <FactValue fact={pb.savedFact} onInspect={onInspectFact} noPlus plainFont />.{' '}
                Likely, not proven: measured before and after at one store.
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. Honesty note */}
      <div className="p-4 rounded-xl bg-[#FFF8E8] border border-[#E5DCC7] text-xs text-[#43564A] leading-relaxed">
        <strong className="text-[#25372C]">Honesty note:</strong> A real business cannot be run
        twice. That is why Opscien holds one store back to prove a result. Linden &amp; Rye is a
        simulated 10-store clothing business over 106 days. Real stores also face supplier delays,
        damaged stock, and uneven local traffic. Every number here comes directly from the simulated
        till records and stock ledgers.
      </div>

      {/* 7. Action buttons */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          data-testid="run-again-say-no-btn"
          onClick={onRunAgainAndSayNo}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#25372C] hover:bg-[#1C2A21] text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Run it again and say no</span>
        </button>

        <button
          type="button"
          onClick={onShowTechnicalDetail}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-[#F5EEDD] border border-[#D8CEB8] text-[#25372C] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Show technical detail</span>
        </button>
      </div>

      {/* 8. Footer */}
      <div className="pt-4 border-t border-[#E5DCC7] text-xs text-[#56695D]">
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
      </div>
    </section>
  );
}
