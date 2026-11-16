import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllTourStops, getTourStop, TOUR_TOTAL_STEPS } from './tourDriver';
import { DayState } from '../types/domain';

test('Guided tour has exactly 8 ordered stops reaching 14 November', () => {
  const stops = getAllTourStops();
  assert.equal(stops.length, TOUR_TOTAL_STEPS);
  assert.deepEqual(
    stops.map((s) => s.targetDate),
    [
      '2026-08-17',
      '2026-09-08',
      '2026-09-08',
      '2026-09-27',
      '2026-09-30',
      '2026-09-30',
      '2026-10-05',
      '2026-11-14',
    ],
  );
  assert.equal(stops[0].targetDayIndex, 16);
  assert.equal(stops[1].targetDayIndex, 38);
  assert.equal(stops[2].targetDayIndex, 38);
  assert.equal(stops[7].targetDayIndex, 105);

  for (let i = 1; i < stops.length; i++) {
    assert.ok(stops[i].targetDayIndex >= stops[i - 1].targetDayIndex);
    assert.equal(stops[i].stepNumber, i + 1);
    assert.ok(stops[i].scrollTarget);
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

  const stop2 = getTourStop(2, mockState);
  assert.equal(stop2.highlight?.actionKey, 'approve:situation:stock_running_out:best_sellers');

  const stop8 = getTourStop(8, mockState);
  assert.equal(stop8.actionKind, 'finish');
  assert.equal(stop8.highlight, null);
});
