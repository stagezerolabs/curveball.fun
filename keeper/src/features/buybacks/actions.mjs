import { decodeEventLog, zeroAddress } from "viem";
import { buybackAbi } from "../../../abi.mjs";
import { captureKeeperException } from "../../runtime/instrument.mjs";
import { FAILURE_RETRY_MS } from "../../runtime/retry.mjs";

const SKIP_REASONS = [
  "too few observations",
  "quote failed",
  "Icarus paused",
  "price outside the band",
];
const CURVE_BUYBACK_KEY = "curve-buyback";
const SKIPPED_BUYBACK_RETRY_MS = 3_600_000;

export function createBuybackActions({
  publicClient,
  walletClient,
  constants,
  logger,
  now,
  send,
  retry,
}) {
  function skipReason(receipt) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== constants.buybackTreasury.toLowerCase())
        continue;
      try {
        const event = decodeEventLog({
          abi: buybackAbi,
          data: log.data,
          topics: log.topics,
          strict: true,
        });
        if (event.eventName === "SwapSkipped")
          return (
            SKIP_REASONS[event.args.reason] ?? `reason ${event.args.reason}`
          );
      } catch {
        /* Another treasury event. */
      }
    }
    return null;
  }

  async function convertMarket(key, token) {
    const receipt = await send(
      "convert",
      constants.buybackTreasury,
      buybackAbi,
      token,
    );
    if (!receipt) return;
    const skipped = skipReason(receipt);
    // A skipped conversion spends nothing, so retry after one hour.
    if (skipped)
      retry.backOff(
        key,
        token,
        `Buyback skipped (${skipped})`,
        SKIPPED_BUYBACK_RETRY_MS,
      );
    else retry.clearBackOff(key);
  }

  async function runCurveBuyback() {
    try {
      const [target, budget, last] = await Promise.all([
        publicClient.readContract({
          address: constants.buybackTreasury,
          abi: buybackAbi,
          functionName: "curveToken",
        }),
        publicClient.readContract({
          address: constants.buybackTreasury,
          abi: buybackAbi,
          functionName: "quoteBudget",
        }),
        publicClient.readContract({
          address: constants.buybackTreasury,
          abi: buybackAbi,
          functionName: "lastBuyback",
        }),
      ]);
      const ownerCanTrigger =
        constants.buybackOwner?.toLowerCase() ===
        walletClient.account.address.toLowerCase();
      const ready =
        target !== zeroAddress &&
        budget > 0n &&
        (ownerCanTrigger ||
          BigInt(Math.floor(now() / 1_000)) >= last + constants.staleness);
      if (ready && retry.canAttempt(CURVE_BUYBACK_KEY)) {
        const receipt = await send(
          "buyback",
          constants.buybackTreasury,
          buybackAbi,
          null,
        );
        if (receipt) {
          const skipped = skipReason(receipt);
          if (skipped)
            retry.backOff(
              CURVE_BUYBACK_KEY,
              target,
              `Buyback skipped (${skipped})`,
              SKIPPED_BUYBACK_RETRY_MS,
            );
          else retry.clearBackOff(CURVE_BUYBACK_KEY);
        }
      }
    } catch (error) {
      captureKeeperException(error, "curve-buyback");
      logger.error(
        `CURVE buyback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      retry.backOff(
        CURVE_BUYBACK_KEY,
        "CURVE",
        "Buyback failed",
        FAILURE_RETRY_MS,
      );
    }
  }

  return { convertMarket, runCurveBuyback };
}
