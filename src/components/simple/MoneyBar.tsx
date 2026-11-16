import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { Fact, MoneyAccountData } from '../../types/domain';
import { FactValue } from '../FactValue';
import { AnimatedUsd, formatWholeUsd, ProofPill } from './SimpleHelpers';

interface MoneyBarProps {
  moneyAccount: MoneyAccountData;
  onInspectFact: (fact: Fact) => void;
}

export function MoneyBar({ moneyAccount, onInspectFact }: MoneyBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<'problem' | 'store'>('problem');
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({});

  const toggleProblem = (id: string) => {
    setExpandedProblems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const { workCounters } = moneyAccount;

  return (
    <>
      <section
        aria-label="Money account"
        data-testid="simple-money-bar"
        className="sticky top-0 z-30 bg-[#FFF8E8]/95 backdrop-blur-xs border-b border-[#E5DCC7] shadow-2xs"
      >
        <div className="max-w-[1220px] mx-auto px-4 sm:px-6 py-2.5 sm:py-3 space-y-2">
          {/* Three headline money cards — compact 3-column row even at 390px */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3.5">
            {/* 1. Saved so far */}
            <div className="bg-white border border-[#CFE0D4] rounded-xl px-2.5 py-2 sm:px-4 sm:py-3 flex flex-col justify-between">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] sm:text-xs font-medium text-[#43564A]">
                  Saved so far
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="hidden sm:inline text-[11px] font-medium text-[#15803D] hover:underline cursor-pointer"
                >
                  See breakdown
                </button>
              </div>
              <p className="mt-0.5 text-lg sm:text-3xl font-semibold text-[#15803D] leading-tight">
                <AnimatedUsd
                  fact={moneyAccount.savedSoFarFact}
                  onInspect={onInspectFact}
                  className="text-[#15803D]"
                />
              </p>
              <p className="hidden sm:block mt-1 text-xs text-[#56695D]">
                Proven:{' '}
                <FactValue
                  fact={moneyAccount.savedProvenFact}
                  onInspect={onInspectFact}
                  noPlus
                  plainFont
                  className="text-[#25372C] font-medium"
                />{' '}
                · Likely:{' '}
                <FactValue
                  fact={moneyAccount.savedLikelyFact}
                  onInspect={onInspectFact}
                  noPlus
                  plainFont
                  className="text-[#25372C] font-medium"
                />
              </p>
            </div>

            {/* 2. Lost so far */}
            <div className="bg-white border border-[#EBD2CC] rounded-xl px-2.5 py-2 sm:px-4 sm:py-3 flex flex-col justify-between">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] sm:text-xs font-medium text-[#5C3A36]">
                  Lost so far
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="hidden sm:inline text-[11px] font-medium text-[#991B1B] hover:underline cursor-pointer"
                >
                  See why
                </button>
              </div>
              <p className="mt-0.5 text-lg sm:text-3xl font-semibold text-[#991B1B] leading-tight">
                <AnimatedUsd
                  fact={moneyAccount.lostSoFarFact}
                  onInspect={onInspectFact}
                  className="text-[#991B1B] hover:text-[#7F1D1D]"
                />
              </p>
              <p className="hidden sm:block mt-1 text-xs text-[#56695D]">
                Without Opscien:{' '}
                <FactValue
                  fact={moneyAccount.withoutOpscienFact}
                  onInspect={onInspectFact}
                  noPlus
                  plainFont
                  className="text-[#25372C] font-medium"
                />
              </p>
            </div>

            {/* 3. At risk now */}
            <div className="bg-white border border-[#E7DEC8] rounded-xl px-2.5 py-2 sm:px-4 sm:py-3 flex flex-col justify-between">
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[11px] sm:text-xs font-medium text-[#6B4F1D]">
                  At risk now
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  className="sm:hidden text-[11px] font-medium text-[#25372C] underline cursor-pointer"
                >
                  Details
                </button>
              </div>
              <p className="mt-0.5 text-lg sm:text-3xl font-semibold text-[#B45309] leading-tight">
                <AnimatedUsd
                  fact={moneyAccount.atRiskNowFact}
                  onInspect={onInspectFact}
                  className="text-[#B45309] hover:text-[#92400E]"
                />
              </p>
              <p className="hidden sm:block mt-1 text-xs text-[#56695D]">
                {moneyAccount.atRiskNowFact.value > 0
                  ? 'Weekly loss waiting on open cards'
                  : 'No open losses waiting today'}
              </p>
            </div>
          </div>

          {/* Quiet work counters line */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#56695D]">
            <p className="leading-snug">
              Checked <FactValue fact={workCounters.signalsCheckedFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              {workCounters.signalsCheckedFact.value === 1 ? 'signal' : 'signals'}. Stayed quiet on{' '}
              <FactValue fact={workCounters.stayedQuietFact} onInspect={onInspectFact} noPlus plainFont />. Asked you{' '}
              <FactValue fact={workCounters.askedOwnerFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              {workCounters.askedOwnerFact.value === 1 ? 'time' : 'times'}. Acted alone{' '}
              <FactValue fact={workCounters.actedAloneFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              {workCounters.actedAloneFact.value === 1 ? 'time' : 'times'}. Moved{' '}
              <FactValue fact={workCounters.unitsMovedFact} onInspect={onInspectFact} noPlus plainFont />. Built{' '}
              <FactValue fact={workCounters.toolsBuiltFact} onInspect={onInspectFact} noPlus plainFont />{' '}
              {workCounters.toolsBuiltFact.value === 1 ? 'tool' : 'tools'}.
            </p>
          </div>
        </div>
      </section>

      {/* Money Breakdown Drawer */}
      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="money-drawer-title"
          className="fixed inset-0 z-50 bg-[#25372C]/35 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="bg-[#FFF8E8] border border-[#D8CEB8] rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-xl">
            <div className="px-5 py-4 bg-white border-b border-[#E5DCC7] flex items-start justify-between gap-3">
              <div>
                <h2 id="money-drawer-title" className="text-lg font-semibold text-[#25372C]">
                  Where the money was saved and lost
                </h2>
                <p className="text-xs text-[#56695D] mt-0.5">
                  Through {formatShortDate(moneyAccount.asOfDate)}. Tap any figure to see how it was computed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close money breakdown"
                className="p-1.5 rounded-lg border border-[#E5DCC7] bg-white hover:bg-[#F5EEDD] text-[#56695D] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 bg-[#FFFDF7] border-b border-[#E5DCC7] grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-[#56695D]">Lost without Opscien</p>
                <p className="mt-0.5 text-base font-semibold text-[#25372C]">
                  <FactValue fact={moneyAccount.withoutOpscienFact} onInspect={onInspectFact} noPlus plainFont />
                </p>
              </div>
              <div>
                <p className="text-[#56695D]">Lost with Opscien</p>
                <p className="mt-0.5 text-base font-semibold text-[#991B1B]">
                  <FactValue fact={moneyAccount.lostSoFarFact} onInspect={onInspectFact} noPlus plainFont />
                </p>
              </div>
              <div>
                <p className="text-[#56695D]">Saved so far</p>
                <p className="mt-0.5 text-base font-semibold text-[#15803D]">
                  <FactValue fact={moneyAccount.savedSoFarFact} onInspect={onInspectFact} noPlus plainFont />
                </p>
              </div>
            </div>

            <div className="px-5 pt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('problem')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                  tab === 'problem'
                    ? 'bg-[#25372C] text-white'
                    : 'bg-white border border-[#D8CEB8] text-[#43564A]'
                }`}
              >
                By problem
              </button>
              <button
                type="button"
                onClick={() => setTab('store')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                  tab === 'store'
                    ? 'bg-[#25372C] text-white'
                    : 'bg-white border border-[#D8CEB8] text-[#43564A]'
                }`}
              >
                By store
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              {tab === 'problem' ? (
                moneyAccount.byProblem.map((pb) => {
                  const isOpen = !!expandedProblems[pb.problemId];
                  return (
                    <div
                      key={pb.problemId}
                      className="bg-white border border-[#E5DCC7] rounded-xl p-3.5 space-y-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleProblem(pb.problemId)}
                        className="w-full text-left flex items-start justify-between gap-2 cursor-pointer"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-[#25372C]">
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{pb.title}</span>
                          </div>
                          <p className="text-[#56695D]">
                            {pb.storeNames} · {pb.decisionLabel}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[#15803D] font-semibold">
                            Saved {formatWholeUsd(pb.savedFact.value)}
                          </p>
                          <p className="text-[#991B1B]">
                            Lost {formatWholeUsd(pb.lostSoFarFact.value)}
                          </p>
                        </div>
                      </button>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <ProofPill proof={pb.proofStatus} />
                        <span className="text-[#56695D]">Why any was lost: {pb.lossReason}</span>
                      </div>

                      {isOpen && (
                        <div className="pt-2 border-t border-[#EFE8D6] space-y-1.5">
                          {pb.stores.map((st) => (
                            <div
                              key={`${pb.problemId}-${st.storeId}`}
                              className="p-2 rounded-lg bg-[#FFFDF7] border border-[#EFE8D6] flex flex-wrap items-center justify-between gap-2"
                            >
                              <div>
                                <p className="font-medium text-[#25372C]">{st.storeName}</p>
                                <p className="text-[11px] text-[#56695D]">{st.lossReason}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-right">
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
                })
              ) : (
                <div className="bg-white border border-[#E5DCC7] rounded-xl divide-y divide-[#EFE8D6] text-xs">
                  {moneyAccount.byStore.map((st) => (
                    <div
                      key={st.storeId}
                      className="p-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <p className="font-semibold text-[#25372C]">{st.storeName}</p>
                        <p className="text-[11px] text-[#56695D]">{st.lossReason}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[#56695D]">
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
          </div>
        </div>
      )}
    </>
  );
}
