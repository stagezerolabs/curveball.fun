import assert from "node:assert/strict";
import { ethers } from "hardhat";

const FACTORY = "0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615";
(process.env.RISE_RPC_URL ? describe : describe.skip)(
  "Icarus factory fork verification",
  function () {
    it("lets an arbitrary local-fork EOA create a volatile pool for two throwaway ERC20s", async function () {
      const [caller] = await ethers.getSigners();
      const Token = await ethers.getContractFactory("ThrowawayERC20");
      const a = await Token.deploy("Throwaway A", "TA");
      const b = await Token.deploy("Throwaway B", "TB");
      const factory = await ethers.getContractAt(
        [
          "function createPool(address,address,bool) returns (address)",
          "function getPool(address,address,bool) view returns (address)",
          "function isPool(address) view returns (bool)",
        ],
        FACTORY,
        caller,
      );
      await (
        await factory.createPool(
          await a.getAddress(),
          await b.getAddress(),
          false,
        )
      ).wait();
      const pool = await factory.getPool(
        await a.getAddress(),
        await b.getAddress(),
        false,
      );
      assert.equal(await factory.isPool(pool), true);
    });
  },
);
