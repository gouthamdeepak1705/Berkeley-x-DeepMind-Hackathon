import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveTimeline, runFullDiagnostics } from './runner';
import { runSimulation } from './simulation';
import { DEFAULT_SEED } from './prng';

function extractDatesFromString(s: string): string[] {
  return s.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
}

test('simulation is deterministic for a fixed seed', () => {
  const a = runSimulation(DEFAULT_SEED);
  const b = runSimulation(DEFAULT_SEED);
  assert.equal(
    a.chainRecordsByDate['2026-10-15'].allStoresActualSales,
    b.chainRecordsByDate['2026-10-15'].allStoresActualSales,
  );
  assert.equal(a.walnutCreekRefunds.length, b.walnutCreekRefunds.length);
});

test('Walnut Creek retains 35 days of individual refund records with operator 14 pattern', () => {
  const sim = runSimulation(DEFAULT_SEED);
  assert.ok(sim.walnutCreekRefunds.length > 0);
  const op14 = sim.walnutCreekRefunds.filter(
    (r) => r.operatorNumber === 14 && r.till === 2 && r.method === 'cash' && !r.linkedOrder,
  );
  assert.ok(op14.length > 0, 'Expected unlinked cash refunds on Till 2 by operator 14');
  for (const r of op14) {
    const hour = Number(r.time.split(':')[0]);
    assert.ok(hour >= 20, `Expected after 8pm, got ${r.time}`);
  }
});

test('all 11 diagnostic target dates fall within 5 days and mid-Oct LFL/total check passes', () => {
  const report = runFullDiagnostics(DEFAULT_SEED);
  console.log('\n--- Diagnostic Timeline ---');
  for (const t of report.targets) {
    console.log(
      `[${t.withinFiveDays ? 'PASS' : 'FAIL'}] ${t.label}: actual=${t.actualDate} (target ${t.targetWindow})`,
    );
  }
  console.log(
    `[${report.midOctoberCheck.passed ? 'PASS' : 'FAIL'}] Mid-Oct (${report.midOctoberCheck.date}): LFL=${report.midOctoberCheck.lflPointsBelowExpectation} pts below, Total 28d vs LY=+${report.midOctoberCheck.total28dVsLastYearPct}%`,
  );
  for (const t of report.targets) {
    assert.ok(
      t.withinFiveDays,
      `Target "${t.label}" missed window "${t.targetWindow}": actual=${t.actualDate}`,
    );
  }
  assert.ok(
    report.midOctoberCheck.passed,
    `Mid-October check failed: LFL=${report.midOctoberCheck.lflPointsBelowExpectation} pts below, total=+${report.midOctoberCheck.total28dVsLastYearPct}%`,
  );
});

test('no day state contains figures, fact IDs, or notes from a future day', () => {
  const { dayStates } = buildLiveTimeline(DEFAULT_SEED);

  for (const ds of dayStates) {
    const D = ds.date;
    for (const r of ds.raised) {
      assert.ok(r.firstDetectedOn <= D, `Raised ${r.candidateId} firstDetectedOn ${r.firstDetectedOn} > ${D}`);
      assert.ok(r.lastSeenOn <= D, `Raised ${r.candidateId} lastSeenOn ${r.lastSeenOn} > ${D}`);
      for (const f of [r.expected, r.actual, r.stakePerWeek, r.todayExpected, r.todayActual, r.todayStakePerWeek]) {
        if (!f) continue;
        for (const dStr of extractDatesFromString(f.id)) {
          assert.ok(dStr <= D, `Fact id ${f.id} on day ${D} references future date ${dStr}`);
        }
      }
      for (const st of r.stores ?? []) {
        assert.ok(st.firstDetectedOn <= D, `Store ${st.storeId} firstDetectedOn ${st.firstDetectedOn} > ${D}`);
        for (const f of [st.initialActual, st.initialExpected, st.todayActual, st.todayExpected]) {
          if (!f) continue;
          for (const dStr of extractDatesFromString(f.id)) {
            assert.ok(dStr <= D, `Store fact id ${f.id} on day ${D} references future date ${dStr}`);
          }
        }
      }
      for (const ev of r.evidence ?? []) {
        assert.ok(ev.firstDetectedOn <= D, `Evidence ${ev.candidateId} on ${D} has future firstDetectedOn ${ev.firstDetectedOn}`);
        for (const f of [ev.actual, ev.expected, ev.todayActual, ev.todayExpected]) {
          if (!f) continue;
          for (const dStr of extractDatesFromString(f.id)) {
            assert.ok(dStr <= D, `Evidence fact id ${f.id} on day ${D} references future date ${dStr}`);
          }
        }
      }
    }
  }

  // Specific Sep 8 check: card and trace both show 2.4 weeks with 2026-09-08 fact ID
  const sep8 = dayStates.find((d) => d.date === '2026-09-08')!;
  const bsCard = sep8.raised.find((r) => r.candidateId === 'situation:stock_running_out:best_sellers')!;
  assert.ok(bsCard, 'Best-sellers running short should be raised on Sep 8');
  assert.equal(bsCard.actual.formatted, '2.4 wks');
  assert.ok(bsCard.actual.id.includes('2026-09-08'));
  assert.equal(bsCard.todayDate, undefined);
});

test('Walnut Creek, Pasadena, Burlingame, and Napa never run out of Best-sellers and Nov 12 jumps are silenced', () => {
  const { sim, dayStates } = buildLiveTimeline(DEFAULT_SEED);

  for (const sid of ['walnut_creek', 'pasadena', 'burlingame', 'napa'] as const) {
    for (const d of sim.liveDates) {
      if (d < '2026-09-01') continue;
      const g = sim.storeRecordsByDate[d][sid].groups.best_sellers;
      assert.ok(g.endingStock > 0, `${sid} ran out of Best-sellers on ${d}`);
    }
  }

  const nov14 = dayStates[dayStates.length - 1];
  // No Nov 12 jump cards in Needs you
  const jumpCards = nov14.raised.filter((r) => r.candidateId.includes(':jump'));
  assert.equal(jumpCards.length, 0, 'Nov 12 post-delivery jumps must not appear in Needs you');

  // Stock returned group appears in Noticed and let go
  const stockReturnedGroup = nov14.groupedLetGo.find((g) => g.checkKind === 'stock_returned');
  assert.ok(stockReturnedGroup, 'Expected stock_returned group in Noticed and let go');
  assert.equal(stockReturnedGroup.items.length, 3);

  // Consequences are linked, not duplicate cards
  assert.ok(nov14.raised.length <= 5, `Expected <= 5 situations in Needs you, got ${nov14.raised.length}`);
  const bsSit = nov14.raised.find((r) => r.candidateId === 'situation:stock_running_out:best_sellers')!;
  assert.ok(bsSit.evidence && bsSit.evidence.length >= 6, 'Expected linked store drops, out-of-line, and LFL break');
});
