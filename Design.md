# OpsCien Instinct — Architecture & Design Log

Updated through **Stage 3 of 6** (Stage 2 polish fixes + Second Check with Gemini `code_execution`, owner reactions [`Approve`, `Not now` with worsening re-raise + cost of delay, `Dismiss` with 4 reasons], One Action Gateway enforcing hard code limits, Transfer Plan with hold-out control store, and Follow-up & Proof closing loop).

## 1. Module List

| Module | Purpose |
|---|---|
| `src/types/domain.ts` | Core TypeScript shapes (`Fact`, `Candidate`, `SilenceCheckResult`, `ScheduledDelivery`, `DeliveredStockEvent`, `RaisedItem`, `SupportingEvidence`, `NoticedAndLetGoItem`, `GroupedLetGoItem`, `TraceEntry`, `ActionDecision`, `DayOneBrief`, `DayState`, `DiagnosticReport`), Stage 2 shapes (`TextSegment`, `InvestigationResult`, `InvestigationRuledOut`, `InvestigationOption`, `InvestigationToolTrace`, `InstinctMeta`, `WatcherEvalRecord`), and Stage 3 shapes (`SecondCheckResult`, `TransferLine`, `TransferPlan`, `DecisionTraceRow`, `DismissReason`, `CardReaction`, `InProgressAction`, `DoneForYouItem`). |
| `src/engine/prng.ts` | Deterministic Mulberry32/FNV-1a seeded hash (`DEFAULT_SEED = 20260801`) for reproducible noise and refund records in both Node and browser. |
| `src/engine/facts.ts` | `createFact()` and `formatFactValue()` ensuring every displayed figure carries an `id`, numeric `value`, formatted string, `unit`, and plain-words computation `note`. |
| `src/engine/calendar.ts` | Trading calendar (`TRADING_CALENDAR`), season/event span lookups, ISO week helper (`getIsoWeekKey`), and prior-year matching-day logic (`getMatchingPriorYearDate`). |
| `src/engine/stores.ts` | Catalog of the 10 **Linden & Rye** stores (8 established, 2 new) and 3 product groups (`best_sellers`, `knitwear`, `everything_else`). |
| `src/engine/simulation.ts` | Pure deterministic simulation engine from `2025-01-01` to `2026-11-14`, tracking daily sales, stock depletion, delivery schedule (`scheduledDeliveries`, `deliveredEvents`, `isDeliveryDueWithinDays`, `getRecentZeroRecoveryDelivery`), gateway-approved `transferLines` (deducted from donors on `decision.date`, added to receivers on `arrivalDate` = `date + 2` days, reversed on `undoneOnDate`), weeks of cover, 26-week median growth, Walnut Creek refund logs (latest 35 days), and the Day One brief. |
| `src/detectors/detectors.ts` | Six cheap/wide anomaly detectors (`drop_or_jump`, `day_out_of_line`, `lfl_break`, `store_out_of_line`, `stock_running_out`, `refunds_out_of_line`) emitting stable `kind:thing` IDs. |
| `src/detectors/silenceChecks.ts` | Five silence checks (`calendar`, `opening_ramp`, `partial_period`, `already_handled` matching active transfers by `toStoreId` + `groupId`, `stock_returned`). |
| `src/engine/runner.ts` | Stage 1 baseline live-window (`2026-08-01` to `2026-11-14`) timeline builder (`buildLiveTimeline`), general stock-consequence linking (`>= 50%` lost sales), same-group stock situation merging, grouped **Noticed and let go** summaries, and `runFullDiagnostics`. |
| `src/engine/stage2Timeline.ts` | Server-side live timeline evaluator (`evaluateStage2UpToDay`) layering Watcher decisions, pair-merging, Checker investigations, live "today" snapshots, `lfl_break` total-sales-positive evidence, Stage 3 owner reactions (`approve`, `not_now` worsening re-raise + `costOfDelayFact`, `dismiss`), Follow-up & Proof (`inProgress`, `doneForYou`, rollout cards, automatic undo), Gateway logs, and structured Manager/Data scientist trace entries. |
| `src/gemini/settings.ts` | Single settings file for `v1beta` API version, per-job model fallback chains (`watcher`, `investigate_large`, `investigate_routine`, `day_one_description`, `code_execution`), `thinking_level: "low"`, timeouts (`5s` decision; `45s`/`25s` investigation; `35s`/`25s` code execution), Watcher thresholds (`raise >= 0.6`, `explained < 0.5`, `merge > 0.7`, `maxMergePairsPerRequest = 10`), Checker limits (`maxToolRounds = 10`, `maxPlaceholderRetries = 1`, `maxProseWords = 25`), daily uncached caps (`2,000` decision / `300` other), and Google list token pricing (`0.10/0`, `2.00/10.00`, `2.00/10.00`, `1.50/7.50`, `0.75/3.75`, `0.30/2.50`). |
| `src/gemini/client.ts` | Server-only `@google/genai` client (`apiVersion: "v1beta"`, `retries: { strategy: 'none' }`), `callDecisionsRaw`, `callInteractionRaw` (supporting `function` and `code_execution` tools), in-memory SHA-256 request cache preserving original live `latencyMs` & tokens on replay, daily cap tracking, cost logging, and `runConnectionTests()` covering all 5 jobs. |
| `src/gemini/placeholders.ts` | `validateAndResolvePlaceholders()` + `countSegmentsWords()` enforcing zero typed digits `0-9` outside `{{fact_id}}` placeholders and 25-word limits on Checker prose. |
| `src/gemini/dayOne.ts` | Generates the 3-paragraph Day One description via `day_one_description` using `{{fact_id}}` placeholders with 1 retry and code fallback. |
| `src/watcher/briefing.ts` | `buildWatcherBriefing()` constructing a plain-words daily briefing from computed facts `<= date`. |
| `src/watcher/watcher.ts` | `evaluateWatcherBatch()` running 1 batched Decisions request per candidate day (`choice`, `explained`, `actionable`, `urgency`, plus up to 10 pair-merge checks), structured fallback (`gemini-3.5-flash-lite`), Stage 1 code fallback, disagreement guard, and Stage 6 eval log. |
| `src/checker/tools.ts` | Exposes the 9 Checker code tools (8 Stage 2 investigation/audit tools + Stage 3 `compute_transfer_plan`), reading strictly `<= date` and returning `Fact`s with IDs. |
| `src/checker/transferPlan.ts` | Pure deterministic transfer planner (`buildTransferPlanForGroup`) selecting receivers `< 2.5` wks or projected `< 2.5` wks in 7 days, holding out the smallest-sales store when `>= 3` stores qualify (`Santana Row`), ordering donors highest cover first, enforcing the 8-week and next-delivery+1-week donor floors, and computing shortfalls, arrival (`+2` days), measure, and proof end date (`+28` days). |
| `src/checker/secondCheck.ts` | Second Check via Gemini `code_execution` (`gemini-4-hydrogen` → `gemini-3.8-flash`, `thinking_level: "low"`, no `response_format`) on `<= date` daily CSV rows, parsing Python stdout and labeling `"Checked two ways"` (`<= 1%`), `"The two checks disagree"`, or `"Second check not available"`. |
| `src/checker/checker.ts` | `runSituationInvestigation()` running the Interactions API tool loop + structured JSON (`<= 25` words per finding/cause/proposal), `buildRuledOutSentences()` (plain sentences with inline tappable facts), `runSecondCheck()`, `buildTransferPlanForGroup()`, and code fallback. |
| `src/gateway/gateway.ts` | The **One Action Gateway** (`executeActionThroughGateway`), enforcing donor 8-week and next-delivery+1-week cover floors, `> 500` units approval requirement, non-bypassable direct stock refusal (`attemptDirectStockMutationBypass`), attempt log, and 3-case self-test (`runGatewaySelfTests`). |
| `src/followup/proof.ts` | Follow-up & Proof evaluator (`evaluateActionsUpToDate`) driving **In progress**, 7-day post-arrival checkpoints, daily treated-vs-control `actual/expected` ratio gap, closing at 7 consecutive days `> +10 pts` as `"Worked. Proven against the held-out store."` with cumulative `expected * gap` dollar `Fact` + `"Roll out to the held-out store?"` card, closing at 28 days as `"Unclear."`, or closing + undoing on 7 consecutive negative days. |
| `src/engine/simulation.test.ts`, `src/gemini/stage2.test.ts`, `src/gemini/stage3.test.ts` | `node:test` suites verifying Stage 1 determinism/target dates/no-future-facts, Stage 2 placeholder/tool checks/no-key fallback, Stage 2 fixes, Gateway 3 forbidden actions, Transfer Plan holdout/floors, Early & Late approval proof cycles, Deferral + Cost of Delay, and Dismiss. |
| `server.ts` | Express server on port 3000 with `/api/health`, `/api/day-one`, `/api/diagnostics`, `/api/gemini/stats`, `/api/dev/connection-test`, `/api/dev/gateway-test`, `/api/dev/clear-cache`, `/api/timeline/step`, `/api/timeline/next-event`, SSE `/api/timeline/investigate-stream`, `/api/action/approve`, `/api/action/react`, and `/api/action/look-again`. |
| `src/components/DayOneScreen.tsx`, `ClockHeader.tsx`, `SalesChart.tsx`, `OwnerFeed.tsx`, `TracePanel.tsx`, `FactValue.tsx`, `FactPopover.tsx`, `RealityNoteModal.tsx`, `DevDiagnosticsPage.tsx` | React UI with **Needs you**, **In progress**, **Done for you**, **Noticed and let go**, **Tools I built**, **Record**, structured Manager decision rows, `(replayed)` original model latencies, Approve / Not now / Dismiss (4 reasons) / Look again controls, Transfer Plan preview, Second Check banner, and `/dev` Connection & Gateway tests. |

## 2. Core Data Shapes

- **`Fact`**: `{ id, label, value, formatted, unit, note }` — code computes every number; UI renders numbers exclusively through `FactValue`. Every fact on day `D` comes strictly from data `<= D`.
- **`TextSegment`**: `{ type: 'text', text } | { type: 'fact', fact: Fact }` — resolved model prose where every figure is a tappable `Fact`.
- **`SecondCheckResult`**: `{ status: 'matched' | 'disagreed' | 'unavailable', label, firstValueFact, secondValueFact?, diffPct?, model, mode, latencyMs, pythonCode?, error? }`.
- **`TransferPlan`**: `{ groupId, groupName, receiverStoreIds, treatedStoreIds, holdoutStoreId?, holdoutStoreName?, holdoutSentence?, limitSentence, nextDeliveryDate, transferLines, totalUnitsFact, shortfallUnitsFact?, arrivalDate, weeklyRecoveryFact, measure, proofEndDate, requiresOwnerApproval }`.
- **`CardReaction`**: `{ id, candidateId, date, dayIndex, reaction: 'approve' | 'not_now' | 'dismiss', reason?: 'not_important' | 'already_known' | 'wrong' | 'not_mine', detail? }`.
- **`ActionDecision`**: `{ id, date, candidateId, kind: 'transfer' | 'control_holdout' | 'refund_audit' | 'other', storeId?, groupId?, arrivalDate?, transferLines?, holdoutStoreId?, holdoutStoreName?, totalUnits?, approvedBy?, approvedAtDate?, measure?, proofEndDate?, undoneOnDate?, parentDecisionId?, title? }`.
- **`InProgressAction`**: `{ decisionId, candidateId, title, measure, statusText, nextCheckpoint, endDate, arrivalDate, holdoutStoreName?, latestGapPtsFact? }`.
- **`DoneForYouItem`**: `{ decisionId, candidateId, title, verdict: 'worked_proven' | 'did_not_work' | 'unclear', verdictSentence, approvedOn, closedOn, provenMoneyFact?, undone?, holdoutStoreName? }`.
- **`RaisedItem` / `Situation`**: Adds `secondCheck?`, `transferPlan?`, `deferredOn?`, `reRaisedOn?`, `reRaiseReason?`, `costOfDelayFact?`, `isRollout?`, `parentDecisionId?`.
- **`DayState`**: Pure immutable snapshot for day `D` containing `chartPoints`, `headlineFacts`, `raised`, `inProgress`, `doneForYou`, `noticedAndLetGo`, `groupedLetGo`, `trace`, `todayCandidates`, `watcherEvalLog`, `pendingInvestigationId`, and `reactions`.

## 3. Simulation Rules, Gateway & Proof Parameters

- **Chain**: **Linden & Rye** (California womenswear, USD), 8 established stores + 2 new openings (`Burlingame` Jun 1, `Napa` Aug 22).
- **One Gateway (`src/gateway/gateway.ts`)**:
  - Every action mutating simulated business state must pass `executeActionThroughGateway`.
  - Enforces donor stock floor: `>= 8` weeks of cover AND `>= daysUntilNextDelivery / 7 + 1` weeks of cover.
  - Refuses transfers `> 500` units (and all unapproved actions) without `ownerApproved: true`.
  - Refuses direct stock mutations via `attemptDirectStockMutationBypass`.
- **Transfer Plan & Hold-out**:
  - Receivers = open stores with `weeksOfCover < 2.5` or projected `< 2.5` in 7 days.
  - When `>= 3` stores qualify, smallest-sales store (`Santana Row`) is held out as control; donors ordered highest cover first; arrival `date + 2` days; proof window `arrivalDate + 28` days.
- **Follow-up & Proof (`src/followup/proof.ts`)**:
  - Daily treated average `(actual ÷ expected)` minus held-out control `(actual ÷ expected)` gap.
  - 7-day post-arrival checkpoint logged in Data scientist trace.
  - Closes as `"Worked. Proven against the held-out store."` when `gap > +10 pts` for 7 consecutive days; computes cumulative `expected × gap` dollar `Fact`; emits `"Roll out to the held-out store?"` card; silences held-out store via `already_handled`.
  - Closes as `"Did not work. Undo applied."` and reverses transfer on 7 consecutive negative days; closes as `"Unclear."` after 28 days.
- **Deferral (`Not now`)**:
  - Hides card while checking daily; re-raises when supporting evidence expands OR stockouts lose sales for 3 consecutive days; displays original `firstDetectedOn`, `reRaisedOn`, and `Cost of delay so far` (`Fact`).

## 4. Dates & Verified Timeline

- **History**: `2025-01-01` to `2026-07-31`.
- **Live window**: `2026-08-01` to `2026-11-14` (106 days).
- **Stage 1/2 verified first-occurrence dates (`DEFAULT_SEED = 20260801`, no actions)**:
  - Summer lull let go: `2026-08-04`; Labor Day moved let go: `2026-08-29` / `2026-09-05`; First Best-sellers cover < 2.5 wks: `2026-09-08`; Lull-ending jump let go: `2026-09-08`; Big 3 Best-sellers stockout: `2026-09-21`; Napa fade let go: `2026-09-25`; Walnut Creek Knitwear < 2.5 wks: `2026-09-25`; Walnut Creek Refunds detected `2026-09-30`, raised `2026-10-03`; Like-for-like break (linked inside Best-sellers): `2026-10-05`; Pasadena Knitwear: `2026-10-15`; Napa Knitwear: `2026-11-01`; Nov 12 delivery rebound silenced by `stock_returned`.
- **Stage 3 verified action & proof dates (`DEFAULT_SEED = 20260801`)**:
  - **Early approval path**: Approve Best-sellers on `2026-09-08` -> arrives `2026-09-10` -> 7-day checkpoint `2026-09-17` -> proven (`"Worked. Proven against the held-out store."`) by `2026-09-30` once held-out Santana Row stocks out while Union Square & Palo Alto stay in stock -> Rollout card raised for Santana Row.
  - **Deferral & late approval path**: `Not now` on `2026-09-08` -> stays hidden through `2026-09-12` -> re-raises by `2026-09-23` after 3 lost-sales days with `Cost of delay so far` -> approve late (e.g., `2026-10-05`) -> arrives `2026-10-07` -> proven within ~9 days (`2026-10-14` / `2026-10-16`).
