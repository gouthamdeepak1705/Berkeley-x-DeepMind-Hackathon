# Prompt 2 of 6: the instinct (Gemini Decision) and the investigation (Gemini 4)

Send this only after stage 1 works: the developer page prints the dates and they are within 5 days of the targets.

---

Read `Design.md` first. This is stage 2 of 6 of OpsCien Instinct. Add the Gemini parts for noticing and investigating. Do not rewrite the simulation, detectors, silence checks or screen layout; add new files and only the hooks this stage needs. Update `Design.md` at the end.

## 1. One Gemini module on the server

Stage 1 runs entirely in the browser: the published app makes no calls to the server at all. This stage adds the server side. Move or share the simulation engine, detectors and silence checks so that the same code runs on the server, add the server routes this stage needs, and keep the screen working as it does now.

All Gemini calls go through one server module. The browser never holds the key and never sends a free-form prompt: it sends the day and the list of decisions taken; the server rebuilds the simulation state from those (the engine is deterministic) and owns every prompt, question and tool definition.

- **One settings file for model names**, with a fallback order for each job:

| Job | First choice | Fallbacks, in order |
|---|---|---|
| Deciding whether to speak (the watcher) | `gemini-decision-1` | `gemini-3.5-flash-lite` with structured output |
| Investigating a new or large situation | `gemini-4-carbon` | `gemini-4-argon`, then `gemini-4-hydrogen` |
| Investigating a routine kind | `gemini-4-hydrogen` | `gemini-3.8-flash` |
| Writing the Day one description | `gemini-4-hydrogen` | `gemini-3.8-flash` |

  If a model is not available to this key, move to the next and show in the trace which model answered.
- **How to call Gemini, from Google's documentation as of 14 November 2026.** Some of this is newer than you may expect, so follow it exactly:
  - Use `@google/genai` version 3.3.0 or later (it needs Node 22 or later). Check `package.json` and upgrade if the installed version is older.
  - Create one client, passing the key explicitly from `process.env.GEMINI_API_KEY` and setting the API version to `v1beta`. Google's samples write this as `apiVersion: "v1beta"` in some places and `httpOptions: { apiVersion: "v1beta" }` in others; since version 3.0 the default is `v1`, which does not have everything this app needs.
  - Use the **Interactions API** (`client.interactions.create`) for all text, tool and speech calls. `generateContent` is now called legacy. In Interactions, the response holds `steps` (not `outputs`) and the final text is `output_text`.
  - Thinking: set `generation_config: { thinking_level: "low" }` on every call in this app, and keep the level per job in the settings file. Gemini 4 models cannot have thinking switched off, `minimal` is an error on them, and `gemini-4-hydrogen` defaults to `high`, which is slow. Do not send `thinkingBudget`.
  - Do not send `temperature`, `top_p` or `top_k` to Gemini 4 models, and do not set a low limit on output tokens.
  - Structured output in Interactions: `response_format: { type: "text", mime_type: "application/json", schema: ... }`, then parse `output_text`. Keep schemas small and flat; large or deeply nested schemas are rejected with a 400. `minLength`, `maxLength` and `uniqueItems` are ignored, so check those in code.
- **A connection test page (developer only). Build this first, before the rest of this stage.** One button that makes one tiny real call for each job in the settings file (a one-question decision request, a one-tool function call, a small structured-output call) and prints, for each: the model that answered, the time in milliseconds, and the full error text if it failed. Run it yourself before building the rest. If every call answers from its first-choice model, carry on with the stage. If a call fails, fix the way it is called here, not later inside the watcher or the checker; if you cannot make `gemini-decision-1` or `gemini-4-carbon` answer after two attempts, stop and show me the full error text.
- **Cache** every response in the server's memory, keyed by a hash of the model and the full request. Do not rely on files written at run time: the published app loses them on every restart. The simulation is deterministic, so a repeat run sends identical requests and costs nothing. Mark cached steps "replayed" in the trace.
- **Daily cap** on uncached calls: one setting, default 2,000 for the decision model and 300 for the others. Past the cap, use fallbacks and show a banner.
- **Timeouts and fallbacks:** 5 seconds for a decision call; 45 seconds for an investigation on the first-choice model, then one try of 25 seconds on the next model in the list. On failure, continue with the code-only behaviour from stage 1 or a code-written sentence, and mark the step "fallback, Gemini not used" in the trace. The run must never stall.
- Record for every call: model, feature used, time taken in milliseconds, input and output tokens, live or replayed. Keep a running count and estimated cost.

## 2. The watcher: Gemini Decision decides whether to speak

Google released the **Gemini Decisions API** on 11 November 2026. It is new, so here is its contract from Google's documentation (https://aistudio.google.com/docs/decisions-api). The model answers questions with probabilities and writes no text.

- SDK: add `@google/genai` at version 3.3.0 or later to the server's dependencies (3.2.0 is the first version that has `decisions`; an older installed version will not have it). Create the client as `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: "v1beta" })`. The `apiVersion` setting matters: without it the SDK calls a different path. Then call `ai.decisions.create({ model, input, questions })` and read `result.answers[key]`.
- If `ai.decisions` does not exist after installing, do not guess another method. Call the REST endpoint directly from the server: `POST https://generativelanguage.googleapis.com/v1beta/decisions` with headers `x-goog-api-key` and `Content-Type: application/json` and the same JSON body.
- Body: `model` is exactly `"gemini-decision-1"` (no other spelling works); `input` is one string (build the whole briefing as a single string with your own line breaks); `questions` is a map from your own key (letters, digits, underscore, hyphen; up to 64 characters) to a question.
- A question has `type` and `instructions` (the full question in words; the model never sees the keys), and `criteria`, which is required for `choice` and `score` and optional for `noul`:
  - `"noul"` is a yes or no question. Optional criteria: `{ "true_description": "...", "false_description": "..." }`. Answer: `{ "type": "noul", "noul": 0.94, "confidence": 0.94 }`, where `noul` is the probability of yes, held between 0.01 and 0.99.
  - `"choice"` picks one option. Criteria: an object from option key to a short description. Answer: `{ "type": "choice", "choice": "<key>", "probabilities": { "<key>": 0.76, ... }, "confidence": 0.76 }`. It always spreads probability over the options given, even if none fits.
  - `"score"` rates on ordered levels. Criteria: an array of level descriptions, lowest first, indexed from 0. Answer: `{ "type": "score", "score": 1.12, "legend": { "0": "...", ... }, "probabilities": { "0": 0.03, "1": 0.83, "2": 0.15 }, "confidence": 0.83 }`. `score` is a weighted average; for the level to show, take the key with the highest probability.
- Response: `{ "answers": { "<your key>": { ... } }, "usage": { "total_input_tokens": n, "total_output_tokens": 0, "total_tokens": n } }`. There is no latency field: measure the time yourself around the call.
- Errors: a blocked or invalid request returns HTTP 400 with `{ "error": { "code": "...", "message": "..." } }` and no `answers`. Treat 404 (model not found), 403, 401 and 429 (rate limit or quota) as "not available": use the fallback model and show the error message once in the trace.
- It supports no function calling, no structured output, no thinking and no conversation history. Questions cannot see each other. Up to 1,000 questions per request.
- Google's guidance: write the whole question in the instructions; phrase it positively; give each option and level a short, clearly distinct description; send only what the questions need; compare numbers, dates and durations in code and give the model the result in words.

**How to use it here.** On each simulated day that has a new candidate, or a candidate whose facts changed materially, make one decision request.

The `input` is a short briefing in plain words, built by code from facts:
- Two lines on the business and what counts as a like-for-like store.
- The parts of the trading calendar that touch this week.
- What is already open, in progress, held out as a control, or closed.
- For each candidate, one paragraph: what was expected and why, what happened, the size of the gap next to the normal week-to-week noise, the money at stake per week, how long it has been visible, and each silence check's result in words. All comparisons are already done by code and stated in words ("the gap is five times the normal noise").

The `questions`, four per candidate, each naming its candidate in full in the instructions:
1. `choice`: "What should a careful operations manager do about this today?" Options: `raise_now` (the facts break what was expected by enough to matter, nothing in the briefing explains it, and something can still be done); `keep_watching` (something looks off but it is small, early or partly explained); `stay_quiet` (the briefing explains it, or it is too small to matter).
2. `noul`: "According to the briefing, is this change fully explained by the calendar, a new store's opening ramp, an unfinished period, or an action already under way?"
3. `noul`: "Can the business still do something useful about this within the next two weeks?"
4. `score`: "How soon does this need a decision?" Levels: can wait a month; this month; this week; today. Use this answer only to show urgency on the card. It must not affect whether a candidate is raised.

A candidate here means a situation after the code linking from stage 1: linked candidates are not asked about separately; they are written into their situation's paragraph as supporting evidence.

Plus, for each pair of situations that are open at the same time and were not linked by code (at most 10 pairs in one request, largest money first): `noul`: "Do these two describe the same underlying problem?" Pairs above 0.7 are merged into one situation.

**Turning answers into behaviour (code):**
- **Raise** when the choice is `raise_now` with confidence 0.6 or more, "fully explained" is below 0.5, and the code's "already handled" check says no.
- If the model says raise but a code silence check says explained, do not raise: keep watching, and log "instinct and calendar check disagree". Two differently built checks must agree before the owner is interrupted.
- Otherwise `keep_watching` candidates are asked again on later days as their facts change, and `stay_quiet` ones go to Noticed and let go with the reason in plain words.
- Keep these thresholds in the settings file.

Show the instinct at work:
- In the trace under Manager, for each decision request: the number of questions, the time taken in milliseconds, and per candidate the choice with its confidence and the "explained" probability.
- On each Noticed and let go line, a small confidence figure.
- On a raised card, one line: "Raised by instinct, confidence 0.93, decided in 180 ms" (values from the call).

Save each day's choices and timings against the hidden ground-truth tags from stage 1, for the score in stage 6.

## 3. The Day one description

Replace the code-written description with one written by Gemini from computed facts. It must use placeholders for figures, which code fills from fact ids.

## 4. The checker: Gemini investigates

When a situation is raised, start an investigation at once, with nobody asking. The clock slows to a stop while the first investigation of a situation runs, and the left column shows "Noticed: (one line). Checking now." with the steps appearing as they happen.

Use function calling through the Interactions API, with the loop written by hand (automatic function calling exists only in the Python SDK):
- Declare each tool as `{ type: "function", name, description, parameters }` with a simple JSON schema.
- After each call, read the steps of type `function_call` (each has `id`, `name`, `arguments`), run the matching code, and send back one `function_result` per call (with `name`, `call_id` and the result as text) in a new `interactions.create` that passes `previous_interaction_id` and repeats `model` and `tools`. Leave `store` at its default so the server keeps the model's reasoning between turns.
- Stop when a response has no function calls, or after 10 rounds.

The model may call only these code tools, each returning facts with ids:
- Recompute a named figure from the rows.
- Compare a store, group or the chain with the same weekdays last year.
- Compare a store with the other established stores.
- Test the calendar for a period.
- Test store mix: how much of a change in the total comes from new stores.
- Test for a data fault: missing days, duplicated days, a store with no sales on a trading day.
- Stock cover by store and group, with the next delivery date.
- Lost sales so far, and per week if nothing is done, for a store and group.

Instructions to the model, in substance: you are the data scientist for this business. Find out what is true and why. Test the rival explanations (calendar, store mix, data fault) before naming a cause. Never calculate and never type a number; refer to facts by id. Always include "do nothing" among the options.

It returns a structured result:
- Confirmed: yes, no or unclear.
- Causes in order, each with fact ids.
- What was ruled out, each with the fact id that rules it out.
- Options, always including do nothing, each with fact ids for its effect.
- Exactly one outcome from five: nothing to do and why; a recommendation; a decision for a person; a tool to build; something to start recording.
- Wording for the card: a one-sentence finding, a one-sentence cause, a one-sentence proposal, each with placeholders where figures go.

Do this in two steps, because combining tools and a response schema in one request is still a preview feature: first run the function-calling loop to its end with no response schema; then make one more call that passes the same `previous_interaction_id`, no tools, and the response schema, asking for the result. If that last call fails, make it again as a fresh call with the gathered facts written into the input.

Code then checks the result before anything is shown: every placeholder must resolve to a fact; if the wording contains a typed digit, ask once more, then fall back to code-written wording. A check that ends "nothing to do" goes to Noticed and let go with its reason.

## 5. The card (display only in this stage)

A confirmed check becomes a card under Needs you, ranked by money at stake per week:
- The finding, in one sentence.
- Expected and actual, side by side.
- Ruled out: calendar, store mix, data fault, each with a tick and its fact.
- The cause.
- The options, including do nothing, each with its weekly effect.
- The outcome.
- "Raised by instinct" line from section 2.

Buttons come in stage 3. For now a card can only be opened and read. Tapping any figure shows how it was computed.

In the trace under Data scientist: each tool the model called, in order, with the facts returned, the model used, the time taken, live or replayed.

## Check before you say this stage is done

0. The connection test page shows a real answer from `gemini-decision-1`, from the investigation model with a function call, and from a structured-output call. If any used a fallback model, say which and show the error.
1. Play the live window. The trace shows a decision request on each day with a new candidate, each answered in well under a second.
2. Let go with reasons: the summer lull, the Labor Day dip and jump, the lull ending, Napa's fading spike. If Gemini Decision raises any of these, do not hide it: show me the briefing paragraph and the answers so I can improve the wording.
3. Raised: Best-sellers running out (4 to 8 September), knitwear at Walnut Creek (near 24 September), refunds at Walnut Creek (near 2 October). The like-for-like break (near 5 October) stays inside the Best-sellers situation, not a new card.
4. The Best-sellers card names the cause (stock, with the idle stock in three stores), shows calendar, store mix and data fault ruled out, and every figure opens its note.
5. The Best-sellers situation lists the like-for-like break as supporting evidence and states that total sales are still above last year because of the two new stores.
6. A second run of the same window makes zero live calls and marks every step "replayed".
7. With the key removed, the run completes on the stage 1 code behaviour, with fallbacks marked.
