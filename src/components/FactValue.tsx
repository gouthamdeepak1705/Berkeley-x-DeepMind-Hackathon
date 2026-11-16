import { Fact } from '../types/domain';

interface FactValueProps {
  fact: Fact;
  onInspect: (fact: Fact) => void;
  className?: string;
  noPlus?: boolean;
  plainFont?: boolean;
}

export function formatPlainFactText(
  fact: Fact,
  options?: { noPlus?: boolean },
): string {
  if (fact.unit === 'weeks') {
    return `${fact.value.toFixed(1)} weeks`;
  }
  if (fact.unit === 'points') {
    const sign = !options?.noPlus && fact.value > 0 ? '+' : '';
    return `${sign}${fact.value.toFixed(1)} points`;
  }
  if (fact.unit === 'percent') {
    const sign = !options?.noPlus && fact.value > 0 ? '+' : '';
    return `${sign}${fact.value.toFixed(1)}%`;
  }
  if (options?.noPlus && fact.formatted.startsWith('+')) {
    return fact.formatted.slice(1);
  }
  return fact.formatted;
}

export function FactValue({
  fact,
  onInspect,
  className = '',
  noPlus = false,
  plainFont = false,
}: FactValueProps) {
  const display = formatPlainFactText(fact, { noPlus });
  return (
    <button
      type="button"
      onClick={() => onInspect(fact)}
      aria-label={`${fact.label}: ${display}. Tap to see how it was computed.`}
      title="Tap to see how this figure was computed"
      className={`inline-flex items-baseline ${plainFont ? 'font-sans' : 'font-mono'} tabular-nums underline decoration-dotted decoration-stone-400 underline-offset-4 hover:decoration-[#312E81] hover:text-[#312E81] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#312E81] rounded-sm cursor-pointer transition-colors ${className}`}
    >
      {display}
    </button>
  );
}
