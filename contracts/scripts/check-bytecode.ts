const contracts: Record<string, string> = {
  CurveV1Factory: "CurveV1Factory",
  CurveLaunchDeployer: "CurveLaunchDeployer",
  CurveLauncherToken: "CurveLauncherToken",
  CurveBondingCurve: "CurveBondingCurve",
  CurveFeeEscrow: "CurveFeeEscrow",
  CurveBuybackVault: "CurveBuybackVault",
  CurveMemeHook: "CurveMemeHook",
  CurveLaunchAndBuy: "CurveLaunchAndBuy",
  CurveHolderReserve: "CurveHolderReserve",
  CurveV1Locker: "CurveV1Locker",
  CurveV1PoolAdapter: "CurveV1PoolAdapter",
};

for (const [name, source] of Object.entries(contracts)) {
  const artifact = await Bun.file(`out/${source}.sol/${name}.json`).json();
  const creation = (artifact.bytecode.object.length - 2) / 2;
  const runtime = (artifact.deployedBytecode.object.length - 2) / 2;
  if (creation > 49_152 || runtime > 24_576) {
    throw new Error(`${name} exceeds chain bytecode limit: creation ${creation}, runtime ${runtime}`);
  }
  console.log(`${name}: creation ${creation}, runtime ${runtime}`);
}
