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
}

export type TraceLane = 'manager' | 'data_scientist' | 'developer';

export interface TraceEntry {
  id: string;
  date: string;
  lane: TraceLane;
  kind: 'detector' | 'silence_check' | 'decision' | 'note' | 'tool_call' | 'investigation';
  headline: string;
  detail: string;
  outcome: 'let_go' | 'raised' | 'info';
  facts?: Fact[];
  meta?: {
    model?: string;
    mode?: 'live' | 'replayed' | 'fallback';
    latencyMs?: number;
    confidence?: number;
    questionCount?: number;
    briefingSnippet?: string;
  };
}

export interface ActionDecision {
  id: string;
  date: string;
  candidateId: string;
  kind: 'transfer' | 'control_holdout' | 'refund_audit' | 'other';
  storeId?: StoreId;
  groupId?: ProductGroupId;
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
  noticedAndLetGo: NoticedAndLetGoItem[];
  groupedLetGo: GroupedLetGoItem[];
  trace: TraceEntry[];
  todayCandidates: Candidate[];
  watcherEvalLog?: WatcherEvalRecord[];
  pendingInvestigationId?: string;
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
