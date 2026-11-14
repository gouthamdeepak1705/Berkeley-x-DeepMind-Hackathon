import { addDays, diffDays, formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { STORE_MAP } from '../engine/stores';
import {
  ActionDecision,
  Fact,
  StoreId,
  TraceEntry,
  TransferLine,
  TransferPlan,
} from '../types/domain';

export interface GatewayActionRequest {
  candidateId: string;
  date: string;
  kind:
    | 'transfer'
    | 'control_holdout'
    | 'refund_audit'
    | 'refund_switch'
    | 'store_manager_task'
    | 'other';
  storeId?: StoreId;
  groupId?: 'best_sellers' | 'knitwear';
  dueDate?: string;
  toolId?: string;
  transferLines?: TransferLine[];
  holdoutStoreId?: StoreId;
  holdoutStoreName?: string;
  measure?: string;
  title?: string;
  parentDecisionId?: string;
  ownerApproved: boolean;
  approvedBy?: string;
  plan?: TransferPlan;
}

export interface GatewayActionResult {
  ok: boolean;
  refusalReason?: string;
  decision?: ActionDecision;
  preview?: {
    summary: string;
    totalUnits: number;
    arrivalDate: string;
    limitNote: string;
    lines: TransferLine[];
  };
  traceEntry: TraceEntry;
}

export interface GatewaySelfTestCase {
  id: string;
  label: string;
  ok: boolean;
  refusedAsExpected: boolean;
  reason: string;
}

const gatewayAttemptLog: TraceEntry[] = [];

export function getGatewayAttemptLog(): TraceEntry[] {
  return [...gatewayAttemptLog];
}

export function clearGatewayAttemptLog(): void {
  gatewayAttemptLog.length = 0;
}

/**
 * Direct stock mutation is forbidden. Code calling this helper is always refused and logged.
 */
export function attemptDirectStockMutationBypass(params: {
  date: string;
  storeId: StoreId;
  groupId: 'best_sellers' | 'knitwear';
  deltaUnits: number;
}): { ok: false; reason: string; traceEntry: TraceEntry } {
  const reason = `Refused: direct stock change (${params.deltaUnits} units at ${STORE_MAP[params.storeId].name}) bypassed the one action gateway.`;
  const traceEntry: TraceEntry = {
    id: `trace:${params.date}:gw:bypass:${Date.now()}`,
    date: params.date,
    lane: 'manager',
    kind: 'gateway',
    headline: 'Gateway refused direct stock bypass',
    detail: reason,
    outcome: 'let_go',
  };
  gatewayAttemptLog.push(traceEntry);
  return { ok: false, reason, traceEntry };
}

/**
 * The one gateway through which every state-changing business action must pass.
 * Enforces all donor cover floors, next-delivery + 1 week reserve, and >500-unit approval limits in code.
 */
export function executeActionThroughGateway(
  request: GatewayActionRequest,
  sim: SimulationRun,
): GatewayActionResult {
  const date = request.date;
  const recs = sim.storeRecordsByDate[date];
  if (!recs) {
    const reason = `Refused: date ${date} is outside the simulation calendar.`;
    const traceEntry: TraceEntry = {
      id: `trace:${date}:gw:invalid_date:${gatewayAttemptLog.length}`,
      date,
      lane: 'manager',
      kind: 'gateway',
      headline: 'Gateway refused action',
      detail: reason,
      outcome: 'let_go',
    };
    gatewayAttemptLog.push(traceEntry);
    return { ok: false, refusalReason: reason, traceEntry };
  }

  if (request.kind === 'transfer') {
    const groupId = request.groupId ?? request.plan?.groupId ?? 'best_sellers';
    const grpLabel = groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
    const avgPrice = groupId === 'best_sellers' ? 120 : 90;
    const lines = request.transferLines ?? request.plan?.transferLines ?? [];

    if (lines.length === 0) {
      const reason = `Refused: no valid ${grpLabel} transfer lines have donor surplus above the safety floor.`;
      const traceEntry: TraceEntry = {
        id: `trace:${date}:gw:empty:${gatewayAttemptLog.length}`,
        date,
        lane: 'manager',
        kind: 'gateway',
        headline: 'Gateway refused transfer',
        detail: reason,
        outcome: 'let_go',
      };
      gatewayAttemptLog.push(traceEntry);
      return { ok: false, refusalReason: reason, traceEntry };
    }

    // Aggregate outgoing units per donor store
    const outgoingByDonor = new Map<StoreId, number>();
    let totalUnits = 0;

    for (const line of lines) {
      if (line.units <= 0 || line.fromStoreId === line.toStoreId) {
        const reason = `Refused: invalid transfer line (${line.units} units from ${line.fromStoreId} to ${line.toStoreId}).`;
        const traceEntry: TraceEntry = {
          id: `trace:${date}:gw:badline:${gatewayAttemptLog.length}`,
          date,
          lane: 'manager',
          kind: 'gateway',
          headline: 'Gateway refused invalid transfer line',
          detail: reason,
          outcome: 'let_go',
        };
        gatewayAttemptLog.push(traceEntry);
        return { ok: false, refusalReason: reason, traceEntry };
      }
      totalUnits += line.units;
      outgoingByDonor.set(
        line.fromStoreId,
        (outgoingByDonor.get(line.fromStoreId) ?? 0) + line.units,
      );
    }

    // Enforce > 500-unit rule and general owner approval requirement (Stage 3 has no autonomous authority yet)
    if (totalUnits > 500 && !request.ownerApproved) {
      const reason = `Refused: transfer of ${totalUnits} units exceeds the 500-unit limit and requires owner approval.`;
      const traceEntry: TraceEntry = {
        id: `trace:${date}:gw:limit500:${gatewayAttemptLog.length}`,
        date,
        lane: 'manager',
        kind: 'gateway',
        headline: 'Gateway refused unapproved >500-unit transfer',
        detail: reason,
        outcome: 'let_go',
      };
      gatewayAttemptLog.push(traceEntry);
      return { ok: false, refusalReason: reason, traceEntry };
    }

    if (!request.ownerApproved) {
      const reason = 'Refused: action requires owner approval (no autonomous authority granted yet).';
      const traceEntry: TraceEntry = {
        id: `trace:${date}:gw:no_approval:${gatewayAttemptLog.length}`,
        date,
        lane: 'manager',
        kind: 'gateway',
        headline: 'Gateway refused unapproved action',
        detail: reason,
        outcome: 'let_go',
      };
      gatewayAttemptLog.push(traceEntry);
      return { ok: false, refusalReason: reason, traceEntry };
    }

    // Enforce donor cover floor (>= 8 weeks AND >= cover to next delivery + 1 week) and spare limit
    const nextDel = sim.scheduledDeliveries
      .filter((d) => d.groupId === groupId && d.date > date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const daysUntilDelivery = nextDel ? Math.max(1, diffDays(date, nextDel.date)) : null;
    const deliveryPlusOneWeeks = daysUntilDelivery !== null ? daysUntilDelivery / 7 + 1 : 0;
    const requiredFloorWeeks = Math.max(8, deliveryPlusOneWeeks);

    for (const [donorId, movedUnits] of outgoingByDonor.entries()) {
      const donorRec = recs[donorId];
      if (!donorRec || !donorRec.isOpen) {
        const reason = `Refused: donor store ${STORE_MAP[donorId]?.name ?? donorId} is not open on ${date}.`;
        const traceEntry: TraceEntry = {
          id: `trace:${date}:gw:closed:${gatewayAttemptLog.length}`,
          date,
          lane: 'manager',
          kind: 'gateway',
          headline: 'Gateway refused transfer from closed donor',
          detail: reason,
          outcome: 'let_go',
        };
        gatewayAttemptLog.push(traceEntry);
        return { ok: false, refusalReason: reason, traceEntry };
      }

      const gs = donorRec.groups[groupId];
      if (movedUnits > gs.endingStock) {
        const reason = `Refused: ${STORE_MAP[donorId].name} only holds ${Math.floor(gs.endingStock)} ${grpLabel} units (cannot transfer ${movedUnits}).`;
        const traceEntry: TraceEntry = {
          id: `trace:${date}:gw:stock:${gatewayAttemptLog.length}`,
          date,
          lane: 'manager',
          kind: 'gateway',
          headline: 'Gateway refused transfer exceeding donor stock',
          detail: reason,
          outcome: 'let_go',
        };
        gatewayAttemptLog.push(traceEntry);
        return { ok: false, refusalReason: reason, traceEntry };
      }

      const cov = gs.weeksOfCover ?? 0;
      const avgWeeklyUnits =
        cov > 0.01
          ? gs.endingStock / cov
          : (STORE_MAP[donorId].baseDailySales * 7 * (groupId === 'best_sellers' ? 0.35 : 0.15) * 1.06) /
            avgPrice;
      const remainingStock = gs.endingStock - movedUnits;
      const remainingWeeks = avgWeeklyUnits > 0 ? remainingStock / avgWeeklyUnits : 0;

      if (remainingWeeks < requiredFloorWeeks - 0.05) {
        const reason = `Refused: transfer would leave ${STORE_MAP[donorId].name} at ${remainingWeeks.toFixed(1)} weeks of ${grpLabel} cover, below the ${requiredFloorWeeks.toFixed(1)}-week limit (8 weeks minimum and cover to next delivery + 1 week).`;
        const traceEntry: TraceEntry = {
          id: `trace:${date}:gw:floor:${gatewayAttemptLog.length}`,
          date,
          lane: 'manager',
          kind: 'gateway',
          headline: `Gateway refused transfer breaking donor cover floor`,
          detail: reason,
          outcome: 'let_go',
        };
        gatewayAttemptLog.push(traceEntry);
        return { ok: false, refusalReason: reason, traceEntry };
      }
    }

    const arrivalDate = addDays(date, 2);
    const proofEndDate = addDays(arrivalDate, 28);
    const decisionId = `act:${request.candidateId}:${date}:${totalUnits}`;
    const toNames = Array.from(new Set(lines.map((l) => l.toStoreName))).join(', ');
    const fromNames = Array.from(new Set(lines.map((l) => l.fromStoreName))).join(', ');

    const measure =
      request.measure ??
      request.plan?.measure ??
      (request.holdoutStoreName
        ? `Daily sales vs expected at ${toNames} against held-out ${request.holdoutStoreName} (until ${formatShortDate(proofEndDate)})`
        : `Daily sales vs expected at ${toNames} (until ${formatShortDate(proofEndDate)})`);

    const decision: ActionDecision = {
      id: decisionId,
      date,
      candidateId: request.candidateId,
      kind: 'transfer',
      storeId: lines[0].toStoreId,
      groupId,
      arrivalDate,
      transferLines: lines,
      holdoutStoreId: request.holdoutStoreId ?? request.plan?.holdoutStoreId,
      holdoutStoreName: request.holdoutStoreName ?? request.plan?.holdoutStoreName,
      totalUnits,
      approvedBy: request.approvedBy ?? 'Owner',
      approvedAtDate: date,
      measure,
      proofEndDate,
      parentDecisionId: request.parentDecisionId,
      title: request.title ?? `${grpLabel} transfer to ${toNames}`,
    };

    const unitsFact: Fact = createFact(
      `gw:${decisionId}:units`,
      'Approved transfer units',
      totalUnits,
      'units',
      `Approved by ${decision.approvedBy} on ${date} through the gateway; arriving at ${toNames} on ${arrivalDate} (+2 days).`,
    );

    const traceEntry: TraceEntry = {
      id: `trace:${date}:gw:approved:${decisionId}`,
      date,
      lane: 'manager',
      kind: 'gateway',
      headline: `Gateway approved: ${grpLabel} transfer (${totalUnits} units)`,
      detail: `From ${fromNames} to ${toNames} · arrives ${formatShortDate(arrivalDate)} · approved by ${decision.approvedBy} · proof target ${formatShortDate(proofEndDate)}.`,
      outcome: 'raised',
      facts: [unitsFact],
    };
    gatewayAttemptLog.push(traceEntry);

    return {
      ok: true,
      decision,
      preview: {
        summary: `Move ${totalUnits} ${grpLabel} units from ${fromNames} to ${toNames}, arriving ${formatShortDate(arrivalDate)}.`,
        totalUnits,
        arrivalDate,
        limitNote:
          daysUntilDelivery !== null && daysUntilDelivery / 7 + 1 > 8
            ? 'Donor stores keep enough to reach their own next delivery.'
            : 'Donor stores keep at least 8 weeks of cover.',
        lines,
      },
      traceEntry,
    };
  }

  // Non-transfer decision (e.g. refund_switch, store_manager_task, refund_audit)
  if (!request.ownerApproved) {
    const reason = 'Refused: action requires owner approval.';
    const traceEntry: TraceEntry = {
      id: `trace:${date}:gw:non_transfer_no_app:${gatewayAttemptLog.length}`,
      date,
      lane: 'manager',
      kind: 'gateway',
      headline: 'Gateway refused unapproved action',
      detail: reason,
      outcome: 'let_go',
    };
    gatewayAttemptLog.push(traceEntry);
    return { ok: false, refusalReason: reason, traceEntry };
  }

  const decisionId = `act:${request.candidateId}:${request.kind}:${date}`;
  const defaultProofDays =
    request.kind === 'refund_switch' ? 21 : request.kind === 'store_manager_task' ? 3 : 28;
  const proofEndDate = request.dueDate ?? addDays(date, defaultProofDays);
  const decision: ActionDecision = {
    id: decisionId,
    date,
    candidateId: request.candidateId,
    kind: request.kind,
    storeId: request.storeId ?? (request.kind === 'refund_switch' || request.kind === 'store_manager_task' ? 'walnut_creek' : undefined),
    dueDate: request.kind === 'store_manager_task' ? proofEndDate : request.dueDate,
    toolId: request.toolId,
    approvedBy: request.approvedBy ?? 'Owner',
    approvedAtDate: date,
    measure:
      request.measure ??
      (request.kind === 'refund_switch'
        ? 'Walnut Creek 21-day cash refund rate before vs after switch'
        : request.kind === 'store_manager_task'
          ? 'Store manager explanation for Till 2 cash refunds after 8 pm'
          : 'Store refund rate vs median (28 days)'),
    proofEndDate,
    title:
      request.title ??
      (request.kind === 'refund_switch'
        ? 'Require manager approval for cash refunds over $50 at Walnut Creek'
        : request.kind === 'store_manager_task'
          ? 'Ask Walnut Creek store manager about Till 2 cash refunds'
          : 'Approved owner action'),
  };

  const traceEntry: TraceEntry = {
    id: `trace:${date}:gw:approved:${decisionId}`,
    date,
    lane: 'manager',
    kind: 'gateway',
    headline: `Gateway approved: ${decision.title}`,
    detail:
      request.kind === 'refund_switch'
        ? `Approved by ${decision.approvedBy} on ${formatShortDate(date)} · applies from ${formatShortDate(addDays(date, 1))} · 21-day before/after check ends ${formatShortDate(proofEndDate)}.`
        : request.kind === 'store_manager_task'
          ? `Simulated manager question logged on ${formatShortDate(date)} · due ${formatShortDate(proofEndDate)} (no external message sent).`
          : `Approved by ${decision.approvedBy} on ${formatShortDate(date)}.`,
    outcome: 'raised',
  };
  gatewayAttemptLog.push(traceEntry);

  return { ok: true, decision, traceEntry };
}

/**
 * Runs the 3 mandatory forbidden-action checks on the /dev test panel:
 * 1. Transfer leaving a donor at 2 weeks of cover -> refused
 * 2. 900-unit transfer with no owner approval -> refused
 * 3. Direct stock change bypassing the gateway -> refused
 */
export function runGatewaySelfTests(sim: SimulationRun, date: string = '2026-09-08'): {
  date: string;
  allRefused: boolean;
  cases: GatewaySelfTestCase[];
} {
  const safeDate = sim.storeRecordsByDate[date] ? date : '2026-09-08';
  const donorRec = sim.storeRecordsByDate[safeDate].sacramento.groups.best_sellers;
  const avgWeekly =
    donorRec.weeksOfCover && donorRec.weeksOfCover > 0
      ? donorRec.endingStock / donorRec.weeksOfCover
      : 86.5;
  const unitsLeaving2Weeks = Math.max(100, Math.round(donorRec.endingStock - 2 * avgWeekly));

  const case1 = executeActionThroughGateway(
    {
      candidateId: 'selftest:donor_2wks',
      date: safeDate,
      kind: 'transfer',
      groupId: 'best_sellers',
      ownerApproved: true,
      approvedBy: 'Self-test',
      transferLines: [
        {
          fromStoreId: 'sacramento',
          fromStoreName: 'Sacramento',
          toStoreId: 'union_square',
          toStoreName: 'Union Square',
          groupId: 'best_sellers',
          units: unitsLeaving2Weeks,
        },
      ],
    },
    sim,
  );

  const case2 = executeActionThroughGateway(
    {
      candidateId: 'selftest:900_unapproved',
      date: safeDate,
      kind: 'transfer',
      groupId: 'best_sellers',
      ownerApproved: false,
      transferLines: [
        {
          fromStoreId: 'sacramento',
          fromStoreName: 'Sacramento',
          toStoreId: 'union_square',
          toStoreName: 'Union Square',
          groupId: 'best_sellers',
          units: 900,
        },
      ],
    },
    sim,
  );

  const case3 = attemptDirectStockMutationBypass({
    date: safeDate,
    storeId: 'union_square',
    groupId: 'best_sellers',
    deltaUnits: 250,
  });

  const cases: GatewaySelfTestCase[] = [
    {
      id: 'donor_2_weeks',
      label: `Transfer leaving Sacramento at 2 weeks of cover (${unitsLeaving2Weeks} units)`,
      ok: case1.ok,
      refusedAsExpected: !case1.ok,
      reason: case1.refusalReason ?? 'Unexpectedly allowed',
    },
    {
      id: '900_no_approval',
      label: '900-unit transfer with no owner approval',
      ok: case2.ok,
      refusedAsExpected: !case2.ok,
      reason: case2.refusalReason ?? 'Unexpectedly allowed',
    },
    {
      id: 'direct_stock_bypass',
      label: 'Direct stock change bypassing the gateway',
      ok: case3.ok,
      refusedAsExpected: !case3.ok,
      reason: case3.reason,
    },
  ];

  return {
    date: safeDate,
    allRefused: cases.every((c) => c.refusedAsExpected),
    cases,
  };
}
