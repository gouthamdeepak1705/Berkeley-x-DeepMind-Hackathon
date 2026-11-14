import test from 'node:test';
import assert from 'node:assert/strict';
import { createFact } from '../engine/facts';
import { DEFAULT_SEED } from '../engine/prng';
import { runSimulation } from '../engine/simulation';
import { validateAndResolvePlaceholders } from './placeholders';
import { executeCheckerTool } from '../checker/tools';
import { generateDayOneBriefWithGemini } from './dayOne';
import { evaluateStage2UpToDay } from '../engine/stage2Timeline';

function extractDatesFromString(s: string): string[] {
  return s.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
}

test('validateAndResolvePlaceholders enforces zero typed digits and valid fact IDs', () => {
  const f1 = createFact('chain:store_count', 'Store count', 10, 'count', 'Total stores.');
  const f2 = createFact('chain:base_daily', 'Base daily', 48500, 'USD', 'Sum of base daily sales.');
  const factMap = { [f1.id]: f1, [f2.id]: f2 };

  const ok = validateAndResolvePlaceholders(
    'We operate {{chain:store_count}} stores with {{chain:base_daily}} baseline daily sales.',
    factMap,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.hasTypedDigits, false);
  assert.deepEqual(ok.missingIds, []);
  assert.equal(ok.segments.filter((s) => s.type === 'fact').length, 2);

  const typedDigit = validateAndResolvePlaceholders(
    'We operate 10 stores with {{chain:base_daily}} baseline.',
    factMap,
  );
  assert.equal(typedDigit.ok, false);
  assert.equal(typedDigit.hasTypedDigits, true);

  const missingFact = validateAndResolvePlaceholders(
    'We operate {{chain:unknown_fact}} stores.',
    factMap,
  );
  assert.equal(missingFact.ok, false);
  assert.deepEqual(missingFact.missingIds, ['chain:unknown_fact']);
});

test('all 8 Checker tools compute facts strictly <= date and surface donor stock & store mix', () => {
  const sim = runSimulation(DEFAULT_SEED);

  const sep8Tools = [
    ['recompute_figure', { figure_name: 'chain_lfl_28d' }],
    ['compare_with_last_year', { scope: 'chain', window_days: 28 }],
    ['compare_store_with_established', { store_id: 'union_square', metric: 'sales_vs_expected', window_days: 28 }],
    ['test_calendar_for_period', { window_days: 28 }],
    ['test_store_mix', { window_days: 28 }],
    ['test_data_fault', { window_days: 28 }],
    ['get_stock_cover_by_store_and_group', { group_id: 'best_sellers' }],
    ['get_lost_sales', { group_id: 'best_sellers' }],
  ] as const;

  for (const [toolName, args] of sep8Tools) {
    const res = executeCheckerTool(toolName, { ...args }, sim, '2026-09-08');
    assert.ok(res.facts.length > 0, `Tool ${toolName} should return at least one Fact`);
    for (const f of res.facts) {
      for (const dStr of extractDatesFromString(f.id)) {
        assert.ok(dStr <= '2026-09-08', `Tool ${toolName} emitted future fact id ${f.id}`);
      }
    }
  }

  // Donor surplus on Sep 8 for best_sellers must exist across slow-moving stores
  const coverRes = executeCheckerTool('get_stock_cover_by_store_and_group', { group_id: 'best_sellers' }, sim, '2026-09-08');
  const donorSurplus = coverRes.facts.find((f) => f.id.startsWith('tool:stock:donor_surplus:best_sellers:'));
  assert.ok(donorSurplus && donorSurplus.value > 0, 'Expected idle donor stock in slow-moving stores on Sep 8');

  // Store mix on Oct 15 must show positive all-store YoY while established YoY is negative
  const mixOct15 = executeCheckerTool('test_store_mix', { window_days: 28 }, sim, '2026-10-15');
  const allYoy = mixOct15.facts.find((f) => f.id.startsWith('tool:mix:all_yoy:'))!;
  const estYoy = mixOct15.facts.find((f) => f.id.startsWith('tool:mix:est_yoy:'))!;
  assert.ok(allYoy.value > 0, `Expected positive all-store YoY on Oct 15, got ${allYoy.value}`);
  assert.ok(estYoy.value < 0, `Expected negative established YoY on Oct 15, got ${estYoy.value}`);

  // Refund log audit on Oct 3 must see Walnut Creek operator 14 Till 2 late unlinked cash refunds
  const refOct3 = executeCheckerTool(
    'compare_store_with_established',
    { store_id: 'walnut_creek', metric: 'refund_rate', window_days: 28 },
    sim,
    '2026-10-03',
  );
  const after8Share = refOct3.facts.find((f) => f.id.includes(':after8_unlinked_cash:'))!;
  const op14Count = refOct3.facts.find((f) => f.id.includes(':after8_op14_count:'))!;
  assert.ok(after8Share.value > 20, `Expected after-8pm unlinked cash share > 20%, got ${after8Share.value}`);
  assert.ok(op14Count.value > 10, `Expected Till 2 operator 14 count > 10, got ${op14Count.value}`);
});

test('Check 7: with GEMINI_API_KEY removed, run completes on Stage 1 code behaviour with fallbacks marked', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = '';

  try {
    const sim = runSimulation(DEFAULT_SEED);
    const dayOne = await generateDayOneBriefWithGemini(sim.dayOneBrief);
    assert.equal(dayOne.narrativeMeta?.mode, 'fallback');
    assert.equal(dayOne.narrativeSegments?.length, 3);

    const out = await evaluateStage2UpToDay({
      seed: DEFAULT_SEED,
      targetDayIndex: 105,
      decisions: [],
      investigateTargetDay: true,
    });

    const nov14 = out.dayState;
    assert.equal(nov14.date, '2026-11-14');

    // Raised situations match Stage 1 fallback: Best-sellers, Walnut Creek Knitwear, Walnut Creek Refunds, Pasadena Knitwear, Napa Knitwear
    const raisedIds = nov14.raised.map((r) => r.candidateId);
    assert.ok(raisedIds.includes('situation:stock_running_out:best_sellers'));
    assert.ok(raisedIds.includes('situation:stock_running_out:knitwear'));
    assert.ok(raisedIds.includes('refunds_out_of_line:walnut_creek'));
    // LFL break stays inside Best-sellers evidence, not a separate card
    assert.ok(!raisedIds.some((id) => id.includes('lfl_break')));
    const bsCard = nov14.raised.find((r) => r.candidateId === 'situation:stock_running_out:best_sellers')!;
    assert.ok(bsCard.evidence?.some((e) => e.kind === 'lfl_break'), 'LFL break must be linked inside Best-sellers');
    assert.ok(bsCard.investigation?.mode === 'fallback');

    // Manager & Data scientist traces mark fallback cleanly
    const fallbackManagerTraces = nov14.trace.filter(
      (t) => t.lane === 'manager' && t.detail.includes('fallback, Gemini not used'),
    );
    const fallbackDsTraces = nov14.trace.filter(
      (t) => t.lane === 'data_scientist' && t.detail.includes('fallback, Gemini not used'),
    );
    assert.ok(fallbackManagerTraces.length > 0, 'Expected fallback Manager traces when key removed');
    assert.ok(fallbackDsTraces.length > 0, 'Expected fallback Data scientist traces when key removed');
  } finally {
    if (prevKey !== undefined) {
      process.env.GEMINI_API_KEY = prevKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  }
});
