export type StoreId =
  | 'union_square'
  | 'palo_alto'
  | 'santana_row'
  | 'walnut_creek'
  | 'pasadena'
  | 'sacramento'
  | 'santa_barbara'
  | 'rockridge'
  | 'burlingame'
  | 'napa';

export type ProductGroupId = 'best_sellers' | 'knitwear' | 'everything_else';

export interface StoreConfig {
  id: StoreId;
  name: string;
  baseDailySales: number;
  isEstablished: boolean;
  openedDate: string; // YYYY-MM-DD
  hasOpeningRamp: boolean;
}

export interface ProductGroupConfig {
  id: ProductGroupId;
  name: string;
  share: number;
  avgPrice: number | null;
  stockLimited: boolean;
}

export interface Fact {
  id: string;
  label: string;
  value: number;
  formatted: string;
  unit: 'USD' | 'units' | 'weeks' | 'percent' | 'share_percent' | 'days' | 'count' | 'points';
  note: string;
}

export interface RefundRecord {
  id: string;
  storeId: StoreId;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  till: number;
  operatorNumber: number;
  amount: number;
  method: 'cash' | 'card';
  linkedOrder: boolean;
}

export interface GroupDailyState {
  groupId: ProductGroupId;
  potentialSales: number;
  unitsDemanded: number;
  unitsSold: number;
  actualSales: number;
  startingStock: number;
  endingStock: number;
  hadStock: boolean;
  weeksOfCover: number | null;
}

export interface DailyStoreRecord {
  date: string;
  storeId: StoreId;
  isOpen: boolean;
  potentialSales: number;
  actualSales: number;
  expectedSales: number | null;
  refundAmount: number;
  cashRefundAmount: number;
  refundRate: number;
  groups: Record<ProductGroupId, GroupDailyState>;
}

export interface DailyChainRecord {
  date: string;
  establishedActualSales: number;
  establishedExpectedSales: number;
  establishedTrailing7Actual: number;
  establishedTrailing7Expected: number;
  allStoresActualSales: number;
  allStoresTrailing28Sales: number;
  lastYearAllStoresTrailing28Sales: number;
  allStores28dVsLastYearPct: number;
  lflTrailing28Pct: number;
  calendarLabels: string[];
}

export type DetectorKind =
  | 'drop_or_jump'
  | 'day_out_of_line'
  | 'lfl_break'
  | 'store_out_of_line'
  | 'stock_running_out'
  | 'refunds_out_of_line';

export type SilenceCheckKind =
  | 'calendar'
  | 'opening_ramp'
  | 'partial_period'
  | 'already_handled'
  | 'stock_returned';

export interface SilenceCheckResult {
  check: SilenceCheckKind;
  triggered: boolean;
  reason: string;
}

export interface ScheduledDelivery {
  date: string;
  storeId: StoreId | 'all';
  groupId: 'best_sellers' | 'knitwear';
  kind: 'regular' | 'resumption';
}

export interface DeliveredStockEvent {
  date: string;
  storeId: StoreId;
  groupId: 'best_sellers' | 'knitwear';
  unitsAdded: number;
  stockBefore: number;
  stockAfter: number;
  returnedFromZero: boolean;
}

export type GroundTruthTag =
  | 'real:best_sellers_shortage'
  | 'real:walnut_creek_refunds'
  | 'real:walnut_creek_knitwear'
  | 'real:pasadena_knitwear'
  | 'real:napa_knitwear'
  | 'near_miss:summer_lull_start'
  | 'near_miss:labor_day_dip'
  | 'near_miss:labor_day_jump'
  | 'near_miss:summer_lull_end'
  | 'near_miss:napa_ramp_fade'
  | 'near_miss:control_store_fall';

export interface Candidate {
  id: string; // stable while episode is open
  kind: DetectorKind;
  thing: string; // e.g. 'chain', 'walnut_creek:knitwear', 'union_square:best_sellers'
  storeId?: StoreId;
  groupId?: ProductGroupId;
  period: string;
  detectedOn: string;
  title: string;
  summary: string;
  expected: Fact;
  actual: Fact;
  stakePerWeek: Fact;
  silenceChecks: SilenceCheckResult[];
  explainedBy: SilenceCheckResult | null;
  groundTruth?: GroundTruthTag;
}

export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'fact'; fact: Fact };

export interface NoticedAndLetGoItem {
  candidateId: string;
  date: string;
  reason: string;
  groupSummaryKey: string;
  groupHeadline: string;
  weekKey: string;
  storeId?: StoreId;
  storeName?: string;
  checkKind: SilenceCheckKind | 'instinct' | 'checker';
  detectorKind: DetectorKind;
  expected: Fact;
  actual: Fact;
  groundTruth?: GroundTruthTag;
  confidence?: number;
  decisionSource?: 'instinct' | 'code_fallback' | 'checker';
  model?: string;
  mode?: 'live' | 'replayed' | 'fallback';
}

export interface GroupedLetGoItem {
  id: string;
  date: string;
  weekKey: string;
  checkKind: SilenceCheckKind | 'instinct' | 'checker';
  headline: string;
  items: NoticedAndLetGoItem[];
  confidence?: number;
}

export interface SupportingEvidence {
  candidateId: string;
  kind: DetectorKind;
  title: string;
  storeId?: StoreId;
  firstDetectedOn: string;
  lastSeenOn: string;
  expected: Fact;
  actual: Fact;
  stakePerWeek: Fact;
  todayExpected?: Fact;
  todayActual?: Fact;
  todayStakePerWeek?: Fact;
}

export interface RaisedStoreSnapshot {
  storeId: StoreId;
  storeName: string;
  firstDetectedOn: string;
  initialExpected: Fact;
  initialActual: Fact;
  initialStakePerWeek: Fact;
  todayExpected?: Fact;
  todayActual?: Fact;
  todayStakePerWeek?: Fact;
}

export interface InvestigationRuledOut {
  kind: 'calendar' | 'store_mix' | 'data_fault';
  label: string;
  ruledOut: boolean;
  summary: string;
  summarySegments?: TextSegment[];
  fact?: Fact;
}

export interface InvestigationOption {
  id: string;
  label: string;
  isDoNothing: boolean;
  description: string;
  weeklyEffectFact?: Fact;
}

export type InvestigationOutcomeKind =
  | 'nothing_to_do'
  | 'recommendation'
  | 'person_decision'
  | 'tool_to_build'
  | 'start_recording';

export interface InvestigationToolTrace {
  round: number;
  toolName: string;
  argsSummary: string;
  factIds: string[];
  facts: Fact[];
}

export interface SecondCheckResult {
  status: 'matched' | 'disagreed' | 'unavailable';
  label: string;
  firstValueFact: Fact;
  secondValueFact?: Fact;
  diffPct?: number;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  pythonCode?: string;
  error?: string;
}

export interface TransferLine {
  fromStoreId: StoreId;
  fromStoreName: string;
  toStoreId: StoreId;
  toStoreName: string;
  groupId: 'best_sellers' | 'knitwear';
  units: number;
}

export interface TransferPlan {
  groupId: 'best_sellers' | 'knitwear';
  groupName: string;
  receiverStoreIds: StoreId[];
  treatedStoreIds: StoreId[];
  holdoutStoreId?: StoreId;
  holdoutStoreName?: string;
  holdoutSentence?: string;
  limitSentence: string;
  nextDeliveryDate: string | null;
  transferLines: TransferLine[];
  totalUnitsFact: Fact;
  shortfallUnitsFact?: Fact;
  arrivalDate: string;
  weeklyRecoveryFact: Fact;
  measure: string;
  proofEndDate: string;
  requiresOwnerApproval: boolean;
}

export interface InvestigationResult {
  candidateId: string;
  status: 'pending' | 'running' | 'confirmed' | 'let_go';
  confirmed: 'yes' | 'no' | 'unclear';
  findingSegments: TextSegment[];
  causeSegments: TextSegment[];
  proposalSegments: TextSegment[];
  causes: Array<{ summary: string; factIds: string[]; facts: Fact[] }>;
  ruledOut: InvestigationRuledOut[];
  options: InvestigationOption[];
  outcomeKind: InvestigationOutcomeKind;
  outcomeDetail: string;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  usedFallbackWording: boolean;
  toolTrace: InvestigationToolTrace[];
  factsById: Record<string, Fact>;
  secondCheck?: SecondCheckResult;
  transferPlan?: TransferPlan;
  jobKey?: 'investigate_large' | 'investigate_routine';
}

export interface InstinctMeta {
  confidence: number;
  latencyMs: number;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  urgencyLevel: string;
  urgencyIndex: number;
  explainedProb: number;
  actionableProb: number;
}

export interface RaisedItem {
  candidateId: string;
  firstDetectedOn: string;
  lastSeenOn: string;
  title: string;
  summary: string;
  detectorKind: DetectorKind;
  groupId?: ProductGroupId;
  stores?: RaisedStoreSnapshot[];
  expected: Fact;
  actual: Fact;
  stakePerWeek: Fact;
  todayDate?: string;
  todayExpected?: Fact;
  todayActual?: Fact;
  todayStakePerWeek?: Fact;
  evidence?: SupportingEvidence[];
  groundTruth?: GroundTruthTag;
  instinctMeta?: InstinctMeta;
  investigation?: InvestigationResult;
  secondCheck?: SecondCheckResult;
  transferPlan?: TransferPlan;
  deferredOn?: string;
  reRaisedOn?: string;
  reRaiseReason?: string;
  costOfDelayFact?: Fact;
  isRollout?: boolean;
  parentDecisionId?: string;
  visualMetrics?: CardVisualMetrics;
}

export type ProofTag = 'proven' | 'likely' | 'mixed' | 'none';

export interface MoneyStoreProblemRow {
  storeId: StoreId;
  storeName: string;
  problemId: string;
  problemTitle: string;
  withoutOpscienFact: Fact;
  lostSoFarFact: Fact;
  savedFact: Fact;
  proofStatus: ProofTag;
  proofNote: string;
  lossReason: string;
}

export interface MoneyProblemBreakdown {
  problemId: string;
  title: string;
  storeNames: string;
  statusLabel: string;
  decisionLabel: string;
  withoutOpscienFact: Fact;
  lostSoFarFact: Fact;
  savedFact: Fact;
  savedProvenUsd: number;
  savedLikelyUsd: number;
  proofStatus: ProofTag;
  proofNote: string;
  lossReason: string;
  stores: MoneyStoreProblemRow[];
}

export interface MoneyStoreBreakdown {
  storeId: StoreId;
  storeName: string;
  withoutOpscienFact: Fact;
  lostSoFarFact: Fact;
  savedFact: Fact;
  proofStatus: ProofTag;
  lossReason: string;
}

export interface TurnedDownWarningItem {
  candidateId: string;
  title: string;
  reaction: 'not_now' | 'dismiss';
  reactionDate: string;
  dismissReasonLabel?: string;
  isReRaised: boolean;
  weeklyStakeFact: Fact;
  lostSinceTurnedDownFact: Fact;
  byStore: Array<{
    storeId: StoreId;
    storeName: string;
    lostFact: Fact;
  }>;
}

export interface WorkCountersData {
  signalsCheckedFact: Fact;
  stayedQuietFact: Fact;
  askedOwnerFact: Fact;
  actedAloneFact: Fact;
  unitsMovedFact: Fact;
  toolsBuiltFact: Fact;
}

export interface DayByDayChartPoint {
  date: string;
  sales7dWithOpscien: number;
  sales7dWithoutOpscien: number;
  withoutOpscienUsd: number;
  lostSoFarUsd: number;
  savedSoFarUsd: number;
}

export type DayByDayEventKind = 'quiet' | 'raised' | 'acted';

export interface DayByDayChartEvent {
  date: string;
  kind: DayByDayEventKind;
  title: string;
  summary: string;
  facts: Fact[];
}

export interface MoneyAccountData {
  asOfDate: string;
  withoutOpscienFact: Fact;
  lostSoFarFact: Fact;
  savedSoFarFact: Fact;
  savedProvenFact: Fact;
  savedLikelyFact: Fact;
  atRiskNowFact: Fact;
  byProblem: MoneyProblemBreakdown[];
  byStore: MoneyStoreBreakdown[];
  turnedDownWarnings: TurnedDownWarningItem[];
  workCounters: WorkCountersData;
  dayByDayPoints?: DayByDayChartPoint[];
  dayByDayEvents?: DayByDayChartEvent[];
}

export interface CardVisualMetrics {
  daysOfStockLeftFact?: Fact;
  daysUntilDeliveryFact?: Fact;
  emptyShelfDaysFact?: Fact;
  doNothingLossFact?: Fact;
  currentCoverFact?: Fact;
  alarmCoverFact?: Fact;
  spareStoreCountFact?: Fact;
  spareTotalUnitsFact?: Fact;
  walnutCreekRefundRateFact?: Fact;
  peerRefundRateFact?: Fact;
  proofBarData?: {
    treatedNames: string;
    holdoutName: string;
    treatedActualSalesFact: Fact;
    treatedExpectedSalesFact: Fact;
    holdoutActualSalesFact: Fact;
    holdoutExpectedSalesFact: Fact;
    treatedPctFact: Fact;
    holdoutPctFact: Fact;
    provenGainFact?: Fact;
  };
  refundStoreComparison?: Array<{
    storeId: StoreId;
    storeName: string;
    refundRateFact: Fact;
    isFlagged: boolean;
  }>;
}

export type StoreBoardStatus =
  | 'not_open'
  | 'losing_sales'
  | 'held_back'
  | 'stock_on_the_way'
  | 'at_risk'
  | 'fine';

export interface StoreBoardEntry {
  storeId: StoreId;
  storeName: string;
  baseDailySales: number;
  isOpen: boolean;
  openedDate: string;
  status: StoreBoardStatus;
  statusLabel: string;
  bestSellersCoverFact: Fact | null;
  knitwearCoverFact: Fact | null;
  sales7dActualFact: Fact;
  sales7dExpectedFact: Fact;
  sales28dActualFact: Fact;
  sales28dExpectedFact: Fact;
  salesVsExpectedPctFact: Fact;
  savedSoFarFact: Fact;
  lostSoFarFact: Fact;
  chartPoints: Array<{
    date: string;
    actual7d: number;
    expected7d: number;
  }>;
  events: Array<{
    date: string;
    summary: string;
  }>;
}

export type TraceLane = 'manager' | 'data_scientist' | 'developer';

export interface DecisionTraceRow {
  candidateId: string;
  title: string;
  choice: 'raise_now' | 'keep_watching' | 'stay_quiet';
  confidence: number;
  explainedProb: number;
  urgencyLevel?: string;
}

export interface TraceEntry {
  id: string;
  date: string;
  lane: TraceLane;
  kind:
    | 'detector'
    | 'silence_check'
    | 'decision'
    | 'note'
    | 'tool_call'
    | 'investigation'
    | 'gateway'
    | 'followup'
    | 'builder';
  headline: string;
  detail: string;
  outcome: 'let_go' | 'raised' | 'info';
  facts?: Fact[];
  decisionRows?: DecisionTraceRow[];
  meta?: {
    model?: string;
    mode?: 'live' | 'replayed' | 'fallback';
    latencyMs?: number;
    confidence?: number;
    questionCount?: number;
    briefingSnippet?: string;
  };
}

export type DismissReason = 'not_important' | 'already_known' | 'wrong' | 'not_mine';

export interface CardReaction {
  id: string;
  candidateId: string;
  date: string;
  dayIndex: number;
  reaction: 'approve' | 'not_now' | 'dismiss';
  reason?: DismissReason;
  detail?: string;
  storeIds?: StoreId[];
}

export interface ActionDecision {
  id: string;
  date: string;
  candidateId: string;
  kind:
    | 'transfer'
    | 'control_holdout'
    | 'refund_audit'
    | 'refund_switch'
    | 'store_manager_task'
    | 'other';
  storeId?: StoreId;
  groupId?: ProductGroupId;
  arrivalDate?: string;
  dueDate?: string;
  toolId?: string;
  transferLines?: TransferLine[];
  holdoutStoreId?: StoreId;
  holdoutStoreName?: string;
  totalUnits?: number;
  approvedBy?: string;
  approvedAtDate?: string;
  measure?: string;
  proofEndDate?: string;
  undoneOnDate?: string;
  unitsReturned?: number;
  parentDecisionId?: string;
  title?: string;
  isAutonomous?: boolean;
  whySummary?: string;
  expectedWorthUsd?: number;
}

export interface InProgressAction {
  decisionId: string;
  candidateId: string;
  title: string;
  measure: string;
  statusText: string;
  nextCheckpoint: string;
  endDate: string;
  arrivalDate: string;
  holdoutStoreName?: string;
  latestGapPtsFact?: Fact;
  beforeRefundRateFact?: Fact;
  afterRefundRateFact?: Fact;
  isSimulatedTask?: boolean;
  transferPlan?: TransferPlan;
}

export interface DoneForYouItem {
  decisionId: string;
  candidateId: string;
  title: string;
  verdict:
    | 'worked_proven'
    | 'worked_single_store'
    | 'worked_before_after'
    | 'autonomous_pending'
    | 'undone'
    | 'unclear'
    | 'did_not_work';
  verdictSentence: string;
  detailSentence?: string;
  approvedOn: string;
  closedOn: string;
  provenMoneyFact?: Fact;
  expectedWorthFact?: Fact;
  movedUnitsFact?: Fact;
  unitsReturnedFact?: Fact;
  movedSummary?: string;
  whySummary?: string;
  beforeRefundRateFact?: Fact;
  afterRefundRateFact?: Fact;
  undone?: boolean;
  isAutonomous?: boolean;
  canUndo?: boolean;
  holdoutStoreName?: string;
}

export type AutonomyLevel = 'recommend_decide' | 'autonomous_within_limits';

export interface AutonomyOfferCard {
  id: string;
  offeredOn: string;
  kindLabel: string;
  headline: string;
  body: string;
  status: 'pending' | 'accepted' | 'declined';
  decidedOn?: string;
}

export interface AutonomyReaction {
  id: string;
  offerId: string;
  date: string;
  dayIndex: number;
  reaction: 'enable_autonomy' | 'keep_asking';
}

export interface AutonomyRecord {
  kindLabel: string;
  casesFact: Fact;
  workedFact: Fact;
  provenFact: Fact;
  pooledMoneyFact: Fact;
  level: AutonomyLevel;
  levelLabel: string;
  earnRuleText: string;
  earnRuleMet: boolean;
  consecutiveStreakWorked: number;
  consecutiveUndos: number;
  lostAutonomyReason?: string;
  offerCard?: AutonomyOfferCard;
}

export interface EndStatementData {
  generatedOn: string;
  money: {
    provenAvoidedFact: Fact;
    delayCostFact: Fact;
    refundLeakageStoppedFact: Fact;
    routineTransfersCountFact: Fact;
    autonomousTransfersCountFact: Fact;
    storeTasksCountFact: Fact;
  };
  noticing: {
    realRaisedFact: Fact;
    realTotalFact: Fact;
    medianDaysEarlyFact: Fact;
    lookAlikesRaisedFact: Fact;
    lookAlikesTotalFact: Fact;
    medianDecisionMsFact: Fact;
    realDetails: Array<{ label: string; targetDate: string; raisedDate: string | null; daysEarly: number | null }>;
  };
  wrongOrUnproven: {
    didNotWorkCountFact: Fact;
    undoneCountFact: Fact;
    unprovenOnlyCountFact: Fact;
    disagreementsCountFact: Fact;
    fallbacksCountFact: Fact;
    notes: string[];
  };
  cost: {
    totalCallsFact: Fact;
    decisionCallsFact: Fact;
    otherCallsFact: Fact;
    estimatedCostUsdFact: Fact;
    liveModeCostNote: string;
  };
  built: {
    toolsBuiltFact: Fact;
    tools: Array<{
      title: string;
      installedOn: string;
      testsPassedFact: Fact;
      testsTotalFact: Fact;
      usedFallbackCopy: boolean;
    }>;
  };
}

export interface BuilderRequirement {
  situationId: string;
  title: string;
  generatedOn: string;
  purpose: TextSegment[];
  users: TextSegment[];
  shows: TextSegment[];
  actions: TextSegment[];
  verification: TextSegment[];
  plainSummary: {
    purpose: string;
    users: string;
    shows: string;
    actions: string;
    verification: string;
  };
  factsById: Record<string, Fact>;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  usedFallbackWording: boolean;
}

export interface ToolTestCaseResult {
  id: 'loads_cleanly' | 'flagged_math_matches' | 'mark_reviewed_responds';
  label: string;
  passed: boolean;
  detail: string;
}

export interface BuiltToolRecord {
  id: string;
  situationId: string;
  title: string;
  storeId: StoreId;
  storeName: string;
  installedOn: string;
  html: string;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  byteSize: number;
  usedFallbackCopy: boolean;
  repairedOnce: boolean;
  repairReason?: string;
  requirement: BuilderRequirement;
  testResults: ToolTestCaseResult[];
}

export interface DayOneBrief {
  businessName: string;
  summaryFacts: {
    storeCount: Fact;
    establishedCount: Fact;
    newStoreCount: Fact;
    strongestWeekdayShare: Fact;
    decemberIndex: Fact;
    lullIndex: Fact;
    bestSellersShare: Fact;
    knitwearShare: Fact;
  };
  confirmedRules: {
    id: string;
    title: string;
    detail: string;
  }[];
  narrativeSegments?: TextSegment[][];
  narrativeMeta?: {
    model: string;
    mode: 'live' | 'replayed' | 'fallback';
    latencyMs: number;
  };
}

export interface WatcherEvalRecord {
  date: string;
  situationId: string;
  groundTruth?: GroundTruthTag;
  decisionChoice: 'raise_now' | 'keep_watching' | 'stay_quiet';
  confidence: number;
  explainedProb: number;
  actionableProb: number;
  urgencyIndex: number;
  latencyMs: number;
  model: string;
  mode: 'live' | 'replayed' | 'fallback';
  outcome: 'raised' | 'keep_watching' | 'let_go' | 'disagree_keep_watching';
}

export interface DayState {
  date: string;
  dayIndex: number; // 0 = 2026-08-01
  totalDays: number; // 106 (2026-08-01 to 2026-11-14)
  chartPoints: {
    date: string;
    actual7d: number;
    expected7d: number;
    bandLow: number;
    bandHigh: number;
    outOfBand: boolean;
    calendarLabels: string[];
  }[];
  headlineFacts: {
    total28dSales: Fact;
    lastYear28dSales: Fact;
    total28dChangePct: Fact;
    lfl28dVsExpectedPct: Fact;
  };
  raised: RaisedItem[];
  inProgress?: InProgressAction[];
  doneForYou?: DoneForYouItem[];
  noticedAndLetGo: NoticedAndLetGoItem[];
  groupedLetGo: GroupedLetGoItem[];
  trace: TraceEntry[];
  todayCandidates: Candidate[];
  watcherEvalLog?: WatcherEvalRecord[];
  pendingInvestigationId?: string;
  reactions?: CardReaction[];
  builtTools?: BuiltToolRecord[];
  refundSwitchEnabled?: boolean;
  reviewedRefundIds?: string[];
  refundRows?: RefundRecord[];
  toolUnreviewedFact?: Fact;
  autonomyRecord?: AutonomyRecord;
  lostAutonomyReason?: string;
  endStatement?: EndStatementData;
  geminiMode?: 'replay' | 'live';
  geminiCapBanner?: string;
  moneyAccount?: MoneyAccountData;
  storeBoard?: StoreBoardEntry[];
  doneForYouProofBars?: Record<string, CardVisualMetrics['proofBarData']>;
}

export interface DiagnosticTargetResult {
  key: string;
  label: string;
  targetWindow: string;
  targetStart: string;
  targetEnd: string;
  actualDate: string | null;
  withinFiveDays: boolean;
  detail: string;
}

export interface DiagnosticReport {
  seed: number;
  targets: DiagnosticTargetResult[];
  midOctoberCheck: {
    date: string;
    lflPointsBelowExpectation: number;
    total28dVsLastYearPct: number;
    passed: boolean;
  };
  allPassed: boolean;
}
