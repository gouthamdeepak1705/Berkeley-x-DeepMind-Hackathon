import { useEffect, useRef, useState } from 'react';
import { Fact, ProofTag, TextSegment } from '../../types/domain';
import { stripUnresolvedBraces } from '../../gemini/placeholders';
import { FactValue } from '../FactValue';

export function formatSimpleSeconds(ms: number): string {
  const sec = Math.max(0.1, ms / 1000);
  return `${sec.toFixed(1)} seconds`;
}

export function formatWholeUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function toSimpleEnglish(
  raw: string,
  options?: { preserveWhitespace?: boolean },
): string {
  const cleaned = stripUnresolvedBraces(raw)
    .replace(/\bOpsCien\b/g, 'Opscien')
    .replace(/\bTool to build:\s*/gi, '')
    .replace(
      /\bUnlinked late-evening cash refunds\b/gi,
      'Late-evening cash refunds with no matching sale',
    )
    .replace(/\bdonor stores\b/g, 'stores with stock to spare')
    .replace(/\bDonor stores\b/g, 'Stores with stock to spare')
    .replace(/\bdonor store\b/g, 'store with stock to spare')
    .replace(/\bDonor store\b/g, 'Store with stock to spare')
    .replace(/\bdonors\b/g, 'stores with spare stock')
    .replace(/\bdonor\b/gi, 'spare-stock')
    .replace(/\bkeep their cover\b/gi, 'keep enough stock for themselves')
    .replace(/\bweeks of cover\b/gi, 'weeks of stock left')
    .replace(/\bwks of cover\b/gi, 'weeks of stock left')
    .replace(/\bcover floors?\b/gi, 'minimum stock limits')
    .replace(/\bcover\b/gi, 'weeks of stock left')
    .replace(/\bwks\b/gi, 'weeks')
    .replace(/\bcomparable stores\b/g, 'stores open more than 18 months')
    .replace(/\bComparable stores\b/g, 'Stores open more than 18 months')
    .replace(/\blike-for-like\b/gi, 'stores open more than 18 months')
    .replace(/\bLFL\b/g, 'stores open more than 18 months')
    .replace(/\b(the|a)\s+(held-out control store|held-out store|control store|comparison store)\b/gi, 'the store held back for comparison')
    .replace(/\b(held-out control store|held-out store|control store)\b/gi, 'the store held back for comparison')
    .replace(/\bcomparison store\b/gi, 'store held back for comparison')
    .replace(/\blook-alikes\b/gi, 'things that looked like problems but were not')
    .replace(/\blook-alike\b/gi, 'thing that looked like a problem but was not')
    .replace(/\bchain median\b/gi, 'the other stores')
    .replace(/\bmedian\b/gi, 'typical')
    .replace(/\bunlinked cash refunds\b/g, 'cash refunds with no matching sale')
    .replace(/\bUnlinked cash refunds\b/g, 'Cash refunds with no matching sale')
    .replace(/\bunlinked\b/gi, 'with no matching sale')
    .replace(/\bleakage\b/gi, 'money lost')
    .replace(/\bexposure\b/gi, 'loss')
    .replace(/\bGateway approved\b/gi, 'Passed the safety limits')
    .replace(/\bGateway passed\b/gi, 'Passed the safety limits')
    .replace(/\bgateway\b/gi, 'safety limits')
    .replace(/\bRollout:\s*/gi, 'Send the rest: ')
    .replace(/\brolling out\b/gi, 'sending the rest')
    .replace(/\broll out\b/gi, 'send the rest')
    .replace(/\brollout\b/gi, 'send the rest')
    .replace(
      /\bBefore and after, one store:\s*not proven alone\.?/gi,
      'Likely, not proven: measured before and after at one store.',
    )
    .replace(
      /\bOne store, before and after:\s*not proven\.?/gi,
      'Likely, not proven: measured before and after at one store.',
    )
    .replace(/\bnot proven alone\b/gi, 'likely, not proven')
    .replace(/\bcausal proof is partial\b/gi, 'likely, not proven')
    .replace(/\bNoticed and let go\b/gi, 'Noticed, checked, and stayed quiet')
    .replace(/\bGemini\b/gi, 'Opscien')
    .replace(/\breplayed\b/gi, 'recorded')
    .replace(/\bfallback\b/gi, 'backup')
    .replace(/\bcaps?\b/gi, 'limits')
    .replace(/\bpts\b/gi, 'points')
    .replace(/\(\s*simulated\s*\)/gi, '')
    .replace(/\+(\d)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');

  return options?.preserveWhitespace ? cleaned : cleaned.trim();
}

export function SimpleTextSegments({
  segments,
  onInspectFact,
}: {
  segments: TextSegment[];
  onInspectFact: (fact: Fact) => void;
}) {
  return (
    <>
      {segments.map((seg, idx) =>
        seg.type === 'text' ? (
          <span key={`st-${idx}`}>
            {toSimpleEnglish(seg.text, { preserveWhitespace: true })}
          </span>
        ) : (
          <FactValue
            key={`sf-${seg.fact.id}-${idx}`}
            fact={seg.fact}
            onInspect={onInspectFact}
            noPlus
            plainFont
          />
        ),
      )}
    </>
  );
}

export function AnimatedUsd({
  fact,
  onInspect,
  className = '',
}: {
  fact: Fact;
  onInspect: (fact: Fact) => void;
  className?: string;
}) {
  const target = Math.round(fact.value);
  const [displayed, setDisplayed] = useState<number>(target);
  const currentRef = useRef<number>(target);

  useEffect(() => {
    const startVal = currentRef.current;
    if (startVal === target) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      currentRef.current = target;
      setDisplayed(target);
      return;
    }

    const duration = 260;
    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(startVal + (target - startVal) * eased);
      currentRef.current = next;
      setDisplayed(next);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target]);

  return (
    <button
      type="button"
      onClick={() => onInspect(fact)}
      aria-label={`${fact.label}: ${formatWholeUsd(target)}. Tap to see how it was computed.`}
      title="Tap to see how this figure was computed"
      className={`inline-flex items-baseline font-sans tabular-nums underline decoration-dotted decoration-[#9CB0A3] underline-offset-4 hover:text-[#15803D] cursor-pointer transition-colors ${className}`}
    >
      {formatWholeUsd(displayed)}
    </button>
  );
}

export function ProofPill({ proof }: { proof: ProofTag }) {
  if (proof === 'proven') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#DCFCE7] text-[#14532D] border border-[#BBF7D0]">
        Proven: compared with the store held back for comparison
      </span>
    );
  }
  if (proof === 'likely') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F3EFE3] text-[#43564A] border border-[#DFD7C2]">
        Likely, not proven: measured before and after at one store
      </span>
    );
  }
  if (proof === 'mixed') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#EEF6F0] text-[#25372C] border border-[#CBE1D1]">
        Part proven, part likely
      </span>
    );
  }
  return null;
}

export function LiveWorkingBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="live-working-banner"
      className="px-4 py-2.5 rounded-xl bg-white border border-[#D8CEB8] text-sm text-[#25372C] flex items-center gap-2.5 shadow-2xs"
    >
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#25372C] animate-pulse shrink-0" />
      <span>Working this out live. This takes about a minute.</span>
    </div>
  );
}
