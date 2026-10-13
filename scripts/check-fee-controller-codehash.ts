import { readFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import { FEE_CONTROLLER_CODE_HASH } from "../src/lib/feeControllerCodeHash";

const factory = "0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056";
const artifact = JSON.parse(readFileSync(new URL("../contracts/out/CurveFactoryFeeController.sol/CurveFactoryFeeController.json", import.meta.url), "utf8"));
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
if (actual !== FEE_CONTROLLER_CODE_HASH) {
  throw new Error(`Fee controller runtime hash changed: ${actual}. Review the contract before updating the pinned hash.`);
}
console.log(`CurveFactoryFeeController runtime hash: ${actual}`);
