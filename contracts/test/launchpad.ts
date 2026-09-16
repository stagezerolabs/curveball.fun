import assert from "node:assert/strict";
import { ethers } from "hardhat";
describe("CurveballLaunchpad", () => {
  it("trades then graduates by direct pool mint", async () => {
    const [o, a] = await ethers.getSigners();
    const W = await ethers.getContractFactory("MockWETH");
    const w = await W.deploy();
    const F = await ethers.getContractFactory("MockIcarusFactory");
    const f = await F.deploy();
    const L = await ethers.getContractFactory("LpLocker");
    const l = await L.deploy(o.address, 5_000);
    const P = await ethers.getContractFactory("CurveballLaunchpad");
    const p = await P.deploy(
      await w.getAddress(),
      await f.getAddress(),
      await l.getAddress(),
      1_000_000n,
      800_000n,
      10n,
    );
    await l.setLaunchpad(await p.getAddress());
    await w.mint(a.address, 100n);
    await w.connect(a).approve(await p.getAddress(), 100n);
    const receipt = await (await p.createToken("Test", "T", "ipfs://t")).wait();
    const log = receipt!.logs
      .map((x) => {
        try {
          return p.interface.parseLog(x);
        } catch {
          return null;
        }
      })
      .find(Boolean)!;
    const token = log.args.token;
    await (await p.connect(a).buyTokens(token, 100n, 1n)).wait();
    assert.equal((await p.markets(token)).graduated, true);
    const t = await ethers.getContractAt("MemeToken", token);
    await t.connect(a).transfer(o.address, 1n);
  });
  it("prevents a non-owner from binding the locker", async () => {
    const [o, a] = await ethers.getSigners();
    const L = await ethers.getContractFactory("LpLocker");
    const l = await L.deploy(o.address, 5000);
    await assert.rejects(l.connect(a).setLaunchpad(a.address));
    await l.setLaunchpad(o.address);
    await assert.rejects(l.setLaunchpad(a.address));
  });
  it("defers graduation below the pool minimum-liquidity floor", async () => {
    const [o, a] = await ethers.getSigners(),
      W = await ethers.getContractFactory("MockWETH"),
      w = await W.deploy(),
      F = await ethers.getContractFactory("MockIcarusFactory"),
      f = await F.deploy(),
      L = await ethers.getContractFactory("LpLocker"),
      l = await L.deploy(o.address, 0),
      P = await ethers.getContractFactory("CurveballLaunchpad"),
      p = await P.deploy(
        await w.getAddress(),
        await f.getAddress(),
        await l.getAddress(),
        1001n,
        800n,
        1n,
      );
    await l.setLaunchpad(await p.getAddress());
    await w.mint(a.address, 100n);
    await w.connect(a).approve(await p.getAddress(), 100n);
    const r = await (await p.createToken("Small", "S", "u")).wait(),
      token = r!.logs
        .map((x) => {
          try {
            return p.interface.parseLog(x);
          } catch {
            return null;
          }
        })
        .find(Boolean)!.args.token;
    await p.connect(a).buyTokens(token, 100n, 1n);
    assert.equal((await p.markets(token)).pending, true);
    assert.equal(1000n * 1000n, 1_000_000n);
  });
});
