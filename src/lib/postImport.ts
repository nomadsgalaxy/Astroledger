// Single post-import step every connector should call after inserting new
// transactions. Order matters: (1) apply user rules first so subsequent
// passes see rule-set isTransfer / merchant; (2) pair transfers / detect
// CC payments / generic asset-asset; (3) capture today's net-worth snapshot
// so balance changes from the new sync are recorded.

export async function postImport(): Promise<void> {
  try {
    const { applyRulesToAll } = await import('./rules');
    await applyRulesToAll({ sinceDays: 2 });
  } catch { /* swallow - rules are best-effort */ }
  try {
    // Flag obvious one-sided transfers / CC-payments mis-recorded as positive
    // income inflows (card-issuer names, "Online Transfer", credit-account
    // inflows, etc.) before pairing + snapshot. Prevents the transfer-as-income
    // bug from re-entering on any ingest path. Conservative tier on auto-ingest.
    const { classifyRecentInflows } = await import('./transferClassify');
    await classifyRecentInflows({ sinceDays: 35 });
  } catch { /* swallow */ }
  try {
    const { pairCrossAccountTransfers } = await import('./transferPairing');
    await pairCrossAccountTransfers({ rangeDays: 3 });
  } catch { /* swallow */ }
  try {
    const { captureNetWorthSnapshot } = await import('./netWorthSnapshot');
    await captureNetWorthSnapshot();
  } catch { /* swallow */ }
}
