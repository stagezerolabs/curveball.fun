// A verified sign-in is the claim: it records that the wallet trades on Curveball.
// Names come from RNS and there are no profile fields to edit, so never overwrite a saved row.
export async function claimProfile(db, chainId, address) {
  await db.query(
    "INSERT INTO profiles (chain_id, address) VALUES ($1, $2) ON CONFLICT (chain_id, address) DO NOTHING",
    [chainId, address],
  );
}
