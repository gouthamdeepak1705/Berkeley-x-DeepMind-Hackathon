import { X } from 'lucide-react';

interface RealityNoteModalProps {
  open: boolean;
  onClose: () => void;
}

export function RealityNoteModal({ open, onClose }: RealityNoteModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reality-note-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
    >
      <div className="bg-white border border-[#E6E1D8] rounded-xl max-w-lg w-full p-6 text-[#171717] shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="reality-note-title" className="font-display text-xl font-semibold text-[#171717]">
            What is real here?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close note"
            className="p-2 -mr-2 -mt-2 text-[#78716C] hover:text-[#171717] rounded-lg focus-visible:outline-2 focus-visible:outline-[#312E81]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#57534E]">
          <p>
            <strong className="font-semibold text-[#171717]">Simulated business:</strong> Linden &amp; Rye is a deterministic simulation of a 10-store California womenswear chain running from 1 January 2025 to 14 November 2026. All store sales, inventory cover, stockouts, and refund records come from one fixed seed.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">Computed figures:</strong> Every number on screen is computed by deterministic TypeScript code as a verified fact. Tapping any figure shows its ID, unit, and exact formula.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">Operating model:</strong> Detectors monitor daily sales, stock cover, and refund ratios against the trading calendar, opening-ramp curve, and delivery schedule, grouping related stock shortages and consequences into clear situations.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium bg-[#312E81] text-white rounded-lg hover:bg-[#26236B] transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
