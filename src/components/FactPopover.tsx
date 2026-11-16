import { X } from 'lucide-react';
import { Fact } from '../types/domain';
import { formatPlainFactText } from './FactValue';
import { toSimpleEnglish } from './simple/SimpleHelpers';

interface FactPopoverProps {
  fact: Fact | null;
  plainFont?: boolean;
  onClose: () => void;
}

export function FactPopover({ fact, plainFont = false, onClose }: FactPopoverProps) {
  if (!fact) return null;

  const display = plainFont
    ? formatPlainFactText(fact, { noPlus: true })
    : fact.formatted;
  const labelDisplay = plainFont ? toSimpleEnglish(fact.label) : fact.label;
  const noteDisplay = plainFont ? toSimpleEnglish(fact.note) : fact.note;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Fact details for ${labelDisplay}`}
      className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[400px] z-50 bg-white rounded-xl shadow-lg p-5 ${
        plainFont
          ? 'border border-[#D8CEB8] text-[#25372C] font-sans'
          : 'border border-[#E6E1D8] text-[#171717]'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-medium ${plainFont ? 'text-[#56695D]' : 'text-[#78716C]'}`}>
            {labelDisplay}
          </p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${
              plainFont ? 'font-sans text-[#25372C]' : 'font-mono text-[#171717]'
            }`}
          >
            {display}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close fact note"
          className="p-2 -mr-2 -mt-2 text-[#78716C] hover:text-[#171717] rounded-lg focus-visible:outline-2 focus-visible:outline-[#312E81] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p
        className={`mt-3 text-sm leading-relaxed ${
          plainFont ? 'text-[#43564A]' : 'text-[#57534E]'
        }`}
      >
        {noteDisplay}
      </p>

      {!plainFont && (
        <div className="mt-4 pt-3 border-t border-[#E6E1D8] flex items-center justify-between text-xs text-[#78716C] font-mono">
          <span className="truncate">{fact.id}</span>
          <span className="shrink-0 ml-2">unit: {fact.unit}</span>
        </div>
      )}
    </div>
  );
}
