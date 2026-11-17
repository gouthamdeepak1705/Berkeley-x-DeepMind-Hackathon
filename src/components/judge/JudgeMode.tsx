import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { createFact } from '../../engine/facts';
import { DEFAULT_SEED } from '../../engine/prng';
import {
  evaluateCase1Delay,
  evaluateCase3Delay,
  getJudgeScenarioBundle,
  JudgeChoiceId,
} from '../../judge/judgeEngine';
import { Fact } from '../../types/domain';
import { FactValue } from '../FactValue';

interface JudgeModeProps {
  onBackToStart: () => void;
  onStartTour: () => void;
  onInspectFact: (fact: Fact) => void;
}

export function JudgeMode({
  onBackToStart,
  onStartTour,
  onInspectFact,
}: JudgeModeProps) {
  const bundle = useMemo(() => getJudgeScenarioBundle(DEFAULT_SEED), []);

  const [view, setView] = useState<'case' | 'scoreboard'>('case');
  const [caseIdx, setCaseIdx] = useState<number>(0);
  const [choices, setChoices] = useState<Partial<Record<1 | 2 | 3 | 4, JudgeChoiceId>>>({});
  const [case1DelayDays, setCase1DelayDays] = useState<number>(
    bundle.cases[0].delaySliderConfig?.defaultValue ?? 14,
  );
  const [case3DelayWeeks, setCase3DelayWeeks] = useState<number>(
    bundle.cases[2].delaySliderConfig?.defaultValue ?? 2,
  );

  const currentCase = bundle.cases[caseIdx];
  const selectedChoice = choices[currentCase.caseNumber];

  const case1DelayEval = useMemo(
    () => evaluateCase1Delay(DEFAULT_SEED, case1DelayDays),
    [case1DelayDays],
  );
  const case3DelayEval = useMemo(
    () => evaluateCase3Delay(DEFAULT_SEED, case3DelayWeeks),
    [case3DelayWeeks],
  );

  const activeDelayEval =
    currentCase.caseNumber === 1
      ? case1DelayEval
      : currentCase.caseNumber === 3
        ? case3DelayEval
        : null;

  const sliderValue =
    currentCase.caseNumber === 1
      ? case1DelayDays
      : currentCase.caseNumber === 3
        ? case3DelayWeeks
        : 0;

  const handleSelectOption = (optId: JudgeChoiceId) => {
    setChoices((prev) => ({
      ...prev,
      [currentCase.caseNumber]: optId,
    }));
  };

  const handleNext = () => {
    if (caseIdx < 3) {
      setCaseIdx(caseIdx + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setView('scoreboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleTryAgain = () => {
    setChoices({});
    setCase1DelayDays(bundle.cases[0].delaySliderConfig?.defaultValue ?? 14);
    setCase3DelayWeeks(bundle.cases[2].delaySliderConfig?.defaultValue ?? 2);
    setCaseIdx(0);
    setView('case');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (view === 'scoreboard') {
    const [c1, c2, c3, c4] = bundle.cases;
    const c1Opt = c1.options.find((o) => o.id === choices[1]) ?? c1.options[0];
    const c2Opt = c2.options.find((o) => o.id === choices[2]) ?? c2.options[0];
    const c3Opt = c3.options.find((o) => o.id === choices[3]) ?? c3.options[0];
    const c4Opt = c4.options.find((o) => o.id === choices[4]);
    const c4Right = Boolean(c4Opt?.isCorrect);

    const yourC1Fact =
      c1Opt.lossFact ??
      createFact('judge:sb:your:c1', 'Case 1 your choice', c1Opt.lossUsd, 'USD', 'Case 1 cost.');
    const yourC2Fact =
      c2Opt.lossFact ??
      createFact('judge:sb:your:c2', 'Case 2 your choice', c2Opt.lossUsd, 'USD', 'Case 2 cost.');
    const yourC3Fact =
      c3Opt.lossFact ??
      createFact('judge:sb:your:c3', 'Case 3 your choice', c3Opt.lossUsd, 'USD', 'Case 3 cost.');
    const yourTotalFact = createFact(
      'judge:sb:your:total',
      'Your choices total lost sales',
      c1Opt.lossUsd + c2Opt.lossUsd + c3Opt.lossUsd,
      'USD',
      'Sum of simulated losses across Cases 1, 2, and 3 for the choices you selected.',
    );

    const worstC1Fact = c1.options[0].lossFact!;
    const worstC2Fact = c2.options[0].lossFact!;
    const worstC3Fact = c3.options[0].lossFact!;

    const dtC2Fact = createFact(
      'judge:sb:dt:c2',
      'Data team Case 2 cost',
      0,
      'USD',
      'Asking a data team after the fact whether early August was normal avoids an unnecessary discount.',
    );
    const dtTotalFact = createFact(
      'judge:sb:dt:total',
      'Data team total at your delays',
      case1DelayEval.lossUsd + case3DelayEval.lossUsd,
      'USD',
      'Sum of simulated losses across Case 1 and Case 3 at the delays you set on each slider.',
    );

    const opsC1Fact = c1.opscienCostFact!;
    const opsC2Fact = c2.opscienCostFact!;
    const opsC3Fact = c3.opscienCostFact!;

    const rows = [
      {
        id: 'your',
        label: 'Your choices',
        c1: yourC1Fact,
        c2: yourC2Fact,
        c3: yourC3Fact,
        total: yourTotalFact,
        tone: 'bg-white text-[#25372C]',
      },
      {
        id: 'worst',
        label: 'The worst choice each time',
        c1: worstC1Fact,
        c2: worstC2Fact,
        c3: worstC3Fact,
        total: bundle.worstTotalFact,
        tone: 'bg-[#FEF2F2]/60 text-[#991B1B]',
      },
      {
        id: 'datateam',
        label: 'A data team, at the delays you set',
        c1: case1DelayEval.lossFact,
        c2: dtC2Fact,
        c3: case3DelayEval.lossFact,
        total: dtTotalFact,
        tone: 'bg-[#FFFDF7] text-[#25372C]',
      },
      {
        id: 'opscien',
        label: 'Opscien',
        c1: opsC1Fact,
        c2: opsC2Fact,
        c3: opsC3Fact,
        total: bundle.opscienTotalFact,
        tone: 'bg-[#F4FBF6] text-[#14532D] font-semibold',
      },
    ];

    return (
      <div className="simple-shell min-h-screen overflow-x-hidden px-4 py-6 sm:px-8">
        <main className="max-w-3xl w-full mx-auto space-y-6" data-testid="judge-scoreboard">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#56695D]">Your scoreboard</p>
              <h1 className="text-xl sm:text-2xl font-semibold text-[#25372C]">
                Four decisions across one simulated season
              </h1>
            </div>
            <button
              type="button"
              onClick={onBackToStart}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#43564A] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to start</span>
            </button>
          </div>

          <p className="text-xs text-[#56695D]">
            The business is simulated. Money means lost sales at shelf price. Tap any number to check how it was worked out.
          </p>

          <section className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-6 space-y-5 shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[#E5DCC7] text-[#56695D] text-xs">
                    <th className="py-2.5 pr-3 font-semibold">Path</th>
                    <th className="py-2.5 px-2 font-semibold text-right">Case 1</th>
                    <th className="py-2.5 px-2 font-semibold text-right">Case 2</th>
                    <th className="py-2.5 px-2 font-semibold text-right">Case 3</th>
                    <th className="py-2.5 pl-2 font-semibold text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE8D6]">
                  {rows.map((row) => (
                    <tr key={row.id} className={row.tone}>
                      <td className="py-3 pr-3 font-medium">{row.label}</td>
                      <td className="py-3 px-2 text-right tabular-nums whitespace-nowrap">
                        <FactValue fact={row.c1} onInspect={onInspectFact} noPlus plainFont />
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums whitespace-nowrap">
                        <FactValue fact={row.c2} onInspect={onInspectFact} noPlus plainFont />
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums whitespace-nowrap">
                        <FactValue fact={row.c3} onInspect={onInspectFact} noPlus plainFont />
                      </td>
                      <td className="py-3 pl-2 text-right font-semibold tabular-nums whitespace-nowrap">
                        <FactValue fact={row.total} onInspect={onInspectFact} noPlus plainFont />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-3.5 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] text-sm text-[#25372C]">
              Case 4: you were{' '}
              <span className="font-semibold">{c4Right ? 'right' : 'not right'}</span> about what
              the transfer caused.
            </div>

            <p className="text-base font-semibold text-[#25372C] leading-snug pt-1">
              A data team answers the questions somebody asks. Opscien notices the question.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onStartTour}
                className="inline-flex items-center gap-2 px-5 py-3 bg-[#25372C] hover:bg-[#1C2A21] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Take the guided tour</span>
              </button>

              <button
                type="button"
                onClick={handleTryAgain}
                className="inline-flex items-center gap-2 px-4 py-3 bg-white hover:bg-[#F5EEDD] border border-[#D8CEB8] text-[#25372C] text-sm font-semibold rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Try again</span>
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const chosenOptionObj = currentCase.options.find((o) => o.id === selectedChoice) ?? null;

  return (
    <div
      className="simple-shell min-h-screen overflow-x-hidden px-4 py-6 sm:px-8"
      data-testid={`judge-case-${currentCase.caseNumber}`}
    >
      <main className="max-w-3xl w-full mx-auto space-y-5">
        <header className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[#25372C]">
              Case {currentCase.caseNumber} of {bundle.cases.length}
            </span>
            <button
              type="button"
              onClick={onBackToStart}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#43564A] hover:text-[#25372C] underline underline-offset-4 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to start</span>
            </button>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-[#25372C] leading-tight">
            {currentCase.title}
          </h1>
          <p className="text-xs text-[#56695D]">
            The business is simulated. Money means lost sales at shelf price.
          </p>
        </header>

        {/* Step 1: What you see */}
        <section className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#25372C]">1. What you see</h2>
            <span className="text-xs font-medium text-[#56695D]">
              {currentCase.dateFormatted}
            </span>
          </div>
          <p className="text-sm text-[#43564A] leading-relaxed">{currentCase.whatYouSeeLead}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5DCC7] text-[#56695D]">
                  {currentCase.whatYouSeeColumns.map((col, i) => (
                    <th key={col} className={`py-2 font-semibold ${i === 0 ? 'pr-3' : 'px-2 text-right'}`}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE8D6] text-[#25372C]">
                {currentCase.whatYouSeeRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="py-2 pr-3 font-medium">{row.store}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{row.col1}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{row.col2}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{row.col3}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Step 2: What would you do? */}
        <section className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
          <h2 className="text-sm font-semibold text-[#25372C]">2. {currentCase.promptQuestion}</h2>
          <div className="space-y-2.5">
            {currentCase.options.map((opt) => {
              const isSelected = selectedChoice === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`judge-option-${opt.id}`}
                  aria-pressed={isSelected}
                  onClick={() => handleSelectOption(opt.id)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#F4F8F5] border-2 border-[#25372C]'
                      : 'bg-[#FFFDF7] hover:bg-[#F5EEDD] border-[#E5DCC7]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[#25372C]">{opt.label}</span>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-[#25372C] shrink-0 mt-0.5" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#56695D] leading-snug">{opt.detail}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Steps 3-6 revealed once an option is selected */}
        {chosenOptionObj && (
          <>
            {/* Step 3: What your choice cost */}
            <section
              data-testid="judge-result"
              className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs"
            >
              <h2 className="text-sm font-semibold text-[#25372C]">
                3. What your choice cost
              </h2>
              <div className="space-y-2">
                {currentCase.options.map((opt) => {
                  const isChosen = opt.id === chosenOptionObj.id;
                  return (
                    <div
                      key={opt.id}
                      className={`p-3 rounded-xl border text-xs space-y-1 ${
                        isChosen
                          ? 'bg-[#F4F8F5] border-2 border-[#25372C]'
                          : 'bg-[#FFFDF7] border-[#E5DCC7]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#25372C]">
                          {opt.label}
                          {isChosen ? ' (your choice)' : ''}
                        </span>
                        {opt.lossFact ? (
                          <span className="font-semibold text-[#991B1B] tabular-nums">
                            Lost:{' '}
                            <FactValue
                              fact={opt.lossFact}
                              onInspect={onInspectFact}
                              noPlus
                              plainFont
                            />
                          </span>
                        ) : (
                          <span
                            className={`font-semibold ${
                              opt.isCorrect ? 'text-[#15803D]' : 'text-[#991B1B]'
                            }`}
                          >
                            {opt.isCorrect ? 'Right reading' : 'Wrong reading'}
                          </span>
                        )}
                      </div>
                      <p className="text-[#43564A] leading-snug">{opt.resultSummary}</p>
                      {opt.resultFacts.length > 0 && (
                        <div className="flex flex-wrap gap-3 pt-0.5 text-[#56695D]">
                          {opt.resultFacts.map((rf) => (
                            <span key={rf.id}>
                              {rf.label}:{' '}
                              <FactValue
                                fact={rf}
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
                  );
                })}
              </div>
            </section>

            {/* Step 4: What the numbers say */}
            <section
              data-testid="judge-numbers"
              className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-2.5 shadow-2xs"
            >
              <h2 className="text-sm font-semibold text-[#25372C]">4. What the numbers say</h2>
              <ul className="space-y-2 text-sm text-[#43564A] leading-relaxed">
                {currentCase.numbersLines.map((line) => (
                  <li key={line.id} className="p-3 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7]">
                    {line.parts.map((part, idx) =>
                      part.fact ? (
                        <FactValue
                          key={part.fact.id + idx}
                          fact={part.fact}
                          onInspect={onInspectFact}
                          noPlus
                          plainFont
                          className="font-semibold text-[#25372C]"
                        />
                      ) : (
                        <span key={idx}>{part.text}</span>
                      ),
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* Step 5: How long would that answer take you? */}
            <section className="bg-white border border-[#DFD5BE] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs">
              <h2 className="text-sm font-semibold text-[#25372C]">
                5. How long would that answer take you?
              </h2>
              {currentCase.hasDelaySlider && currentCase.delaySliderConfig && activeDelayEval ? (
                <div className="space-y-3">
                  <p className="text-xs text-[#43564A] leading-snug">
                    {currentCase.delaySliderConfig.helperText}
                  </p>
                  <div className="p-3.5 rounded-xl bg-[#FFFDF7] border border-[#E5DCC7] space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <label htmlFor="judge-delay-slider" className="font-medium text-[#25372C]">
                        {currentCase.delaySliderConfig.label}
                      </label>
                      <span className="font-semibold text-[#25372C] tabular-nums">
                        {sliderValue}{' '}
                        {sliderValue === 1
                          ? currentCase.delaySliderConfig.unitSingular
                          : currentCase.delaySliderConfig.unitPlural}
                      </span>
                    </div>

                    <input
                      id="judge-delay-slider"
                      data-testid="judge-delay-slider"
                      type="range"
                      min={currentCase.delaySliderConfig.min}
                      max={currentCase.delaySliderConfig.max}
                      step={currentCase.delaySliderConfig.step}
                      value={sliderValue}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (currentCase.caseNumber === 1) setCase1DelayDays(v);
                        if (currentCase.caseNumber === 3) setCase3DelayWeeks(v);
                      }}
                      className="w-full accent-[#25372C] cursor-pointer"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
                      <span className="text-[#43564A]">
                        Lost while waiting:{' '}
                        <span
                          data-testid="judge-delay-lost"
                          className="font-semibold text-[#991B1B]"
                        >
                          <FactValue
                            fact={activeDelayEval.lossFact}
                            onInspect={onInspectFact}
                            noPlus
                            plainFont
                          />
                        </span>
                      </span>
                      <span className="text-xs text-[#56695D]">{activeDelayEval.detailText}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#43564A] leading-relaxed">
                  {currentCase.noSliderExplanation}
                </p>
              )}
            </section>

            {/* Step 6: What Opscien did */}
            <section
              data-testid="judge-opscien"
              className="bg-[#F4FBF6] border border-[#BBF7D0] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#14532D]">6. What Opscien did</h2>
                {currentCase.opscienCostFact && (
                  <span className="text-xs font-semibold text-[#14532D]">
                    Lost with Opscien:{' '}
                    <FactValue
                      fact={currentCase.opscienCostFact}
                      onInspect={onInspectFact}
                      noPlus
                      plainFont
                    />
                  </span>
                )}
              </div>
              <p className="text-sm text-[#25372C] leading-relaxed">{currentCase.opscienSummary}</p>
              {currentCase.opscienExtraFacts.length > 0 && (
                <div className="flex flex-wrap gap-4 text-xs text-[#43564A]">
                  {currentCase.opscienExtraFacts.map((ef) => (
                    <span key={ef.id}>
                      {ef.label}:{' '}
                      <FactValue
                        fact={ef}
                        onInspect={onInspectFact}
                        noPlus
                        plainFont
                        className="font-semibold text-[#14532D]"
                      />
                    </span>
                  ))}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="button"
                  data-testid="judge-next-btn"
                  onClick={handleNext}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#25372C] hover:bg-[#1C2A21] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  <span>{caseIdx < 3 ? 'Next case' : 'See your scoreboard'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
