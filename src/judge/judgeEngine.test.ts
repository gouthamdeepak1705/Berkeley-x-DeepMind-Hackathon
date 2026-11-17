import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCase1Delay,
  evaluateCase3Delay,
  getJudgeScenarioBundle,
} from './judgeEngine';
import { DEFAULT_SEED } from '../engine/prng';

test('Judge Mode: Cases 1-4 options, delay sliders, and Scoreboard match exact simulated totals with zero Gemini calls', () => {
  const bundle = getJudgeScenarioBundle(DEFAULT_SEED);
  const [c1, c2, c3, c4] = bundle.cases;

  // Case 1 options
  assert.equal(c1.date, '2026-09-08');
  assert.equal(c1.options[0].lossUsd, 381074);
  assert.equal(c1.options[1].lossUsd, 201074);
  assert.equal(c1.options[2].lossUsd, 118154);
  assert.equal(c1.opscienCostFact?.value, 14734);
  const c1OptZeroUnits = c1.numbersLines
    .flatMap((l) => l.parts)
    .find((p) => p.fact?.id === 'judge:c1:zero_loss_units')?.fact?.value;
  assert.equal(c1OptZeroUnits, 3320);

  // Case 1 delay slider (0, 7, 14, 28 days from 21 Sep)
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 0).lossUsd, 9637);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 7).lossUsd, 64367);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 14).lossUsd, 119270);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 28).lossUsd, 228782);

  // Case 2 options (Summer dip false alarm)
  assert.equal(c2.date, '2026-08-10');
  assert.equal(c2.options[0].lossUsd, 47103);
  assert.equal(c2.options[1].lossUsd, 25158);
  assert.equal(c2.options[2].lossUsd, 0);
  assert.equal(c2.hasDelaySlider, false);
  assert.equal(c2.opscienCostFact?.value, 0);

  // Case 3 options & delay slider (Refunds)
  assert.equal(c3.date, '2026-09-30');
  assert.equal(c3.options[0].lossUsd, 30598);
  assert.equal(c3.options[1].lossUsd, 8462);
  assert.equal(c3.options[2].lossUsd, 8462);
  assert.equal(c3.opscienCostFact?.value, 8462);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 0).lossUsd, 8462);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 2).lossUsd, 16127);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 4).lossUsd, 22572);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 6).lossUsd, 28944);

  // Case 4 proof
  assert.equal(c4.date, '2026-09-27');
  assert.equal(c4.hasDelaySlider, false);
  assert.equal(c4.options[0].isCorrect, false);
  assert.equal(c4.options[1].isCorrect, true);
  assert.equal(c4.options[2].isCorrect, false);
  const provenVal = c4.numbersLines
    .flatMap((l) => l.parts)
    .find((p) => p.fact?.id === 'judge:c4:proven_gain')?.fact?.value;
  const pasSavedVal = c4.numbersLines
    .flatMap((l) => l.parts)
    .find((p) => p.fact?.id === 'judge:c4:pas_saved')?.fact?.value;
  assert.equal(provenVal, 36882);
  assert.equal(pasSavedVal, 9762);

  // Scoreboard totals
  assert.equal(bundle.worstTotalFact.value, 458775);
  assert.equal(bundle.opscienTotalFact.value, 23196);
});
