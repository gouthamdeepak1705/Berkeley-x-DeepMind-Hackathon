import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllTourStops, getTourStop, TOUR_TOTAL_STEPS } from './tourDriver';
import { DayState } from '../types/domain';

test('Guided tour has exactly 8 ordered stops reaching 14 November', () => {
  const stops = getAllTourStops();
  assert.equal(stops.length, TOUR_TOTAL_STEPS);
  assert.equal(stops[0].targetDate, '2026-09-08');
  assert.equal(stops[0].targetDayIndex, 38);
  assert.equal(stops[1].targetDate, '2026-09-25');
  assert.equal(stops[2].targetDate, '2026-09-27');
  assert.equal(stops[3].targetDate, '2026-09-30');
  assert.equal(stops[4].targetDate, '2026-10-05');
  assert.equal(stops[5].targetDate, '2026-10-15');
  assert.equal(stops[6].targetDate, '2026-11-01');
  assert.equal(stops[7].targetDate, '2026-11-14');
  assert.equal(stops[7].targetDayIndex, 105);

  for (let i = 1; i < stops.length; i++) {
    assert.ok(stops[i].targetDayIndex > stops[i - 1].targetDayIndex);
    assert.equal(stops[i].stepNumber, i + 1);
  }
});

test('getTourStop highlights expected button keys cleanly when matching state is active', () => {
  const mockState = {
    date: '2026-09-08',
    raised: [
      {
        candidateId: 'situation:stock_running_out:best_sellers',
        isRollout: false,
      },
    ],
  } as unknown as DayState;

  const stop1 = getTourStop(1, mockState);
  assert.equal(stop1.highlight?.actionKey, 'approve:situation:stock_running_out:best_sellers');

  const stop8 = getTourStop(8, mockState);
  assert.equal(stop8.actionKind, 'finish');
  assert.equal(stop8.highlight, null);
});
