import { addDays, diffDays, formatShortDate } from '../engine/calendar';
import { createFact } from '../engine/facts';
import { SimulationRun } from '../engine/simulation';
import { STORE_MAP, STORES } from '../engine/stores';
import { Fact, StoreId, TransferLine, TransferPlan } from '../types/domain';

export function buildTransferPlanForGroup(params: {
  sim: SimulationRun;
  date: string;
  groupId: 'best_sellers' | 'knitwear';
  controlStores?: Set<string>;
  explicitReceivers?: StoreId[];
  disableHoldout?: boolean;
}): { plan: TransferPlan; facts: Fact[] } {
  const { sim, date, groupId, controlStores = new Set(), explicitReceivers, disableHoldout } = params;
  const grpName = groupId === 'best_sellers' ? 'Best-sellers' : 'Knitwear';
  const avgPrice = groupId === 'best_sellers' ? 120 : 90;
  const recs = sim.storeRecordsByDate[date];

  const nextDel = sim.scheduledDeliveries
    .filter((d) => d.groupId === groupId && d.date > date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const daysUntilDelivery = nextDel ? Math.max(1, diffDays(date, nextDel.date)) : null;

  const avgWeeklyForStore = (storeId: StoreId): number => {
    const gs = recs[storeId].groups[groupId];
    const cov = gs.weeksOfCover ?? 0;
    if (cov > 0.01) return gs.endingStock / cov;
    const store = STORE_MAP[storeId];
    const grpShare = groupId === 'best_sellers' ? 0.35 : 0.15;
    return (store.baseDailySales * 7 * grpShare * 1.06) / avgPrice;
  };

  // Identify receivers: stores currently < 2.5 wks OR projected to drop < 2.5 wks within 7 days
  let receiverIds: StoreId[];
  if (explicitReceivers && explicitReceivers.length > 0) {
    receiverIds = explicitReceivers.filter((sid) => recs[sid]?.isOpen);
  } else {
    receiverIds = STORES.filter((st) => {
      if (!recs[st.id]?.isOpen) return false;
      if (controlStores.has(st.id)) return false;
      if (sim.isDeliveryDueWithinDays(st.id, groupId, date, 14)) return false;
      const gs = recs[st.id].groups[groupId];
      if (gs.weeksOfCover === null) return false;
      const avgWeekly = avgWeeklyForStore(st.id);
      const projectedIn7d = avgWeekly > 0 ? (gs.endingStock - avgWeekly) / avgWeekly : gs.weeksOfCover;
      return gs.weeksOfCover < 2.5 || projectedIn7d < 2.5;
    }).map((s) => s.id);
  }

  // Hold-out rule: when >= 3 stores need the same transfer, hold out smallest-sales store as control
  let holdoutStoreId: StoreId | undefined;
  let treatedStoreIds = [...receiverIds];
  if (!disableHoldout && receiverIds.length >= 3) {
    const sortedBySalesAsc = [...receiverIds].sort(
      (a, b) => STORE_MAP[a].baseDailySales - STORE_MAP[b].baseDailySales,
    );
    holdoutStoreId = sortedBySalesAsc[0];
    treatedStoreIds = receiverIds.filter((id) => id !== holdoutStoreId);
  }

  const receiverSet = new Set<StoreId>(receiverIds);
  const deliveryPlusOneWeeks = daysUntilDelivery !== null ? daysUntilDelivery / 7 + 1 : 0;
  const donorFloorWeeks = Math.max(8, deliveryPlusOneWeeks);
  const targetWeeks = daysUntilDelivery !== null ? daysUntilDelivery / 7 + 0.25 : 6;

  // Donors ordered by highest cover first
  const donors = STORES.filter((st) => {
    if (!recs[st.id]?.isOpen) return false;
    if (receiverSet.has(st.id)) return false;
    if (controlStores.has(st.id)) return false;
    const gs = recs[st.id].groups[groupId];
    const avgWeekly = avgWeeklyForStore(st.id);
    const spare = gs.endingStock - donorFloorWeeks * avgWeekly;
    return spare >= 10;
  })
    .map((st) => {
      const gs = recs[st.id].groups[groupId];
      const avgWeekly = avgWeeklyForStore(st.id);
      const spare = Math.max(0, Math.floor(gs.endingStock - donorFloorWeeks * avgWeekly));
      return {
        storeId: st.id,
        storeName: st.name,
        cover: gs.weeksOfCover ?? 0,
        spare,
      };
    })
    .sort((a, b) => b.cover - a.cover);

  // Compute need per treated store
  const needs = treatedStoreIds.map((sid) => {
    const gs = recs[sid].groups[groupId];
    const avgWeekly = avgWeeklyForStore(sid);
    const needed = Math.max(0, Math.ceil(targetWeeks * avgWeekly - gs.endingStock));
    return {
      storeId: sid,
      storeName: STORE_MAP[sid].name,
      needed,
      weeklyDemandUsd: gs.potentialSales * 7,
    };
  });

  const transferLines: TransferLine[] = [];
  let donorIdx = 0;
  let totalShortfall = 0;

  for (const n of needs) {
    let remaining = n.needed;
    while (remaining > 0 && donorIdx < donors.length) {
      const d = donors[donorIdx];
      if (d.spare <= 0) {
        donorIdx++;
        continue;
      }
      const move = Math.min(remaining, d.spare);
      if (move > 0) {
        transferLines.push({
          fromStoreId: d.storeId,
          fromStoreName: d.storeName,
          toStoreId: n.storeId,
          toStoreName: n.storeName,
          groupId,
          units: move,
        });
        d.spare -= move;
        remaining -= move;
      }
      if (d.spare <= 0) donorIdx++;
    }
    if (remaining > 0) {
      totalShortfall += remaining;
    }
  }

  const totalUnits = transferLines.reduce((s, l) => s + l.units, 0);
  const totalNeeded = needs.reduce((s, n) => s + n.needed, 0);
  const coverageRatio = totalNeeded > 0 ? Math.min(1, totalUnits / totalNeeded) : 0;
  const weeklyDemandTreatedUsd = needs.reduce((s, n) => s + n.weeklyDemandUsd, 0);
  const weeklyRecoveryUsd = weeklyDemandTreatedUsd * coverageRatio;

  const arrivalDate = addDays(date, 2);
  const proofEndDate = addDays(arrivalDate, 28);

  const holdoutStoreName = holdoutStoreId ? STORE_MAP[holdoutStoreId].name : undefined;
  const holdoutSentence = holdoutStoreName
    ? `${holdoutStoreName} is held out so the result can be proven.`
    : undefined;
  const limitSentence =
    daysUntilDelivery !== null && daysUntilDelivery / 7 + 1 > 8
      ? 'Donor stores keep enough to reach their own next delivery.'
      : 'Donor stores keep at least 8 weeks of cover.';

  const treatedNames = treatedStoreIds.map((id) => STORE_MAP[id].name).join(', ') || 'affected stores';
  const measure = holdoutStoreName
    ? `Daily sales vs expected at ${treatedNames} against held-out ${holdoutStoreName} (until ${formatShortDate(proofEndDate)})`
    : `Daily sales vs expected at ${treatedNames} (until ${formatShortDate(proofEndDate)})`;

  const totalUnitsFact = createFact(
    `plan:${groupId}:units:${date}`,
    `${grpName} transfer units`,
    totalUnits,
    'units',
    `Total ${grpName} units rebalanced from donor stores to ${treatedNames} (${totalNeeded} units needed to ${nextDel ? `reach ${nextDel.date} delivery` : 'cover 6 weeks'}).`,
  );

  const weeklyRecoveryFact = createFact(
    `plan:${groupId}:weekly_recovery:${date}`,
    'Expected weekly sales protected',
    weeklyRecoveryUsd,
    'USD',
    `Weekly ${grpName} demand across ${treatedNames} ($${Math.round(weeklyDemandTreatedUsd).toLocaleString('en-US')}/wk) scaled by transfer fill ratio (${Math.round(coverageRatio * 100)}%).`,
  );

  const facts: Fact[] = [totalUnitsFact, weeklyRecoveryFact];

  let shortfallUnitsFact: Fact | undefined;
  if (totalShortfall > 0) {
    shortfallUnitsFact = createFact(
      `plan:${groupId}:shortfall:${date}`,
      'Unmet transfer shortfall',
      totalShortfall,
      'units',
      `Units needed by ${treatedNames} that donor stores cannot supply without breaking their safety floor.`,
    );
    facts.push(shortfallUnitsFact);
  }

  return {
    plan: {
      groupId,
      groupName: grpName,
      receiverStoreIds: receiverIds,
      treatedStoreIds,
      holdoutStoreId,
      holdoutStoreName,
      holdoutSentence,
      limitSentence,
      nextDeliveryDate: nextDel?.date ?? null,
      transferLines,
      totalUnitsFact,
      shortfallUnitsFact,
      arrivalDate,
      weeklyRecoveryFact,
      measure,
      proofEndDate,
      requiresOwnerApproval: true,
    },
    facts,
  };
}
