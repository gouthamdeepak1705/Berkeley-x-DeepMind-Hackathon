import { Fact } from '../types/domain';

interface FactValueProps {
  fact: Fact;
  onInspect: (fact: Fact) => void;
  className?: string;
}

export function FactValue({ fact, onInspect, className = '' }: FactValueProps) {
  return (
    <button
      type="button"
      onClick={() => onInspect(fact)}
      aria-label={`${fact.label}: ${fact.formatted}. Tap to see how it was computed.`}
      title="Tap to see how this figure was computed"
      className={`inline-flex items-baseline font-mono tabular-nums underline decoration-dotted decoration-stone-400 underline-offset-4 hover:decoration-[#312E81] hover:text-[#312E81] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#312E81] rounded-sm cursor-pointer transition-colors ${className}`}
    >
      {fact.formatted}
    </button>
  );
}
