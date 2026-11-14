import { Fact, TextSegment } from '../types/domain';

export interface PlaceholderValidationResult {
  ok: boolean;
  missingIds: string[];
  hasTypedDigits: boolean;
  wordCount: number;
  segments: TextSegment[];
}

const PLACEHOLDER_REGEX = /\{\{([a-zA-Z0-9_:-]+)\}\}/g;

export function countSegmentsWords(segments: TextSegment[]): number {
  const plain = segments
    .map((s) => (s.type === 'text' ? s.text : s.fact.formatted))
    .join(' ')
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

/**
 * Validates that a model-written template:
 * 1. Contains zero typed digits outside {{fact_id}} placeholders.
 * 2. Every {{fact_id}} placeholder resolves to a computed Fact in factMap.
 * Resolves the template into TextSegment[] so the UI renders every number as a tappable FactValue.
 */
export function validateAndResolvePlaceholders(
  template: string,
  factMap: Record<string, Fact>,
): PlaceholderValidationResult {
  if (!template || template.trim().length === 0) {
    return {
      ok: false,
      missingIds: [],
      hasTypedDigits: false,
      wordCount: 0,
      segments: [],
    };
  }

  const proseWithoutPlaceholders = template.replace(PLACEHOLDER_REGEX, ' ');
  const hasTypedDigits = /\d/.test(proseWithoutPlaceholders);

  const missingIds: string[] = [];
  const segments: TextSegment[] = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');

  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        text: template.slice(lastIndex, match.index),
      });
    }
    const factId = match[1];
    const fact = factMap[factId];
    if (!fact) {
      missingIds.push(factId);
      segments.push({
        type: 'text',
        text: `[missing:${factId}]`,
      });
    } else {
      segments.push({
        type: 'fact',
        fact: { ...fact },
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    segments.push({
      type: 'text',
      text: template.slice(lastIndex),
    });
  }

  const wordCount = countSegmentsWords(segments);

  return {
    ok: !hasTypedDigits && missingIds.length === 0 && segments.length > 0,
    missingIds,
    hasTypedDigits,
    wordCount,
    segments,
  };
}

const UNRESOLVED_MARKER_REGEX = /\{\{|\}\}|\[missing:/;

/**
 * Resolves any {{fact_id}} placeholders in a plain string against factMap.
 * If any unresolved placeholder or stray {{ / }} remains after resolution,
 * replaces that sentence (or the entire string) with fallbackSentence.
 */
export function resolveTextPlaceholdersWithFallback(
  template: string,
  factMap: Record<string, Fact>,
  fallbackSentence: string,
): { text: string; usedFallback: boolean } {
  const safeFallback = UNRESOLVED_MARKER_REGEX.test(fallbackSentence)
    ? fallbackSentence.replace(/\{\{[^}]*\}\}/g, '').replace(/\{\{|\}\}/g, '').trim()
    : fallbackSentence;

  if (!template || template.trim().length === 0) {
    return { text: safeFallback, usedFallback: true };
  }

  const resolved = template.replace(PLACEHOLDER_REGEX, (full, factId: string) => {
    const fact = factMap[factId];
    return fact ? fact.formatted : full;
  });

  if (!UNRESOLVED_MARKER_REGEX.test(resolved)) {
    return { text: resolved, usedFallback: false };
  }

  // Replace only unresolved sentence(s) when multiple sentences exist
  const sentences = resolved.match(/[^.!?]+(?:[.!?]+|$)/g);
  if (sentences && sentences.length > 1) {
    let usedFallback = false;
    let fallbackInserted = false;
    const rebuilt: string[] = [];
    for (const rawSentence of sentences) {
      if (!UNRESOLVED_MARKER_REGEX.test(rawSentence)) {
        rebuilt.push(rawSentence.trim());
      } else {
        usedFallback = true;
        if (!fallbackInserted && safeFallback) {
          rebuilt.push(safeFallback.trim());
          fallbackInserted = true;
        }
      }
    }
    const joined = rebuilt.filter(Boolean).join(' ').trim();
    if (joined && !UNRESOLVED_MARKER_REGEX.test(joined)) {
      return { text: joined, usedFallback };
    }
  }

  return { text: safeFallback, usedFallback: true };
}

/**
 * Ensures TextSegment[] has zero unresolved {{...}} or [missing:...] tokens.
 * Resolves any matching placeholders into fact segments and falls back to code segments otherwise.
 */
export function sanitizeSegmentsWithFallback(
  segments: TextSegment[],
  factMap: Record<string, Fact>,
  fallbackSegments: TextSegment[],
): { segments: TextSegment[]; usedFallback: boolean } {
  if (!segments || segments.length === 0) {
    return { segments: fallbackSegments, usedFallback: true };
  }

  const expanded: TextSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== 'text') {
      expanded.push(seg);
      continue;
    }
    if (!seg.text.includes('{{')) {
      expanded.push(seg);
      continue;
    }
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(seg.text)) !== null) {
      if (match.index > lastIdx) {
        expanded.push({ type: 'text', text: seg.text.slice(lastIdx, match.index) });
      }
      const fact = factMap[match[1]];
      if (fact) {
        expanded.push({ type: 'fact', fact: { ...fact } });
      } else {
        expanded.push({ type: 'text', text: match[0] });
      }
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < seg.text.length) {
      expanded.push({ type: 'text', text: seg.text.slice(lastIdx) });
    }
  }

  const hasUnresolved = expanded.some(
    (s) => s.type === 'text' && UNRESOLVED_MARKER_REGEX.test(s.text),
  );
  if (hasUnresolved) {
    return { segments: fallbackSegments, usedFallback: true };
  }
  return { segments: expanded, usedFallback: false };
}

/**
 * Defense-in-depth UI helper guaranteeing raw {{ or }} never renders on screen.
 */
export function stripUnresolvedBraces(text: string, fallbackText?: string): string {
  if (!UNRESOLVED_MARKER_REGEX.test(text)) {
    return text;
  }
  if (fallbackText && !UNRESOLVED_MARKER_REGEX.test(fallbackText)) {
    return fallbackText;
  }
  return text
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[missing:[^\]]*\]/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
