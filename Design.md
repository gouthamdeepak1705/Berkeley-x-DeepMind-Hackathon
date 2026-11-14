# OpsCien Instinct — Architecture & Design Log

Updated through **Stage 2 of 6** (server-side Gemini module on `v1beta` Interactions + Decisions APIs, Watcher via `gemini-decision-1`, Gemini-authored Day One narrative with fact placeholders, Checker investigation loop with 8 code tools + structured output, and replay cache).

## 1. Module List

| Module | Purpose |
|---|---|
| `src/types/domain.ts` | Core TypeScript shapes (`Fact`, `Candidate`, `SilenceCheckResult`, `ScheduledDelivery`, `DeliveredStockEvent`, `RaisedItem`, `SupportingEvidence`, `NoticedAndLetGoItem`, `GroupedLetGoItem`, `TraceEntry`, `ActionDecision`, `DayOneBrief`, `DayState`, `DiagnosticReport`, plus Stage 2 `TextSegment`, `InvestigationResult`, `InvestigationRuledOut`, `InvestigationOption`, `InvestigationToolTrace`, `InstinctMeta`, `WatcherEvalRecord`). |
| `src/engine/prng.ts` | Deterministic Mulberry32/FNV-1a seeded hash (`DEFAULT_SEED = 20260801`) for reproducible noise and refund records in both Node and browser. |
| `src/engine/facts.ts` | `createFact()` and `formatFactValue()` ensuring every displayed figure carries an `id`, numeric `value`, formatted string, `unit`, and plain-words computation `note`. |
| `src/engine/calendar.ts` | Trading calendar (`TRADING_CALENDAR`), season/event span lookups (`getSeasonSpanForDate`, `getEventSpanForDate`, `getCalendarSpansOverlappingRange`), ISO week helper (`getIsoWeekKey`), and prior-year matching-day logic (`getMatchingPriorYearDate`). |
| `src/engine/stores.ts` | Catalog of the 10 **Linden & Rye** stores (8 established, 2 new) and 3 product groups (`best_sellers`, `knitwear`, `everything_else`). |
| `src/engine/simulation.ts` | Pure deterministic simulation engine from `2025-01-01` to `2026-11-14`, tracking daily sales, stock depletion, delivery schedule (`scheduledDeliveries`, `deliveredEvents`, `isDeliveryDueWithinDays`, `getRecentZeroRecoveryDelivery`), weeks of cover, 26-week median growth, Walnut Creek refund logs (latest 35 days), and the Day One brief. |
| `src/detectors/detectors.ts` | Six cheap/wide anomaly detectors: `drop_or_jump`, `day_out_of_line`, `lfl_break`, `store_out_of_line`, `stock_running_out` (queries `sim.isDeliveryDueWithinDays`), `refunds_out_of_line`. Emits stable `kind:thing` IDs without calendar period splits. |
| `src/detectors/silenceChecks.ts` | Five silence checks reading exclusively from `TRADING_CALENDAR` and `sim` delivery/stock records: `calendar`, `opening_ramp`, `partial_period`, `already_handled`, `stock_returned`. |
| `src/engine/runner.ts` | Stage 1 baseline live-window (`2026-08-01` to `2026-11-14`) timeline builder (`buildLiveTimeline`), general stock-consequence linking (`>= 50%` lost sales), same-group stock situation merging, grouped **Noticed and let go** summaries, and `runFullDiagnostics`. |
| `src/engine/stage2Timeline.ts` | Stage 2 server-side live timeline evaluator (`evaluateStage2UpToDay`) layering Watcher decisions, pair-merging, Checker investigations, live "today" snapshots, `lfl_break` total-sales-positive evidence, and Manager/Data scientist trace entries onto the Stage 1 engine without rewriting Stage 1 modules. |
| `src/gemini/settings.ts` | Single settings file for `v1beta` API version, per-job model fallback chains (`watcher`, `investigate_large`, `investigate_routine`, `day_one_description`), `thinking_level: "low"`, timeouts (`5s` decision; `45s` / `25s` investigation), Watcher thresholds (`raise >= 0.6`, `explained < 0.5`, `merge > 0.7`, `maxMergePairsPerRequest = 10`), Checker limits (`maxToolRounds = 10`, `maxPlaceholderRetries = 1`), daily uncached caps (`2,000` decision / `300` other), and token pricing. |
| `src/gemini/client.ts` | Server-only `@google/genai` client (`apiVersion: "v1beta"`, `retries: { strategy: 'none' }`), `callDecisionsRaw` (SDK + REST fallback), `callInteractionRaw` (`client.interactions.create`), in-memory SHA-256 request cache (`replayed` marking), daily cap tracking, per-call telemetry & cost logging, and `runConnectionTests()`. |
| `src/gemini/placeholders.ts` | `validateAndResolvePlaceholders()` verifying zero typed digits `0-9` outside `{{fact_id}}` placeholders and resolving every placeholder strictly against computed `Fact` records into `TextSegment[]`. |
| `src/gemini/dayOne.ts` | Generates the 3-paragraph Day One description via `day_one_description` (`gemini-4-hydrogen` → `gemini-3.8-flash` → code fallback) using `{{fact_id}}` placeholders with 1 retry on validation failure. |
| `src/watcher/briefing.ts` | `buildWatcherBriefing()` constructing a plain-words daily briefing from computed facts (business rules, calendar touching the week, open/handled/control/let-go context, noise multiples, donor surplus, and code silence check explanations). |
| `src/watcher/watcher.ts` | `evaluateWatcherBatch()` running 1 batched Decisions request per candidate day (`choice`, `explained` noul, `actionable` noul, `urgency` score, plus up to 10 `noul` pair-merge checks), structured fallback (`gemini-3.5-flash-lite`), Stage 1 code fallback, threshold enforcement, disagreement guard (`"Instinct and calendar check disagree"`), and Stage 6 evaluation logging. |
| `src/checker/tools.ts` | Exposes ONLY the 8 code tools (`recompute_figure`, `compare_with_last_year`, `compare_store_with_established`, `test_calendar_for_period`, `test_store_mix`, `test_data_fault`, `get_stock_cover_by_store_and_group`, `get_lost_sales`), reading strictly `<= date` (including reconstructing the 35-day refund log ending `safeDate` for refund audits) and returning `Fact`s with IDs. |
| `src/checker/checker.ts` | `runSituationInvestigation()` routing large/chain situations to `investigate_large` and routine ones to `investigate_routine`, running a manual Interactions API function-calling loop (max 10 rounds) with SSE step streaming, followed by structured JSON output (`previous_interaction_id` + fresh-call fallback), placeholder/digit validation + retry + code fallback, `do_nothing` guarantee, and `"nothing_to_do"` -> `'let_go'`. |
| `src/engine/simulation.test.ts` & `src/gemini/stage2.test.ts` | `node:test` suites verifying Stage 1 determinism/target dates/no-future-facts, Stage 2 placeholder zero-digit rules, all 8 Checker tools strictly `<= date`, Oct 3 refund log window, and Check 7 no-key code fallback behavior. |
| `server.ts` | Express server on port 3000 with `/api/health`, `/api/day-one`, `/api/diagnostics`, `/api/gemini/stats`, `/api/dev/connection-test`, `/api/dev/clear-cache`, `/api/timeline/step`, `/api/timeline/next-event`, and SSE `/api/timeline/investigate-stream`. |
| `src/components/DayOneScreen.tsx` | Pre-clock Day One brief rendering Gemini `TextSegment[]` with tappable computed `FactValue`s and five confirmed starting rules. |
| `src/components/ClockHeader.tsx` | Date readout, Play/Pause, speed (`1x` = 500ms/day, `2x`, `4x`), Skip to next event, and Reset. |
| `src/components/SalesChart.tsx` | Established-store trailing 7-day SVG line against `±8%` expected band, calendar markers, and 1-line 28-day all-store summary. |
| `src/components/OwnerFeed.tsx` | Left-column sections: **Needs you** (live `"Noticed: <title>. Checking now."` SSE banner, frozen first-raised + separate today figures, finding, side-by-side expected/actual, ruled out with green ticks & facts, cause, options with weekly effect, outcome, `"Raised by instinct..."` line, and expandable supporting evidence), **Done for you**, **Noticed and let go** (grouped by reason/week with confidence figures), **Tools I built**, **Record**. |
| `src/components/TracePanel.tsx` | Right-column "Behind the screen" trace: **Manager** (decision batches, confidences, merges, disagreements), **Data scientist** (tools in order, facts, model, ms, live/replayed/`fallback, Gemini not used`), and **Developer** (caps, cost, recent calls). |
| `src/components/FactValue.tsx`, `FactPopover.tsx`, `RealityNoteModal.tsx` | Tappable numeric figures showing computation formula/ID/unit, and reality modal (`Escape` closes). |
| `src/components/DevDiagnosticsPage.tsx` | Developer `/dev` page with live **Gemini Connection Test** button/results alongside the Stage 1 live-window diagnostic timeline. |

## 2. Core Data Shapes

- **`Fact`**: `{ id, label, value, formatted, unit, note }` — code computes every number; UI renders numbers exclusively through `FactValue`. Every fact on day `D` comes strictly from data `<= D`.
- **`TextSegment`**: `{ type: 'text', text } | { type: 'fact', fact: Fact }` — resolved model prose where every figure is a tappable `Fact`.
- **`Candidate`**: `{ id: kind + thing, kind, thing, storeId?, groupId?, period, detectedOn, title, summary, expected: Fact, actual: Fact, stakePerWeek: Fact, silenceChecks, explainedBy, groundTruth? }`. Open candidates keep a single identity across weeks/months and update in place rather than duplicating.
- **`SilenceCheckResult`**: `{ check: 'calendar' | 'opening_ramp' | 'partial_period' | 'already_handled' | 'stock_returned', triggered: boolean, reason: string }`.
- **`InvestigationResult`**: `{ candidateId, status: 'confirmed' | 'let_go', confirmed: 'yes' | 'no' | 'unclear', findingSegments, causeSegments, proposalSegments, causes, ruledOut: InvestigationRuledOut[], options: InvestigationOption[], outcomeKind, outcomeDetail, model, mode, latencyMs, usedFallbackWording, toolTrace: InvestigationToolTrace[], factsById }`.
- **`Situation` / `RaisedItem`**: `{ candidateId, firstDetectedOn, lastSeenOn, title, summary, detectorKind, groupId?, stores?: RaisedStoreSnapshot[], expected, actual, stakePerWeek, todayDate?, todayExpected?, todayActual?, todayStakePerWeek?, evidence?: SupportingEvidence[], instinctMeta?: InstinctMeta, investigation?: InvestigationResult }`.
- **`GroupedLetGoItem`**: `{ id, date, weekKey, checkKind, headline, confidence?, items: NoticedAndLetGoItem[] }`.
- **`WatcherEvalRecord`**: `{ date, situationId, groundTruth?, decisionChoice, confidence, explainedProb, actionableProb, urgencyIndex, latencyMs, model, mode, outcome }` — stored per day for Stage 6 evaluation.
- **`DayState`**: Pure immutable snapshot for day `D` containing `chartPoints`, `headlineFacts`, `raised`, `noticedAndLetGo`, `groupedLetGo`, `trace`, `todayCandidates`, `watcherEvalLog`, `pendingInvestigationId`.

## 3. Simulation Rules & Parameters

- **Chain**: **Linden & Rye** (California womenswear, USD).
- **Established stores (8)**: Union Square ($9,000), Palo Alto ($6,500), Santana Row ($5,500), Walnut Creek ($5,000), Pasadena ($4,500), Sacramento ($4,000), Santa Barbara ($3,500), Rockridge ($3,000).
- **New stores (2)**: Burlingame (opened `2026-06-01`, base $4,500, 2.2×→1.0× over 30 days) and Napa (opens `2026-08-22`, base $4,000, 2.2×→1.0× over 30 days).
- **Daily sales**: `base × weekday_factor × season_factor × event_factor × growth × opening_ramp × noise(±6%)`.
  - Weekday factors (Mon–Sun): `0.75, 0.78, 0.82, 0.90, 1.10, 1.45, 1.20`.
  - Season: January `0.80`, Summer lull (`1 Aug – 7 Sep`) `0.70`, December `1.25`.
  - Events: Labor Day Sat–Mon (`30 Aug – 1 Sep 2025`, `5 – 7 Sep 2026`) `1.35`; Thanksgiving Thu–Cyber Mon (`27 Nov – 1 Dec 2025`, `26 – 30 Nov 2026`) `1.60`.
  - Growth: 2026 runs `+6%` above 2025.
- **Product groups & deliveries**:
  - **Best-sellers**: `35%`, avg price `$120`, stock-limited. Weekly Monday deliveries until `2026-08-31`, then supplier delay until resumption delivery on `2026-11-09` (recorded in `scheduledDeliveries` and `deliveredEvents` with `returnedFromZero` tracking). Sep 1 cover calibrated: `2.74×` base weekly units at Union Square, Palo Alto, Santana Row; `26.0×` at Sacramento, Santa Barbara, Rockridge; `12.0×` at Walnut Creek, Pasadena, Burlingame, Napa.
  - **Knitwear**: `15%`, avg price `$90`, stock-limited. Weekly replenishment in history (`< 2026-08-01`), zero deliveries in live window. Starting stock calibrated (`8.75` base weeks at Walnut Creek, `11.75` at Pasadena, `14.4` at Napa, `60` elsewhere).
  - **Everything else**: `50%`, not stock-limited.
- **General linking & Watcher/Checker rules**:
  - Store sales candidate (`drop_or_jump` drop, `store_out_of_line`) links to an open `stock_running_out` candidate at that store when lost sales (`potentialSales - actualSales`) over the matching window (`7d` or `28d`) cover `>= 50%` of the gap.
  - Chain-level candidate (`lfl_break`, `day_out_of_line` dip) links to open `stock_running_out` candidates when total lost sales at open established stores cover `>= 50%` of the chain gap.
  - Unlinked candidates pass through the Watcher (`gemini-decision-1` → `gemini-3.5-flash-lite` → Stage 1 fallback); raising requires `choice === 'raise_now'`, `confidence >= 0.6`, `explainedProb < 0.5`, `!alreadyHandled`, and agreement with code silence checks.
  - Raised situations trigger the Checker (`gemini-4-carbon` for `>= $5,000/wk` or multi-store/chain; `gemini-4-hydrogen` for routine), pausing the clock until complete.
- **Day One confirmed rules**:
  - Donor stock floor: `"A donor store must keep at least 8 weeks of cover, and never less than it needs to reach its own next delivery plus one week."`
  - Transfer approval limit: `"Transfers above 500 units always require your approval."`
- **Refunds**: ~4% baseline (~15% cash). From `2026-09-15`, Walnut Creek Till 2 operator 14 adds ~10% unlinked cash refunds after 8 pm (`20:05–21:55`), lifting Walnut Creek to ~14% total refunds (~75% cash). Latest 35 days of individual records retained relative to `safeDate`.
- **Expected sales**: Prior-year matching day (`364` days earlier, adjusted for moved events or 364-day event collisions by stepping back 7 days) × `(1 + 26-week median established YoY growth)`.

## 4. Dates & Verified Timeline

- **History**: `2025-01-01` to `2026-07-31`.
- **Live window**: `2026-08-01` to `2026-11-14` (106 days).
- **Verified first-occurrence dates (`DEFAULT_SEED = 20260801`, no decisions)**:
  - Summer lull let go by Calendar + Watcher: `2026-08-04` (target 3–8 Aug)
  - Labor Day moved (dip / jump let go): `2026-08-29` / `2026-09-05` (target 29 Aug – 8 Sep)
  - First Best-sellers cover < 2.5 wks (big 3): `2026-09-08` (target 4–8 Sep)
  - Lull-ending jump let go: `2026-09-08` (target 9–15 Sep)
  - Napa fade let go by Opening ramp + Watcher: `2026-09-25` (target 15 Sep – 5 Oct)
  - Big 3 Best-sellers stockout (`0` units): `2026-09-21` (target 20–25 Sep)
  - Knitwear < 2.5 wks at Walnut Creek: `2026-09-25` (target 24 Sep)
  - Refunds out of line at Walnut Creek: detected `2026-09-30`, raised by instinct `2026-10-03` (target 2 Oct)
  - Like-for-like break (2 full weeks > 8 pts below, linked inside Best-sellers): `2026-10-05` (target 5 Oct)
  - Knitwear < 2.5 wks at Pasadena: `2026-10-15` (target 14 Oct)
  - Knitwear < 2.5 wks at Napa: `2026-11-01` (target 2 Nov)
  - Best-sellers delivery rebound (`2026-11-12` at Union Square, Palo Alto, Santana Row): silenced by `stock_returned` (`2026-11-09` delivery) and Watcher (`stay_quiet`).
  - Mid-October (`2026-10-15`) check: LFL `14.5` points below expectation while total all-store 28-day sales vs last year are `+12.4%`.
