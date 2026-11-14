# OpsCien Instinct — Architecture & Design Log

Updated through **Stage 4 of 6** (Section 0 Stage 3 fixes: single-flight non-decreasing request lock, incremental server-side day cache, strict >=1d Skip to next event, plain-words let-go lines without internal IDs, 90s investigation timeouts + fallback reporting; plus **The Builder**: Walnut Creek refunds `tool_to_build` breakdown, structured 5-part Requirement, Gemini single-file HTML tool generation, `<iframe sandbox="allow-scripts">` CSP & 3-test + 1-repair verification gate, `/dev` broken-tool harness, Gateway `store_manager_task` + `refund_switch` approval, 21-day before/after proof, and Watcher briefing integration).

## 1. Module List

| Module | Purpose |
|---|---|
| `src/types/domain.ts` | Core TypeScript shapes (`Fact`, `Candidate`, `SilenceCheckResult`, `ScheduledDelivery`, `DeliveredStockEvent`, `RaisedItem`, `SupportingEvidence`, `NoticedAndLetGoItem`, `GroupedLetGoItem`, `TraceEntry`, `ActionDecision`, `DayOneBrief`, `DayState`, `DiagnosticReport`), Stage 2 shapes, Stage 3 shapes, and Stage 4 shapes (`BuilderRequirement`, `ToolTestCaseResult`, `BuiltToolRecord`, `builder` trace kind, `refund_switch`, `store_manager_task`, `worked_before_after`, `beforeRefundRateFact`, `afterRefundRateFact`, `isSimulatedTask`, `refundRows`, `toolUnreviewedFact`). |
| `src/engine/prng.ts` | Deterministic Mulberry32/FNV-1a seeded hash (`DEFAULT_SEED = 20260801`) for reproducible noise and refund records in both Node and browser. |
| `src/engine/facts.ts` | `createFact()` and `formatFactValue()` ensuring every displayed figure carries an `id`, numeric `value`, formatted string, `unit`, and plain-words computation `note`. |
| `src/engine/calendar.ts` | Trading calendar (`TRADING_CALENDAR`), season/event span lookups, ISO week helper (`getIsoWeekKey`), and prior-year matching-day logic (`getMatchingPriorYearDate`). |
| `src/engine/stores.ts` | Catalog of the 10 **Linden & Rye** stores (8 established, 2 new) and 3 product groups (`best_sellers`, `knitwear`, `everything_else`). |
| `src/engine/simulation.ts` | Pure deterministic simulation engine from `2025-01-01` to `2026-11-14`, tracking daily sales, stock depletion, delivery schedule (`scheduledDeliveries`, `deliveredEvents`), gateway-approved `transferLines` (deducted from donors on `decision.date`, added to receivers on `arrivalDate` = `date + 2` days, reversed on `undoneOnDate`), Walnut Creek refund logs (latest 35 days, with Gateway-approved `refund_switch` stopping extra cash refunds on `date > decision.date`), and the Day One brief. |
| `src/detectors/detectors.ts` | Six cheap/wide anomaly detectors (`drop_or_jump`, `day_out_of_line`, `lfl_break`, `store_out_of_line`, `stock_running_out`, `refunds_out_of_line`) emitting stable `kind:thing` IDs. |
| `src/detectors/silenceChecks.ts` | Five silence checks (`calendar`, `opening_ramp`, `partial_period`, `already_handled` writing plain English dates/titles with zero internal IDs, `stock_returned`). |
| `src/engine/runner.ts` | Stage 1 baseline live-window timeline builder (`buildLiveTimeline`), stock-consequence linking, grouping repeated let-go lines per reason/week without duplicate single-store count tags, and `runFullDiagnostics`. |
| `src/engine/stage2Timeline.ts` | Incremental cached server-side live timeline evaluator (`evaluateStage2UpToDay`, `clearTimelineSnapshotCache`) reusing prior-day snapshots keyed by seed + decisions + reactions + builtTools + reviewedRefundIds hash, and rebuilding cleanly from Day 0 when memory is empty. |
| `src/gemini/settings.ts` | Single settings file (`v1beta`), per-job model fallback chains (`watcher`, `investigate_large`, `investigate_routine` at `90s` first timeout, `day_one_description`, `code_execution`, `builder_requirement` at `45s`/`30s`, `builder_tool` at `120s`/`120s` with `thinking_level: "medium"`), thresholds, daily caps, and Google list token pricing. |
| `src/gemini/client.ts` | Server-only `@google/genai` client (`apiVersion: "v1beta"`, `retries: { strategy: 'none' }`), `callDecisionsRaw`, `callInteractionRaw` (supporting JSON schema, plain text, `function`, and `code_execution` tools), in-memory SHA-256 request cache preserving original live `latencyMs` & tokens on replay, daily cap tracking, cost logging, and `runConnectionTests()`. |
| `src/gemini/placeholders.ts` | `validateAndResolvePlaceholders()` + `countSegmentsWords()` enforcing zero typed digits `0-9` outside `{{fact_id}}` placeholders. |
| `src/gemini/dayOne.ts` | Generates the 3-paragraph Day One description via `day_one_description` using `{{fact_id}}` placeholders with 1 retry and code fallback. |
| `src/watcher/briefing.ts` | `buildWatcherBriefing()` constructing a plain-words daily briefing strictly `<= date`, including installed Refund exceptions desk unreviewed flagged count. |
| `src/watcher/watcher.ts` | `evaluateWatcherBatch()` running 1 batched Decisions request per candidate day plus pair-merge checks, structured fallback (`gemini-3.5-flash-lite`), code fallback, disagreement guard, and eval log. |
| `src/checker/tools.ts` | Exposes the 10 Checker code tools (8 Stage 2 tools + `compute_transfer_plan` + Stage 4 `get_refund_breakdown` by method, till, operator, `>= 20:00`, linkedOrder), reading strictly `<= date`. |
| `src/checker/transferPlan.ts` | Pure deterministic transfer planner holding out `Santana Row` when `>= 3` stores qualify and enforcing 8-week and next-delivery+1-week donor floors. |
| `src/checker/secondCheck.ts` | Second Check via Gemini `code_execution` (`gemini-4-hydrogen` → `gemini-3.8-flash`) on `<= date` daily CSV rows. |
| `src/checker/checker.ts` | `runSituationInvestigation()` running tool loop + structured JSON (`<= 25` words per finding/cause/proposal), recommending `tool_to_build` with `build_refund_desk` and `ask_store_manager` options for Walnut Creek refunds, plus plain ruled-out sentences and code fallback. |
| `src/gateway/gateway.ts` | The **One Action Gateway** (`executeActionThroughGateway`), enforcing stock cover floors, approval requirements, `refund_switch` (21-day proof), `store_manager_task` (3-day due date), direct stock refusal, and 3-case self-test. |
| `src/followup/proof.ts` | Follow-up & Proof evaluator (`evaluateActionsUpToDate`) driving **In progress**, held-out trial closure (`worked_proven` / `did_not_work` / `unclear`), `store_manager_task` simulated 3-day follow-up, and `refund_switch` 21-day before/after proof (`worked_before_after`, `"Likely worked. One store, before and after: not proven."` with `beforeRefundRateFact` and `afterRefundRateFact`). |
| `src/builder/requirement.ts`, `src/builder/builder.ts`, `src/builder/tester.ts`, `src/builder/fallbackTool.ts` | Stage 4 Builder modules: structured 5-part Requirement generator (`{{fact_id}}` validated), Gemini plain-text single-file HTML generator (`thinking_level: "medium"`), single repair loop, pre-written fallback (`"Fallback copy, not built live."`), CSP header wrapper, `computeExpectedFlaggedStats`, and 3-test browser `<iframe sandbox="allow-scripts">` verification harness + Check 5 broken draft. |
| `src/engine/simulation.test.ts`, `src/gemini/stage2.test.ts`, `src/gemini/stage3.test.ts`, `src/builder/stage4.test.ts` | `node:test` suites covering Stages 1–4, Section 0 incremental cache, plain-words let-go checks, refund breakdown, 3-test sandbox evaluation, refund switch stop-effect, and 21-day before/after proof. |
| `server.ts` | Express server on port 3000 adding `/api/action/store-manager`, `/api/builder/requirement`, `/api/builder/build`, `/api/builder/repair`, `/api/builder/install`, `/api/builder/switch-approve`, `/api/dev/broken-tool-test`, and strictly `>= +1d` `/api/timeline/next-event`. |
| `src/App.tsx`, `src/components/*`, `src/components/BuiltToolPanel.tsx` | React UI with single-flight non-decreasing request lock, **Needs you** Requirement/Build flow, `<iframe sandbox="allow-scripts">` `BuiltToolPanel` overlay + Gateway switch confirmation, **In progress**, **Done for you**, **Tools I built** (with 3 check rows and unreviewed flagged fact), and `/dev` Check 5 broken-tool repair panel. |

## 2. Core Data Shapes

- **`Fact`**: `{ id, label, value, formatted, unit, note }` — code computes every number; UI renders numbers exclusively through `FactValue`. Every fact on day `D` comes strictly from data `<= D`.
- **`TextSegment`**: `{ type: 'text', text } | { type: 'fact', fact: Fact }`.
- **`BuilderRequirement`**: `{ situationId, title, generatedOn, purpose, users, shows, actions, verification, plainSummary, factsById, model, mode, latencyMs, inputTokens, outputTokens, usedFallbackWording }`.
- **`BuiltToolRecord`**: `{ id, situationId, title, storeId, storeName, installedOn, html, model, mode, latencyMs, inputTokens, outputTokens, byteSize, usedFallbackCopy, repairedOnce, repairReason?, requirement, testResults }`.
- **`ActionDecision`**: `{ id, date, candidateId, kind: 'transfer' | 'control_holdout' | 'refund_audit' | 'refund_switch' | 'store_manager_task' | 'other', storeId?, groupId?, arrivalDate?, dueDate?, toolId?, transferLines?, holdoutStoreId?, holdoutStoreName?, totalUnits?, approvedBy?, approvedAtDate?, measure?, proofEndDate?, undoneOnDate?, parentDecisionId?, title? }`.
- **`InProgressAction` / `DoneForYouItem`**: Support `beforeRefundRateFact`, `afterRefundRateFact`, `isSimulatedTask`, `verdict: 'worked_proven' | 'worked_before_after' | 'unclear' | 'did_not_work'`, `detailSentence`.
- **`DayState`**: Pure immutable snapshot for day `D` including `builtTools`, `refundSwitchEnabled`, `reviewedRefundIds`, `refundRows`, and `toolUnreviewedFact`.

## 3. Simulation Rules, Gateway & Proof Parameters

- **Chain**: **Linden & Rye** (California womenswear, USD), 8 established stores + 2 new openings (`Burlingame` Jun 1, `Napa` Aug 22).
- **One Gateway (`src/gateway/gateway.ts`)**: Enforces donor 8-week and delivery+1-week cover floors, `> 500` unit approval, `store_manager_task` (+3d due), `refund_switch` (+21d before/after proof), and direct stock mutation refusal.
- **Builder Sandbox & Verification Gate**:
  - Requirement generated first via `builder_requirement` schema (`{{fact_id}}`, zero typed digits); single-file HTML generated via `builder_tool` (`thinking_level: "medium"`, plain text, no `max_output_tokens`).
  - Rendered exclusively inside `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) with CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';`.
  - Automated 3-test suite: (1) loads with zero `script_error` within 5 s, (2) reported `flagged_summary` `count` and cent-rounded `total` match `computeExpectedFlaggedStats` (`method === 'cash' && time >= '20:00' && !linkedOrder && till === 2 && operatorNumber === 14`), (3) acknowledges `{ type: 'test_mark_reviewed' }`. On failure, repairs at most once; if failed twice, displays `"I could not build this to standard. Here is what failed."` and refuses install.
- **Follow-up & Proof**: Held-out store trials prove at 7 consecutive days `> +10 pts` (`worked_proven`); Walnut Creek refund approval switch halts extra cash refunds starting `date > switchDate` and closes after 21 days as `"Likely worked. One store, before and after: not proven."` (`worked_before_after`).

## 4. Dates & Verified Timeline

- **History**: `2025-01-01` to `2026-07-31`.
- **Live window**: `2026-08-01` to `2026-11-14` (106 days).
- **Stage 1–3 verified first-occurrence dates (`DEFAULT_SEED = 20260801`)**:
  - Best-sellers first cover < 2.5 wks: `2026-09-08`; Early approve Sep 8 -> arrives `2026-09-10` -> proven `2026-09-30` -> Rollout card; Deferral Sep 8 -> re-raises `2026-09-23` -> late approve Oct 5 -> proven by `2026-10-16`.
- **Stage 4 verified dates (`DEFAULT_SEED = 20260801`)**:
  - Walnut Creek refunds raised `2026-10-03` (`tool_to_build`: `Build` + `Ask store manager`); `Ask store manager` sets 3-day simulated task due `2026-10-06`; Build & install on `2026-10-03` + Gateway `refund_switch` approval stops extra Till 2 operator 14 cash refunds starting `2026-10-04` and closes 21-day proof on `2026-10-24`/`2026-10-25` as `"Likely worked. One store, before and after: not proven."`.
  - Verified `/dev` Check 5 broken-tool repair flow (`createDeliberatelyBrokenToolHtml` -> caught math & `test_mark_reviewed` failures -> single repair on `gemini-4-carbon` -> 3/3 sandbox checks passed) and `store_manager_task` causal isolation in `src/watcher/briefing.ts` and `src/engine/stage2Timeline.ts`.
