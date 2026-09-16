import { ethers } from "hardhat";
async function main() {
  const [owner] = await ethers.getSigners();
  const W = await ethers.getContractFactory("MockWETH");
  const quote = await W.deploy();
  const F = await ethers.getContractFactory("MockIcarusFactory");
  const factory = await F.deploy();
  const L = await ethers.getContractFactory("LpLocker");
  const locker = await L.deploy(owner.address, 5_000);
  const P = await ethers.getContractFactory("CurveballLaunchpad");
  const launchpad = await P.deploy(
    await quote.getAddress(),
    await factory.getAddress(),
    await locker.getAddress(),
    1_000_000n * 10n ** 18n,
    800_000n * 10n ** 18n,
    10n * 10n ** 18n,
  );
  await locker.setLaunchpad(await launchpad.getAddress());
  console.log(
    JSON.stringify({
      quote: await quote.getAddress(),
      factory: await factory.getAddress(),
      locker: await locker.getAddress(),
      launchpad: await launchpad.getAddress(),
    }),
  );
}
void main();
