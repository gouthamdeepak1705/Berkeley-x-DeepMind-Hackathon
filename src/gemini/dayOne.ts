import { createFact } from '../engine/facts';
import { DayOneBrief, Fact, TextSegment } from '../types/domain';
import { callInteractionRaw, isGeminiCallBlocked } from './client';
import { validateAndResolvePlaceholders } from './placeholders';
import { GEMINI_SETTINGS } from './settings';

function buildCodeFallbackParagraphs(brief: DayOneBrief): TextSegment[][] {
  const f = brief.summaryFacts;
  return [
    [
      { type: 'text', text: `${brief.businessName} is a California womenswear chain with ` },
      { type: 'fact', fact: f.storeCount },
      { type: 'text', text: ' stores: ' },
      { type: 'fact', fact: f.establishedCount },
      { type: 'text', text: ' established locations open more than eighteen months and ' },
      { type: 'fact', fact: f.newStoreCount },
      { type: 'text', text: ' newer openings (Burlingame in June and Napa opening in late August).' },
    ],
    [
      { type: 'text', text: 'Trading peaks sharply at the weekend—Saturdays run ' },
      { type: 'fact', fact: f.strongestWeekdayShare },
      { type: 'text', text: ' above the weekly daily average—and follows clear seasonal swings, with December lifting ' },
      { type: 'fact', fact: f.decemberIndex },
      { type: 'text', text: ' while August through early September softens ' },
      { type: 'fact', fact: f.lullIndex },
      { type: 'text', text: '.' },
    ],
    [
      { type: 'text', text: 'Sales split across three product groups: Best-sellers at ' },
      { type: 'fact', fact: f.bestSellersShare },
      { type: 'text', text: ', Knitwear at ' },
      { type: 'fact', fact: f.knitwearShare },
      { type: 'text', text: ', and Everything else making up the remaining half.' },
    ],
  ];
}

export async function generateDayOneBriefWithGemini(baseBrief: DayOneBrief): Promise<DayOneBrief> {
  const f = baseBrief.summaryFacts;
  const everythingElseShare = createFact(
    'dayone:everything_else_share',
    'Everything else share',
    50,
    'share_percent',
    'Remaining half of chain revenue outside Best-sellers and Knitwear.',
  );

  const factMap: Record<string, Fact> = {
    [f.storeCount.id]: f.storeCount,
    [f.establishedCount.id]: f.establishedCount,
    [f.newStoreCount.id]: f.newStoreCount,
    [f.strongestWeekdayShare.id]: f.strongestWeekdayShare,
    [f.decemberIndex.id]: f.decemberIndex,
    [f.lullIndex.id]: f.lullIndex,
    [f.bestSellersShare.id]: f.bestSellersShare,
    [f.knitwearShare.id]: f.knitwearShare,
    [everythingElseShare.id]: everythingElseShare,
  };

  const cfg = GEMINI_SETTINGS.jobs.day_one_description;
  if (isGeminiCallBlocked(cfg.capBucket)) {
    return {
      ...baseBrief,
      narrativeSegments: buildCodeFallbackParagraphs(baseBrief),
      narrativeMeta: {
        model: 'code',
        mode: 'fallback',
        latencyMs: 0,
      },
    };
  }

  const factListing = Object.values(factMap)
    .map((fact) => `- {{${fact.id}}}: ${fact.label} (computed value: ${fact.formatted})`)
    .join('\n');

  const basePrompt = [
    `Write a calm, clear three-paragraph Day One summary for the owner of ${baseBrief.businessName}, a California womenswear chain.`,
    'Paragraph 1: store footprint (total stores, established locations open more than eighteen months, and newer openings: Burlingame opened in June, and Napa opening in late August).',
    'Paragraph 2: weekly and seasonal rhythm (Saturday weekend peak, December lift, August to early September summer lull).',
    'Paragraph 3: product group mix (Best-sellers, Knitwear, Everything else).',
    '',
    'CRITICAL RULES:',
    '- NEVER type any digits (0-9) anywhere outside {{fact_id}} placeholders. Even small counts or months like "18" or "22" must either be written in words ("eighteen", "late August") or placed via a {{fact_id}} placeholder.',
    '- Use exact {{fact_id}} placeholders from the list below for every metric.',
    '',
    'Available facts:',
    factListing,
  ].join('\n');

  const responseFormat = {
    type: 'text' as const,
    mime_type: 'application/json' as const,
    schema: {
      type: 'object',
      properties: {
        paragraphs: {
          type: 'array',
          items: { type: 'string' },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ['paragraphs'],
      additionalProperties: false,
    },
  };

  for (let idx = 0; idx < cfg.models.length; idx++) {
    const model = cfg.models[idx];
    const timeoutMs = idx === 0 ? cfg.firstTimeoutMs : cfg.fallbackTimeoutMs;
    let prompt = basePrompt;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await callInteractionRaw({
          job: 'day_one_description',
          feature: 'day_one_description',
          model,
          input: prompt,
          responseFormat,
          timeoutMs,
          store: false,
        });

        const parsed = JSON.parse(res.output_text) as { paragraphs?: string[] };
        if (!Array.isArray(parsed.paragraphs) || parsed.paragraphs.length !== 3) {
          throw new Error('Expected exactly 3 paragraphs in JSON response.');
        }

        const resolved: TextSegment[][] = [];
        let valid = true;
        let hasDigits = false;
        let missing: string[] = [];

        for (const p of parsed.paragraphs) {
          const check = validateAndResolvePlaceholders(p, factMap);
          if (!check.ok) {
            valid = false;
            if (check.hasTypedDigits) hasDigits = true;
            missing = missing.concat(check.missingIds);
          }
          resolved.push(check.segments);
        }

        if (valid) {
          return {
            ...baseBrief,
            narrativeSegments: resolved,
            narrativeMeta: {
              model: res.model,
              mode: res.mode,
              latencyMs: res.latencyMs,
            },
          };
        }

        if (attempt === 0) {
          prompt = [
            basePrompt,
            '',
            `Previous draft failed validation (${hasDigits ? 'contained typed digits outside placeholders' : ''}${missing.length ? ` unknown placeholders: ${missing.join(', ')}` : ''}).`,
            'Rewrite all 3 paragraphs using ONLY words and valid {{fact_id}} placeholders with zero digits 0-9 outside {{...}}.',
          ].join('\n');
        }
      } catch {
        break;
      }
    }
  }

  return {
    ...baseBrief,
    narrativeSegments: buildCodeFallbackParagraphs(baseBrief),
    narrativeMeta: {
      model: 'code',
      mode: 'fallback',
      latencyMs: 0,
    },
  };
}
