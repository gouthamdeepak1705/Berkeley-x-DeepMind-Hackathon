# Opscien Instinct — Architecture & Design Log

Updated through **Final Stage (Simple View Redesign for Business Owners & Investors)**: Preserves the entire deterministic engine, Gateway, counterfactual/proof rules, Gemini prompts, and `/recorded_run.json` (`167` entries, `0` live calls & `0` fallbacks during **Watch it run**), while introducing a calm, warm, plain-English default **Simple View** (`#FFF8E8` paper, `#25372C` forest ink, `Inter` with `tabular-nums`, zero monospace, zero all-caps, `"Opscien"` naming) and preserving the original analyst screen intact behind **"Show technical detail"** (or `?view=technical`).

## 1. Module List

| Module | Purpose |
|---|---|
| `src/types/domain.ts` | Core TypeScript shapes (`Fact`, `Candidate`, `SilenceCheckResult`, `ScheduledDelivery`, `DeliveredStockEvent`, `RaisedItem`, `SupportingEvidence`, `NoticedAndLetGoItem`, `GroupedLetGoItem`, `TraceEntry`, `ActionDecision`, `DayOneBrief`, `DayState`, `DiagnosticReport`), Stage 2–4 shapes, Stage 5 autonomy/statement shapes, and Stage 6 Simple View shapes (`MoneyAccountSummary`, `StoreBoardEntry`, `WorkCountersSummary`, `ProblemMoneyBreakdown`, `TurnedDownWarning`, `TourStop`, `CardVisualMetrics`). |
| `src/engine/prng.ts` | Deterministic Mulberry32/FNV-1a seeded hash (`DEFAULT_SEED = 20260801`) for reproducible noise and refund records in both Node and browser. |
| `src/engine/facts.ts` | `createFact()` and `formatFactValue()` ensuring every displayed figure carries an `id`, numeric `value`, formatted string, `unit`, and plain-words computation `note`. `FactValue.tsx` supports `plainFont` & `noPlus` formatting (`9.9%`, `14.5 points`). |
| `src/engine/calendar.ts` | Trading calendar (`TRADING_CALENDAR`), season/event span lookups, ISO week helper (`getIsoWeekKey`), and prior-year matching-day logic (`getMatchingPriorYearDate`). |
| `src/engine/stores.ts` | Catalog of the 10 **Linden & Rye** stores (8 established, 2 new) and 3 product groups (`best_sellers`, `knitwear`, `everything_else`). |
| `src/engine/simulation.ts` | Pure deterministic simulation engine from `2025-01-01` to `2026-11-14`, tracking daily sales, stock depletion, delivery schedule, gateway-approved `transferLines`, Walnut Creek refund logs, and the Day One brief. |
| `src/detectors/detectors.ts` | Six cheap/wide anomaly detectors (`drop_or_jump`, `day_out_of_line`, `lfl_break`, `store_out_of_line`, `stock_running_out`, `refunds_out_of_line`) emitting stable `kind:thing` IDs and ground-truth tags. |
| `src/detectors/silenceChecks.ts` | Five silence checks (`calendar`, `opening_ramp`, `partial_period`, `already_handled` matching strictly prior-day `d.date < date`, `stock_returned`). |
| `src/engine/runner.ts` | Stage 1 baseline live-window timeline builder (`buildLiveTimeline`), stock-consequence linking, grouped let-go lines, and `runFullDiagnostics`. |
| `src/engine/stage2Timeline.ts` | Incremental cached evaluator (`evaluateStage2UpToDay`), store-scoped `dismissedStockStores`, autonomous `< 500`-unit single-store transfer handling, persistent `askedOwnerKeys` tracking across cached re-runs, `moneyAccount` (`buildMoneyAccount`), `storeBoard` (`buildStoreBoard`), and 14 November `EndStatementData`. |
| `src/engine/demoDriver.ts` | Pure calm status line generator (`computeCalmStatusLine`) and deterministic Watch-it-run beat scheduler (`selectNextWatchDemoBeat`, `selectWatchCaptionForDay`). |
| `src/engine/tourDriver.ts` | Deterministic 8-stop Guided Tour script (`TOUR_STOPS`: Sep 8, Sep 25, Sep 27, Sep 30, Oct 5, Oct 15, Nov 1, Nov 14) with button highlight selectors and plain-English coaching copy. |
| `src/money/account.ts` | Pure counterfactual & real-time money accounting engine strictly bounded by `<= currentDate` (zero lookahead): computes **Lost without Opscien**, **Lost so far**, **Saved so far** (`Proven` + `Likely`), **At risk now**, per-problem & per-store breakdowns, **Warnings you turned down**, work counters, store stock/sales board (`All 10 stores`), and **ProofComparisonVisual** / **RefundComparisonVisual** card metrics. |
| `src/autonomy/record.ts` | Stage 5 autonomy evaluator tracking `"Stock transfer between stores"` record, net money result, the earn rule (last 3 worked, >= 1 proven, 0 undone), Indigo offer card, and revocation on failure or 2 consecutive undos. |
| `src/statement/statement.ts` | 14 November End Statement builder (`buildEndStatement`) computing noticing scores, money, mistakes/unproven items, cost, and built tools exclusively as `Fact`s. |
| `src/gemini/settings.ts` | Single settings file (`v1beta`), per-job model fallback chains, daily caps, and Google list pricing. |
| `src/gemini/client.ts` | Server-only `@google/genai` client supporting `GeminiPlaybackMode` (`'replay'` = **"Recorded, live when needed"** default vs `'live'` = **"Always live"**), auto-loading `/recorded_run.json` (`167` entries, zero live calls on the recorded path), live fallback on diverged paths within daily caps, and SHA-256 request caching. |
| `src/gemini/placeholders.ts` | Post-response placeholder validation and fallback resolution guaranteeing zero raw `{{` / `}}` reach the UI. |
| `src/gemini/dayOne.ts`, `src/watcher/*`, `src/checker/*` | Unchanged Day One brief generator, daily Watcher briefing & batched decisions, 10 Checker code tools, Python Second Check, and transfer planner. |
| `src/gateway/gateway.ts` | **One Action Gateway** (`executeActionThroughGateway`), enforcing donor stock floors, approval vs autonomy-within-limits (`<= 500` units, 1 store, no holdout), `refund_switch`, `store_manager_task`, and transfer reversal on `Undo`. |
| `src/followup/proof.ts` | Evaluates **In progress** trials, held-out comparison proofs (`worked_proven`), single-store 7-day before/after checks (`worked_single_store`), 21-day `refund_switch` before/after checks (`worked_before_after`), and `undone` reversals. |
| `src/builder/*` | Stage 4 Builder modules: 5-part Requirement, single-file HTML generation, 1-repair loop, fallback copy, browser-safe `sandboxUtils.ts`, and 3-test browser `<iframe sandbox="allow-scripts">` harness. |
| `src/components/simple/*` | Plain-English Simple View UI: `WelcomeScreen.tsx` (+ `AboutBusinessModal`), `SimpleTopBar.tsx`, `MoneyBar.tsx` (+ interactive Problem/Store breakdown drawer), `SimpleOwnerFeed.tsx`, `SimpleProblemCard.tsx`, `VisualDiagrams.tsx` (`StockShortageVisual`, `TransferFlowVisual`, `ProofComparisonVisual`, `RefundComparisonVisual`), `InlineBuiltRefundToolCard.tsx`, `TeamPanel.tsx` (`Manager`, `Data scientist`, `Developer`), `StoreBoard.tsx` (`All 10 stores` largest-first), `StoreDetailModal.tsx`, `TourOverlay.tsx`, `SimpleResultPage.tsx`, and `SimpleHelpers.tsx` (`toSimpleEnglish`, `AnimatedUsd`, `ProofPill`, `LiveWorkingBanner`). |
| `src/App.tsx`, `src/components/*` | Dual-mode shell defaulting to **Simple View** (`"Show technical detail"` OFF, or ON via `?view=technical`), preserving the complete analyst UI (`DayOneScreen`, `OwnerFeed`, `BehindTheScreen`, `EndStatement`, `RealityNoteModal`, `FactPopover`). |
| `server.ts` | Express server on port 3000 providing timeline evaluation, `next-event` stepping, investigation SSE, gateway actions, autonomy `/api/autonomy/respond` & `/api/action/undo`, `/api/gemini/mode`, builder endpoints, and `/dev` diagnostics. |
| `src/engine/*.test.ts`, `src/gemini/*.test.ts`, `src/builder/*.test.ts`, `src/autonomy/*.test.ts`, `src/stage5.test.ts`, `src/money/account.test.ts` | 8 automated `node:test` suites (`28` tests total) verifying Stages 1–6, counterfactual money math (`$449,103` / `$23,196` / `$425,907`), zero lookahead, and the 8-stop Guided Tour. |

## 2. Core Data Shapes

- **`Fact`**: `{ id, label, value, formatted, unit, note }` — code computes every number; UI renders numbers exclusively via `FactValue` (clickable explanation popover; Simple View renders plain `Inter` without internal `fact.id` / `unit:` chrome).
- **`MoneyAccountSummary`**: `{ asOfDate, withoutOpscienFact, lostSoFarFact, savedSoFarFact, savedProvenFact, savedLikelyFact, atRiskNowFact, byProblem, byStore, turnedDownWarnings, workCounters }`.
- **`StoreBoardEntry`**: `{ storeId, storeName, sizeRank, status, statusLabel, bestSellersWeeksFact, knitwearWeeksFact, sales7dActualFact, sales7dExpectedFact, savedSoFarFact, lostSoFarFact, chartPoints }`.
- **`RecordedRunFile`**: `{ version: 1, generatedAt, seed, entries: RecordedRunEntry[] }` stored at `/recorded_run.json` (`167` live Gemini entries verified at `0` fallbacks and `0` live calls during **Watch it run** Replay).

## 3. Simulation Rules, Counterfactual Baseline & Autonomy Limits

- **Chain**: **Linden & Rye** (California womenswear, USD), 8 established stores + 2 new openings (`Burlingame` Jun 1, `Napa` Aug 22).
- **Counterfactual Formula (`Without Opscien`)**: Runs a deterministic zero-decision reference simulation (`decisions = []`) up to `asOfDate` (`<= date`), summing unfulfilled potential stockout sales across the 10 stores plus extra Walnut Creek evening Till 2 operator 14 unlinked cash refunds (`> $50`). On any simulated day `t`:
  - `Saved so far = Lost without Opscien − Lost so far`
  - Split strictly by proof status per store/problem: **Proven** (transfer closed as `worked_proven` against a store held back for comparison) vs **Likely** (before/after at one store).
- **One Gateway & Autonomy Limits**: By default all actions require owner approval (`"I recommend, you decide"`). Only `"Stock transfer between stores"` can earn autonomous execution — requiring the last 3 completed transfers to work, at least 1 proven against a store held back for comparison, 0 undone, and explicit owner acceptance (**Yes, within those limits**). Once granted, single-store transfers `<= 500` units with no holdout execute automatically into **Done for you** with an **Undo** button; transfers `> 500` units still require owner approval.

## 4. Dates & Verified 14 November Timeline (`DEFAULT_SEED = 20260801`)

- **History**: `2025-01-01` to `2026-07-31`. **Live window**: `2026-08-01` to `2026-11-14` (106 days).
- **Verified 14 November Totals (Guided Tour & Watch it run)**:
  - **Lost without Opscien**: `$449,103`
  - **Lost with Opscien**: `$23,196` (`$14,734` at Santana Row held back for comparison + `$8,462` Walnut Creek cash refunds before the `$50` rule started)
  - **Opscien saved**: `$425,907` (`Proven: $282,099` · `Likely: $143,808`)
  - **Noticing & Work**: `5 of 5` real problems raised (typical `13 days` early), `0 of 6` false alarms raised (`72` stayed quiet), `6` owner decisions (`Asked you 6 times`), `2` autonomous transfers (`Acted alone 2 times`), `4,489` units moved with `0` extra stock bought, `1` store refund tool built & tested (`3/3` sandbox checks), `0` live calls & `0` fallbacks on the recorded Watch path.
- **Milestones**:
  1. `2026-09-08`: Best-sellers low (`Union Square, Palo Alto, Santana Row`) -> Approve `2,453` units (`Santana Row` held back for comparison) -> proven `2026-09-27` (`$36,882`, `99.6%` vs `87.9%`) -> Rollout `761` units approved `2026-09-27` -> closes `2026-10-05`.
  2. `2026-09-25`: Walnut Creek Knitwear (`479` units, `investigate_routine`) -> Approve -> closes `2026-10-03`.
  3. `2026-09-30`: Walnut Creek cash refunds -> Build tool HTML + `3/3` sandbox checks -> Open tool & approve `$50` cash refund switch -> closes `2026-10-21` (`11.3%` before -> `4.0%` after).
  4. `2026-10-05`: Autonomy earn rule met (`3/3` worked, `1` proven, `0` undone) -> Indigo offer accepted (**Yes, within those limits**).
  5. `2026-10-15`: Pasadena Knitwear (`424` units `< 500`) executes automatically -> closes `2026-10-23`.
  6. `2026-11-01`: Napa Knitwear (`372` units `< 500`) executes automatically -> closes `2026-11-09` -> `2026-11-14` Result Page.
