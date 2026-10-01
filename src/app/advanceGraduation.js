export async function advanceGraduationMessage(sdk, token) {
  if (token.pending) {
    await sdk.createGraduatedPool(token.address);
    return "Icarus pool created.";
  }
  const result = await sdk.graduate(token.address);
  return result.deferred
    ? "Graduation deferred: Icarus is unavailable or the pool is not ready. Trading remains open; try again later."
    : "Graduation prepared. The pool can now be created.";
}
