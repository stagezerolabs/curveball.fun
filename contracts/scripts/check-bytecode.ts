const contracts: Record<string, string> = {
  CurveLaunchFactory: "CurveLaunchFactory",
  CurveLaunchDeployer: "CurveLaunchDeployer",
  CurveLauncherToken: "CurveLauncherToken",
  CurveBondingCurve: "CurveBondingCurve",
  CurveFeeEscrow: "CurveFeeEscrow",
  CurveBuybackVault: "CurveBuybackVault",
  CurveGraduationGuard: "CurveGraduationGuard",
  CurveGraduationExecutor: "CurveGraduationExecutor",
  CurveMemeHook: "CurveMemeHook",
  CurveLaunchAndBuy: "CurveLaunchAndBuy",
  CurveLpLocker: "LpLocker",
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
