import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ShieldCheck, Wrench } from 'lucide-react';
import { formatShortDate } from '../../engine/calendar';
import { injectSandboxCsp } from '../../builder/sandboxUtils';
import { BuiltToolRecord, Fact, RefundRecord } from '../../types/domain';
import { FactValue } from '../FactValue';
import { DemoHighlightState } from '../OwnerFeed';
import { formatSimpleSeconds, toSimpleEnglish } from './SimpleHelpers';

interface InlineBuiltRefundToolCardProps {
  tool: BuiltToolRecord;
  rows: RefundRecord[];
  switchEnabled: boolean;
  reviewedIds: string[];
  unreviewedFact?: Fact;
  isBusy: boolean;
  demoHighlight?: DemoHighlightState | null;
  highlightBadgeText?: string;
  forceExpanded?: boolean;
  onInspectFact: (fact: Fact) => void;
  onToggleReviewed: (refundId: string, reviewed: boolean) => void;
  onApproveRefundSwitch: (toolId: string, candidateId: string) => Promise<boolean>;
  onOpenModalFallback?: (toolId: string) => void;
}

export function InlineBuiltRefundToolCard({
  tool,
  rows,
  switchEnabled,
  reviewedIds,
  unreviewedFact,
  isBusy,
  demoHighlight,
  highlightBadgeText = 'The demo chooses this',
  forceExpanded = false,
  onInspectFact,
  onToggleReviewed,
  onApproveRefundSwitch,
}: InlineBuiltRefundToolCardProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(true);
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
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const passedCount = tool.testResults.filter((t) => t.passed).length;
  const openBtnKey = `open_tool:${tool.id}`;
  const isHighlighted = demoHighlight?.actionKey === openBtnKey;

  const handleTurnOnRule = async () => {
    const ok = await onApproveRefundSwitch(tool.id, tool.situationId);
    if (ok) {
      setPendingSwitchConfirm(false);
    }
  };

  return (
    <div
      data-testid="inline-built-tool-card"
      data-tour-target="inline_tool"
      className="simple-card-enter bg-white border border-[#CFE0D4] rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#25372C] shrink-0" />
            <h3 className="text-sm font-semibold text-[#25372C]">
              {toSimpleEnglish(tool.title)}
            </h3>
          </div>
          <p className="text-xs text-[#56695D]">
            Built by Opscien in {formatSimpleSeconds(tool.latencyMs)}. Tested {passedCount} times.
            Installed {formatShortDate(tool.installedOn)}.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8CEB8] bg-[#FFFDF7] hover:bg-[#F5EEDD] text-[#25372C] cursor-pointer ${
            isHighlighted ? 'ring-2 ring-offset-2 ring-[#25372C]' : ''
          }`}
        >
          <span>{expanded ? 'Hide refund desk' : 'Show refund desk'}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isHighlighted && (
        <p className="text-xs font-medium text-[#25372C] bg-[#E8F1EC] px-2.5 py-1 rounded-md border border-[#C6DBC9] inline-block">
          {highlightBadgeText}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#FFFDF7] border border-[#EFE8D6] text-xs">
        <div className="flex flex-wrap items-center gap-4 text-[#43564A]">
          {unreviewedFact && (
            <span>
              Unreviewed flagged:{' '}
              <FactValue fact={unreviewedFact} onInspect={onInspectFact} noPlus plainFont />
            </span>
          )}
          <span>
            $50 cash refund rule:{' '}
            <strong className={switchEnabled ? 'text-[#15803D]' : 'text-[#991B1B]'}>
              {switchEnabled ? 'Active' : 'Off'}
            </strong>
          </span>
        </div>

        {!switchEnabled && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setPendingSwitchConfirm(true)}
            className={`px-3.5 py-1.5 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              isHighlighted ? 'ring-2 ring-offset-2 ring-[#25372C]' : ''
            }`}
          >
            Turn on $50 approval rule
          </button>
        )}
      </div>

      {pendingSwitchConfirm && !switchEnabled && (
        <div className="p-3.5 rounded-xl bg-[#F4F8F5] border border-[#BBF7D0] text-xs space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-[#14532D]">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Confirm rule change within safety limits</span>
          </div>
          <p className="text-[#25372C] leading-snug">
            Require manager approval for cash refunds over $50 at {tool.storeName}. Starts
            tomorrow and tracks refund rates for 21 days.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleTurnOnRule()}
              className="px-3.5 py-1.5 bg-[#25372C] hover:bg-[#1C2A21] disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              {isBusy ? 'Turning on...' : 'Approve rule change'}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setPendingSwitchConfirm(false);
                postInitToIframe(switchEnabled, reviewedIds);
              }}
              className="px-3 py-1.5 bg-white hover:bg-[#F5EEDD] border border-[#D8CEB8] text-[#25372C] text-xs font-medium rounded-lg cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="rounded-xl border border-[#DFD5BE] overflow-hidden bg-[#FFF8E8]">
          <iframe
            ref={iframeRef}
            title={tool.title}
            sandbox="allow-scripts"
            srcDoc={cspHtml}
            className="w-full h-[380px] border-0 bg-[#FFF8E8]"
          />
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#56695D]">
        {tool.testResults.map((tr) => (
          <li key={tr.id} className="inline-flex items-center gap-1">
            <Check className="w-3 h-3 text-[#15803D] shrink-0" />
            <span>{toSimpleEnglish(tr.label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
