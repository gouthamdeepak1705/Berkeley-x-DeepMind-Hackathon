import { X } from 'lucide-react';
import { Fact } from '../types/domain';

interface FactPopoverProps {
  fact: Fact | null;
  onClose: () => void;
}

export function FactPopover({ fact, onClose }: FactPopoverProps) {
  if (!fact) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Fact details for ${fact.label}`}
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[400px] z-50 bg-white border border-[#E6E1D8] rounded-xl shadow-lg p-5 text-[#171717]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#78716C]">{fact.label}</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-[#171717]">
            {fact.formatted}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close fact note"
          className="p-2 -mr-2 -mt-2 text-[#78716C] hover:text-[#171717] rounded-lg focus-visible:outline-2 focus-visible:outline-[#312E81]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[#57534E]">{fact.note}</p>

      <div className="mt-4 pt-3 border-t border-[#E6E1D8] flex items-center justify-between text-xs text-[#78716C] font-mono">
        <span className="truncate">{fact.id}</span>
        <span className="shrink-0 ml-2">unit: {fact.unit}</span>
      </div>
    </div>
  );
}
