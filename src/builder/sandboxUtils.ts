import { RefundRecord } from '../types/domain';
import { isFlaggedRefundRecord } from './fallbackTool';

export interface FlaggedRefundStats {
  flaggedRows: RefundRecord[];
  count: number;
  total: number;
  unreviewedFlaggedCount: number;
}

export function computeExpectedFlaggedStats(
  rows: RefundRecord[],
  reviewedIds: Set<string> = new Set(),
): FlaggedRefundStats {
  const flaggedRows = rows.filter(isFlaggedRefundRecord);
  let totalCents = 0;
  let unreviewedFlaggedCount = 0;
  for (const r of flaggedRows) {
    totalCents += Math.round(r.amount * 100);
    if (!reviewedIds.has(r.id)) {
      unreviewedFlaggedCount++;
    }
  }
  return {
    flaggedRows,
    count: flaggedRows.length,
    total: Math.round(totalCents) / 100,
    unreviewedFlaggedCount,
  };
}

export function injectSandboxCsp(html: string): string {
  const cspMeta =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\';" />';
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    return html;
  }
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}\n  ${cspMeta}${html.slice(insertAt)}`;
  }
  return `${cspMeta}\n${html}`;
}
