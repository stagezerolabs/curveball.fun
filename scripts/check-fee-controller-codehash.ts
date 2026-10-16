import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { FEE_CONTROLLER_CODE_HASH, V21_FEE_CONTROLLER_CODE_HASH } from "../src/lib/feeControllerCodeHash";

// Live controller code hashes stay pinned in the UI. Recompiling against the
// changed factory updates Solidity metadata, so source builds have separate pins.
const CURRENT_SOURCE_CODE_HASH = "0x331c2fc46d4ef192ee924eeee8bdf903caacdabc3a256ebe55bf6d8d665616cf";
const CURRENT_SOURCE_V21_CODE_HASH = "0x5e4551db39d24b670ac1f67ce98291019e5c4bb67b2b3e5ce1537e9e6d4aed0f";
const factories = [
  ["0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056", CURRENT_SOURCE_CODE_HASH],
  ["0x6c12CCE962944EbB6A28536eD23baeFAa15c79cD", CURRENT_SOURCE_V21_CODE_HASH],
] as const;
const artifact = JSON.parse(readFileSync(new URL("../contracts/out/CurveFactoryFeeController.sol/CurveFactoryFeeController.json", import.meta.url), "utf8"));
for (const [factory, expected] of factories) {
  let bytecode = (artifact.deployedBytecode.object as string).slice(2);
  const paddedFactory = factory.slice(2).toLowerCase().padStart(64, "0");
  for (const references of Object.values(artifact.deployedBytecode.immutableReferences) as Array<Array<{ start: number; length: number }>>) {
    for (const { start, length } of references) {
      if (length !== 32) throw new Error(`Unexpected immutable length: ${length}`);
      const offset = start * 2;
      bytecode = bytecode.slice(0, offset) + paddedFactory + bytecode.slice(offset + 64);
    }
  }
  const actual = keccak256(`0x${bytecode}` as Hex);
  if (actual !== expected) throw new Error(`Fee controller source-build hash changed for ${factory}: ${actual}. Review before updating the pin.`);
}
console.log(`CurveFactoryFeeController reviewed hashes: V2 ${FEE_CONTROLLER_CODE_HASH}; V2.1 ${V21_FEE_CONTROLLER_CODE_HASH}`);
