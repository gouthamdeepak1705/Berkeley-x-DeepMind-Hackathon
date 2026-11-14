import { Fact, TextSegment } from '../types/domain';

export interface PlaceholderValidationResult {
  ok: boolean;
  missingIds: string[];
  hasTypedDigits: boolean;
  segments: TextSegment[];
}

const PLACEHOLDER_REGEX = /\{\{([a-zA-Z0-9_:-]+)\}\}/g;

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

  return {
    ok: !hasTypedDigits && missingIds.length === 0 && segments.length > 0,
    missingIds,
    hasTypedDigits,
    segments,
  };
}
