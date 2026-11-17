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

  // Case 1 content, 10-store table, options, numbers, slider default 7, and Opscien summary
  assert.equal(c1.date, '2026-09-08');
  assert.equal(c1.title, 'The shelf that looked full');
  assert.equal(c1.whatYouSeeRows.length, 10);
  assert.deepEqual(
    c1.whatYouSeeRows.map((r) => r.store),
    [
      'Union Square',
      'Palo Alto',
      'Santana Row',
      'Walnut Creek',
      'Burlingame',
      'Pasadena',
      'Napa',
      'Sacramento',
      'Santa Barbara',
      'Rockridge',
    ],
  );
  const c1SeeFacts = (c1.whatYouSeeLines ?? []).flatMap((l) => l.parts).map((p) => p.fact).filter(Boolean);
  assert.equal(c1SeeFacts.find((f) => f!.id === 'judge:c1:see:est_lift')?.formatted, '22');
  assert.equal(c1SeeFacts.find((f) => f!.id === 'judge:c1:see:all_ly')?.formatted, '30');

  assert.equal(c1.options[0].lossUsd, 381074);
  assert.equal(c1.options[1].lossUsd, 201074);
  assert.equal(c1.options[2].lossUsd, 118154);
  assert.match(c1.options[2].label, /2,191 units/);
  assert.equal(
    c1.options[2].resultSummary,
    'You did the arithmetic and still lost money, because the report gave a summer selling rate.',
  );
  assert.deepEqual(c1.options[1].emptyStoreLines, [
    'Union Square: empty from 9 October, 31 days',
    'Palo Alto: empty from 16 October, 24 days',
    'Santana Row: empty from 21 October, 19 days',
  ]);
  assert.equal(c1.opscienCostFact?.value, 14734);
  assert.ok(
    c1.opscienSummary.startsWith('Opscien raised this on 8 September, 13 days before the first empty shelf.'),
  );
  assert.equal(c1.delaySliderConfig?.defaultValue, 7);

  const c1NumFacts = c1.numbersLines.flatMap((l) => l.parts).map((p) => p.fact).filter(Boolean);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:zero_loss_units')?.value, 3320);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:us_autumn_wk')?.value, 194);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:us_aug_wk')?.value, 144);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:us_days_left')?.value, 13);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:del_days')?.value, 62);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:wc_wks')?.formatted, '14.9');
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:wc_dem61')?.value, 952);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:wc_stock')?.value, 1198);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:move_us')?.value, 1425);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:move_pa')?.value, 1028);
  assert.equal(c1NumFacts.find((f) => f!.id === 'judge:c1:move_sr')?.value, 867);

  // Case 1 delay slider (0, 7, 14, 28 days from 21 Sep)
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 0).lossUsd, 9637);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 7).lossUsd, 64367);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 14).lossUsd, 119270);
  assert.equal(evaluateCase1Delay(DEFAULT_SEED, 28).lossUsd, 228782);

  // Case 2 options, discount labels, footnote, and signal work counters (348 / 72)
  assert.equal(c2.date, '2026-08-10');
  assert.equal(c2.options[0].lossUsd, 47103);
  assert.equal(c2.options[1].lossUsd, 25158);
  assert.equal(c2.options[2].lossUsd, 0);
  assert.equal(c2.options[0].costLabel, 'Discount given on sales that were coming anyway');
  assert.equal(c2.options[1].costLabel, 'Discount given on sales that were coming anyway');
  assert.equal(c2.options[2].costLabel, undefined);
  assert.ok(c2.optionsFootnote?.includes('This simulation has no price response.'));
  assert.equal(c2.hasDelaySlider, false);
  assert.equal(c2.opscienCostFact?.value, 0);
  assert.ok(c2.opscienSummary.includes('checked 348 signals and stayed quiet on 72'));
  assert.equal(c2.opscienSummary.includes('waking you zero times for false alarms'), false);

  // Case 3 rates, hidden Step 1 slips, options, Step 4 slips table, and Opscien summary
  assert.equal(c3.date, '2026-09-30');
  assert.equal(c3.title, 'The leak nobody was looking for');
  assert.equal(c3.whatYouSeeRows.length, 0);
  const c3SeeFacts = (c3.whatYouSeeLines ?? []).flatMap((l) => l.parts).map((p) => p.fact).filter(Boolean);
  assert.equal(c3SeeFacts.find((f) => f!.id === 'judge:c3:see:all_sep')?.formatted, '5.1%');
  assert.equal(c3SeeFacts.find((f) => f!.id === 'judge:c3:see:all_aug')?.formatted, '4.0%');
  assert.equal(c3SeeFacts.find((f) => f!.id === 'judge:c3:see:wc')?.formatted, '14.2%');
  assert.equal(c3SeeFacts.find((f) => f!.id === 'judge:c3:see:other9')?.formatted, '4.0%');
  assert.equal(c3.options[0].lossUsd, 30598);
  assert.equal(c3.options[1].lossUsd, 8462);
  assert.equal(c3.options[2].lossUsd, 8462);
  assert.match(c3.options[0].resultSummary, /\$183,000 a year/);
  assert.match(c3.options[1].resultSummary, /\$1,909/);
  assert.match(c3.options[2].resultSummary, /128 honest refunds.*15 a week/);
  assert.equal(c3.numbersLines[0].table?.rows.length, 4);
  const c3NumFacts = c3.numbersLines.flatMap((l) => l.parts).map((p) => p.fact).filter(Boolean);
  assert.equal(c3NumFacts.find((f) => f!.id === 'judge:c3:false_count')?.value, 150);
  assert.equal(c3NumFacts.find((f) => f!.id === 'judge:c3:amt_min')?.formatted, '$109');
  assert.equal(c3NumFacts.find((f) => f!.id === 'judge:c3:amt_max')?.formatted, '$417');
  assert.equal(c3NumFacts.find((f) => f!.id === 'judge:c3:honest_cnt')?.value, 152);
  assert.equal(c3NumFacts.find((f) => f!.id === 'judge:c3:honest_avg')?.formatted, '$79');
  assert.equal(c3.opscienCostFact?.value, 8462);
  assert.equal(
    c3.opscienSummary,
    'The refunds began on 15 September. Opscien needed 15 days of evidence. On 30 September it named the pattern, built the tool, and the loss stopped at $8,462.',
  );
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 0).lossUsd, 8462);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 2).lossUsd, 16127);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 4).lossUsd, 22572);
  assert.equal(evaluateCase3Delay(DEFAULT_SEED, 6).lossUsd, 28944);

  // Case 4: Step 1 shows ONLY Union Square & Palo Alto; Step 4 adds healthy pairs & Santana Row
  assert.equal(c4.date, '2026-09-27');
  assert.equal(c4.whatYouSeeRows.length, 1);
  assert.match(c4.whatYouSeeRows[0].store, /Union Square & Palo Alto/);
  assert.equal(c4.numbersLines[0].table?.rows.length, 2);
  assert.match(c4.numbersLines[0].table!.rows[0].store, /Walnut Creek & Pasadena/);
  assert.match(c4.numbersLines[0].table!.rows[1].store, /Santana Row/);
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
