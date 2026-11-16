import { X } from 'lucide-react';
import { GEMINI_SETTINGS } from '../gemini/settings';

interface RealityNoteModalProps {
  open: boolean;
  simpleMode?: boolean;
  onClose: () => void;
}

export function RealityNoteModal({ open, simpleMode = false, onClose }: RealityNoteModalProps) {
  if (!open) return null;

  const jobList = Object.values(GEMINI_SETTINGS.jobs);

  if (simpleMode) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reality-note-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#25372C]/35 p-4 overflow-y-auto"
      >
        <div className="bg-[#FFF8E8] border border-[#D8CEB8] rounded-2xl max-w-lg w-full p-5 sm:p-6 text-[#25372C] font-sans shadow-xl my-auto max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <h2 id="reality-note-title" className="text-lg font-semibold text-[#25372C]">
              What is real here?
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close note"
              className="p-2 -mr-2 -mt-2 text-[#56695D] hover:text-[#25372C] rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#43564A]">
            <p>
              <strong className="font-semibold text-[#25372C]">The business is simulated:</strong>{' '}
              Linden &amp; Rye is a simulated 10-store clothing business across 106 trading days.
              Nothing connects to real tills or live shop stock.
            </p>
            <p>
              <strong className="font-semibold text-[#25372C]">Every number comes from code:</strong>{' '}
              The AI never invents or calculates figures. Code computes every amount from till and
              stock records; tap any number to see the exact rule.
            </p>
            <p>
              <strong className="font-semibold text-[#25372C]">How savings are measured:</strong>{' '}
              Money totals compare your run day by day against a matching run where no actions are
              taken. Future days after the date on screen are never included.
            </p>
            <p>
              <strong className="font-semibold text-[#25372C]">Safe limits and store tools:</strong>{' '}
              Every stock move checks that spare-stock stores keep enough to reach their own next
              delivery. New store tools run inside an isolated browser frame and pass three checks
              before opening.
            </p>
            <p>
              <strong className="font-semibold text-[#25372C]">Real AI reasoning:</strong> Standard
              stops replay pre-recorded AI answers right away, and any new path you take calls the
              AI live within daily safety limits. Turn on Show technical detail to inspect every
              AI model and call.
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold bg-[#25372C] text-white rounded-xl hover:bg-[#1C2A21] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reality-note-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 overflow-y-auto"
    >
      <div className="bg-white border border-[#E6E1D8] rounded-xl max-w-lg w-full p-5 sm:p-6 text-[#171717] shadow-xl my-auto max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h2 id="reality-note-title" className="font-display text-xl font-semibold text-[#171717]">
            What is real here?
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close note"
            className="p-2 -mr-2 -mt-2 text-[#78716C] hover:text-[#171717] rounded-lg focus-visible:outline-2 focus-visible:outline-[#312E81] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#57534E]">
          <p>
            <strong className="font-semibold text-[#171717]">Simulated business:</strong> Linden &amp;
            Rye is a deterministic simulated business (10 California womenswear stores from 1
            January 2025 to 14 November 2026) driven by one fixed seed. Nothing connects to real
            tills or live inventory.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">Code computes every number:</strong>{' '}
            Gemini never invents or calculates figures. Every number on screen is computed in
            deterministic code; tapping any figure shows its ID, unit, and formula.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">With and without Opscien:</strong>{' '}
            Saved and lost dollar totals compare your decisions day by day against a second run
            of the exact same seed where no action is taken. No future days after the date on screen
            are ever included.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">One gateway &amp; isolated builder:</strong>{' '}
            Every action passes through one code gateway enforcing safety limits and cover floors.
            Built store tools run inside an isolated browser container with strict CSP rules and must
            pass three verification checks before opening.
          </p>
          <p>
            <strong className="font-semibold text-[#171717]">Recorded &amp; Live AI models:</strong>{' '}
            By default the run opens in Recorded, live when needed — using pre-recorded real Gemini
            answers on the standard path with zero live API cost, and calling Gemini live (within
            daily caps) whenever you take a different path. You can switch to Always live in the
            right panel to make fresh calls against these jobs from settings:
          </p>
          <ul className="bg-[#FAF8F5] border border-[#E6E1D8] rounded-lg p-3 space-y-1.5 text-xs">
            {jobList.map((job) => (
              <li key={job.key} className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                <span className="font-medium text-[#171717]">{job.label}</span>
                <span className="font-mono text-[#57534E]">
                  {job.models[0]}
                  {job.models.length > 1 ? ` (fallback: ${job.models.slice(1).join(', ')})` : ''}
                </span>
              </li>
            ))}
          </ul>
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
