import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { BuiltToolRecord, RefundRecord } from '../types/domain';
import { injectSandboxCsp } from '../builder/sandboxUtils';

interface BuiltToolPanelProps {
  tool: BuiltToolRecord;
  rows: RefundRecord[];
  switchEnabled: boolean;
  reviewedIds: string[];
  isBusy: boolean;
  onClose: () => void;
  onToggleReviewed: (refundId: string, reviewed: boolean) => void;
  onApproveRefundSwitch: (toolId: string, candidateId: string) => Promise<boolean>;
}

export function BuiltToolPanel({
  tool,
  rows,
  switchEnabled,
  reviewedIds,
  isBusy,
  onClose,
  onToggleReviewed,
  onApproveRefundSwitch,
}: BuiltToolPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [pendingSwitchConfirm, setPendingSwitchConfirm] = useState(false);

  const cspHtml = injectSandboxCsp(tool.html);

  const postInitToIframe = (nextSwitchEnabled: boolean, nextReviewedIds: string[]) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'init',
        storeName: tool.storeName,
        rows,
        switchEnabled: nextSwitchEnabled,
        reviewedIds: nextReviewedIds,
      },
      '*',
    );
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const data = ev.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'loaded') {
        setIframeLoaded(true);
        postInitToIframe(switchEnabled, reviewedIds);
      } else if (data.type === 'mark_reviewed' && typeof data.refundId === 'string') {
        onToggleReviewed(data.refundId, Boolean(data.reviewed));
      } else if (data.type === 'switch_toggle') {
        const requestedOn = Boolean(data.enabled);
        if (requestedOn && !switchEnabled) {
          setPendingSwitchConfirm(true);
        } else if (!requestedOn && switchEnabled) {
          // Rule switches off only via undo / Gateway; reset visual switch to current state
          postInitToIframe(switchEnabled, reviewedIds);
        }
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchEnabled, reviewedIds, rows, tool.storeName]);

  useEffect(() => {
    if (iframeLoaded) {
      postInitToIframe(switchEnabled, reviewedIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeLoaded, switchEnabled, reviewedIds, rows]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleConfirmSwitch = async () => {
    const ok = await onApproveRefundSwitch(tool.id, tool.situationId);
    if (ok) {
      setPendingSwitchConfirm(false);
    }
  };

  const handleCancelSwitch = () => {
    setPendingSwitchConfirm(false);
    postInitToIframe(switchEnabled, reviewedIds);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="built-tool-panel-title"
      className="fixed inset-0 z-50 bg-[#171717]/35 flex items-start justify-center lg:justify-start p-3 sm:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-[460px] lg:ml-[max(0px,calc((100vw-1360px)/2+16px))] bg-[#FAF8F5] border border-[#E6E1D8] rounded-xl shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 bg-white border-b border-[#E6E1D8] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-[#78716C]">
              Sandboxed tool · {tool.storeName}
            </p>
            <h2
              id="built-tool-panel-title"
              className="text-sm font-semibold text-[#171717] truncate"
            >
              {tool.title}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tool.usedFallbackCopy && (
              <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]">
                Fallback copy, not built live.
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tool panel"
              className="p-1.5 rounded-lg border border-[#E6E1D8] bg-white hover:bg-[#F3F0EA] text-[#57534E] hover:text-[#171717] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {pendingSwitchConfirm && (
          <div
            role="region"
            aria-label="Gateway approval for refund switch"
            className="px-4 py-3 bg-[#F5F7FF] border-b border-[#C7D2FE] text-xs space-y-2"
          >
            <div className="flex items-center gap-1.5 font-semibold text-[#312E81]">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Approve rule change via Gateway</span>
            </div>
            <p className="text-[#171717] leading-relaxed">
              Require manager approval for cash refunds over $50 at {tool.storeName}. Stops extra
              cash refunds starting tomorrow and tracks before-and-after rates for 21 days.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleConfirmSwitch}
                className="px-3 py-1.5 bg-[#312E81] hover:bg-[#26236B] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                {isBusy ? 'Approving...' : 'Approve rule change'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleCancelSwitch}
                className="px-3 py-1.5 bg-white hover:bg-[#F3F0EA] border border-[#E6E1D8] text-[#171717] text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-[480px] bg-[#FAF8F5]">
          <iframe
            ref={iframeRef}
            title={tool.title}
            sandbox="allow-scripts"
            srcDoc={cspHtml}
            className="w-full h-[540px] border-0 bg-[#FAF8F5]"
          />
        </div>
      </div>
    </div>
  );
}
