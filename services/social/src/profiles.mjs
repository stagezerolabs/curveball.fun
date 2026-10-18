// A verified sign-in is the claim: create the profile row once and never overwrite saved details.
export async function claimProfile(db, chainId, address) {
  await db.query("INSERT INTO profiles (chain_id, address) VALUES ($1, $2) ON CONFLICT (chain_id, address) DO NOTHING", [chainId, address]);
}
