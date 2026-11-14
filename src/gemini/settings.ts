export type GeminiJobKey =
  | 'watcher'
  | 'investigate_large'
  | 'investigate_routine'
  | 'day_one_description';

export type ThinkingLevelSetting = 'low' | 'medium' | 'high';

export interface GeminiJobConfig {
  key: GeminiJobKey;
  label: string;
  api: 'decisions' | 'interactions';
  models: string[]; // First choice followed by fallbacks in order
  thinkingLevel: ThinkingLevelSetting;
  firstTimeoutMs: number;
  fallbackTimeoutMs: number;
  capBucket: 'decision' | 'other';
}

export interface ModelPricingPerMillionUsd {
  input: number;
  output: number;
}

export const GEMINI_SETTINGS = {
  apiVersion: 'v1beta' as const,

  jobs: {
    watcher: {
      key: 'watcher',
      label: 'Deciding whether to speak (the watcher)',
      api: 'decisions',
      models: ['gemini-decision-1', 'gemini-3.5-flash-lite'],
      thinkingLevel: 'low',
      firstTimeoutMs: 5000,
      fallbackTimeoutMs: 5000,
      capBucket: 'decision',
    },
    investigate_large: {
      key: 'investigate_large',
      label: 'Investigating a new or large situation',
      api: 'interactions',
      models: ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen'],
      thinkingLevel: 'low',
      firstTimeoutMs: 45000,
      fallbackTimeoutMs: 25000,
      capBucket: 'other',
    },
    investigate_routine: {
      key: 'investigate_routine',
      label: 'Investigating a routine kind',
      api: 'interactions',
      models: ['gemini-4-hydrogen', 'gemini-3.8-flash'],
      thinkingLevel: 'low',
      firstTimeoutMs: 45000,
      fallbackTimeoutMs: 25000,
      capBucket: 'other',
    },
    day_one_description: {
      key: 'day_one_description',
      label: 'Writing the Day one description',
      api: 'interactions',
      models: ['gemini-4-hydrogen', 'gemini-3.8-flash'],
      thinkingLevel: 'low',
      firstTimeoutMs: 20000,
      fallbackTimeoutMs: 12000,
      capBucket: 'other',
    },
  } satisfies Record<GeminiJobKey, GeminiJobConfig>,

  watcherThresholds: {
    raiseMinConfidence: 0.6,
    explainedMaxProbability: 0.5,
    mergeMinProbability: 0.7,
    maxMergePairsPerRequest: 10,
    /** Situation weekly stake (USD) at or above which it uses investigate_large */
    largeSituationStakeThresholdUsd: 5000,
  },

  checkerLimits: {
    maxToolRounds: 10,
    maxPlaceholderRetries: 1,
  },

  dailyCaps: {
    decision: 2000,
    other: 300,
  },

  /** Approximate per-1M token pricing in USD for telemetry estimation */
  pricingPerMillionUsd: {
    'gemini-decision-1': { input: 0.10, output: 0.0 },
    'gemini-3.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-3.8-flash': { input: 0.30, output: 2.50 },
    'gemini-4-hydrogen': { input: 0.50, output: 3.00 },
    'gemini-4-argon': { input: 1.25, output: 10.00 },
    'gemini-4-carbon': { input: 2.50, output: 15.00 },
  } as Record<string, ModelPricingPerMillionUsd>,
};
