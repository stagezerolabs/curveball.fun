import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { FEE_CONTROLLER_CODE_HASH, V21_FEE_CONTROLLER_CODE_HASH } from "../src/lib/feeControllerCodeHash";

// The old controller remains deployed with FEE_CONTROLLER_CODE_HASH. Recompiling
// against the reserve-enabled factory changes Solidity's metadata hash, so the
// current source build has its own pin while the live code pin stays unchanged.
const CURRENT_SOURCE_CODE_HASH = "0x52f788e87cd2dad777103fd066cf66569f571fbfd1cd899cfd92aa183e8ff597";
const factories = [
  ["0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056", CURRENT_SOURCE_CODE_HASH],
  ["0x6c12CCE962944EbB6A28536eD23baeFAa15c79cD", V21_FEE_CONTROLLER_CODE_HASH],
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
