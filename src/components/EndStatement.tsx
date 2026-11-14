import { Check, FileText, Wrench } from 'lucide-react';
import { formatShortDate } from '../engine/calendar';
import { stripUnresolvedBraces } from '../gemini/placeholders';
import { EndStatementData, Fact } from '../types/domain';
import { FactValue } from './FactValue';

interface EndStatementProps {
  statement: EndStatementData;
  onInspectFact: (fact: Fact) => void;
}

function formatSecondsFromMs(ms: number): string {
  const sec = Math.max(0.1, ms / 1000);
  return `${sec.toFixed(1)} seconds`;
}

export function EndStatement({ statement, onInspectFact }: EndStatementProps) {
  const { money, noticing, wrongOrUnproven, cost, built } = statement;

  return (
    <section
      data-testid="end-statement"
      aria-labelledby="end-statement-heading"
      className="mt-5 bg-white border-2 border-[#312E81] rounded-xl p-4 sm:p-5 space-y-5"
    >
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#E6E1D8]">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wide text-[#312E81] font-semibold">
            Season review · {formatShortDate(statement.generatedOn)}
          </p>
          <h2
            id="end-statement-heading"
            className="mt-0.5 font-display text-xl font-semibold text-[#171717]"
          >
            What happened across the whole run
          </h2>
        </div>
        <FileText className="w-5 h-5 text-[#312E81] shrink-0 mt-1" />
      </div>

      {/* 1. What I did, in money */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wide">
          What I did, in money
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[#57534E]">Proven avoided lost sales</p>
            <p className="mt-1 text-base font-semibold text-[#15803D]">
              <FactValue fact={money.provenAvoidedFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[#57534E]">Refund leakage stopped (before &amp; after, not proven)</p>
            <p className="mt-1 text-base font-semibold text-[#171717]">
              <FactValue fact={money.refundLeakageStoppedFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[#57534E]">Delay cost on Best-sellers</p>
            <p className="mt-1 text-sm font-semibold text-[#171717]">
              <FactValue fact={money.delayCostFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8] space-y-1">
            <p className="text-[#57534E]">Actions taken</p>
            <p className="text-[#171717]">
              <FactValue fact={money.routineTransfersCountFact} onInspect={onInspectFact} /> routine ·{' '}
              <FactValue fact={money.autonomousTransfersCountFact} onInspect={onInspectFact} /> acted
              alone ·{' '}
              <FactValue fact={money.storeTasksCountFact} onInspect={onInspectFact} /> manager notes
            </p>
          </div>
        </div>
      </div>

      {/* 2. My noticing, scored against what really happened */}
      <div className="space-y-2 pt-3 border-t border-[#F3F0EA]">
        <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wide">
          My noticing, scored against what really happened
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[11px] text-[#57534E]">Real issues raised</p>
            <p className="mt-0.5 font-semibold text-[#15803D]">
              <FactValue fact={noticing.realRaisedFact} onInspect={onInspectFact} /> of{' '}
              <FactValue fact={noticing.realTotalFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[11px] text-[#57534E]">Median notice lead</p>
            <p className="mt-0.5 font-semibold text-[#171717]">
              <FactValue fact={noticing.medianDaysEarlyFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[11px] text-[#57534E]">Look-alikes raised</p>
            <p className="mt-0.5 font-semibold text-[#15803D]">
              <FactValue fact={noticing.lookAlikesRaisedFact} onInspect={onInspectFact} /> of{' '}
              <FactValue fact={noticing.lookAlikesTotalFact} onInspect={onInspectFact} />
            </p>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]">
            <p className="text-[11px] text-[#57534E]">Median decision time</p>
            <p className="mt-0.5 font-semibold text-[#171717]">
              {formatSecondsFromMs(noticing.medianDecisionMsFact.value)}
            </p>
          </div>
        </div>
        <ul className="space-y-1 text-[11px] text-[#57534E] pt-1">
          {noticing.realDetails.map((d) => (
            <li key={d.label} className="flex items-baseline justify-between gap-2">
              <span className="text-[#171717]">{d.label}</span>
              <span className="font-mono shrink-0">
                {d.raisedDate
                  ? `${formatShortDate(d.raisedDate)}${
                      d.daysEarly !== null ? ` (${d.daysEarly} days early)` : ''
                    }`
                  : 'Not raised'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 3. What I got wrong or could not prove */}
      <div className="space-y-2 pt-3 border-t border-[#F3F0EA]">
        <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wide">
          What I got wrong or could not prove
        </h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#57534E]">
          <span>
            Did not work:{' '}
            <FactValue fact={wrongOrUnproven.didNotWorkCountFact} onInspect={onInspectFact} />
          </span>
          <span>
            Undone: <FactValue fact={wrongOrUnproven.undoneCountFact} onInspect={onInspectFact} />
          </span>
          <span>
            No comparison store:{' '}
            <FactValue fact={wrongOrUnproven.unprovenOnlyCountFact} onInspect={onInspectFact} />
          </span>
          <span>
            Checks disagreed:{' '}
            <FactValue fact={wrongOrUnproven.disagreementsCountFact} onInspect={onInspectFact} />
          </span>
          <span>
            Fallbacks:{' '}
            <FactValue fact={wrongOrUnproven.fallbacksCountFact} onInspect={onInspectFact} />
          </span>
        </div>
        <ul className="space-y-1 text-xs text-[#57534E] list-disc pl-4">
          {wrongOrUnproven.notes.map((n, idx) => (
            <li key={`note-${idx}`}>{stripUnresolvedBraces(n)}</li>
          ))}
        </ul>
      </div>

      {/* 4. What I cost */}
      <div className="space-y-1.5 pt-3 border-t border-[#F3F0EA] text-xs">
        <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wide">
          What I cost
        </h3>
        <p className="text-[#171717]">
          Total Gemini calls:{' '}
          <FactValue fact={cost.totalCallsFact} onInspect={onInspectFact} /> (live decision:{' '}
          <FactValue fact={cost.decisionCallsFact} onInspect={onInspectFact} />, live other:{' '}
          <FactValue fact={cost.otherCallsFact} onInspect={onInspectFact} />) · Session API spend:{' '}
          <FactValue fact={cost.estimatedCostUsdFact} onInspect={onInspectFact} />
        </p>
        <p className="text-[#57534E]">{cost.liveModeCostNote}</p>
      </div>

      {/* 5. What I built */}
      <div className="space-y-2 pt-3 border-t border-[#F3F0EA] text-xs">
        <h3 className="text-xs font-semibold text-[#171717] uppercase tracking-wide">
          What I built
        </h3>
        {built.tools.length === 0 ? (
          <p className="text-[#57534E]">No store tools were built during this run.</p>
        ) : (
          <ul className="space-y-1.5">
            {built.tools.map((t) => (
              <li
                key={t.title}
                className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[#FAF8F5] border border-[#E6E1D8]"
              >
                <span className="inline-flex items-center gap-1.5 font-medium text-[#171717]">
                  <Wrench className="w-3.5 h-3.5 text-[#312E81]" />
                  {t.title} ({formatShortDate(t.installedOn)})
                </span>
                <span className="inline-flex items-center gap-1 text-[#15803D] font-medium">
                  <Check className="w-3.5 h-3.5" />
                  <FactValue fact={t.testsPassedFact} onInspect={onInspectFact} /> of{' '}
                  <FactValue fact={t.testsTotalFact} onInspect={onInspectFact} /> browser checks
                  passed
                  {t.usedFallbackCopy ? ' (fallback copy)' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
