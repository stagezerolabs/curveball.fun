import { BaseError, ContractFunctionRevertedError } from "viem";
import { launchpadAbi } from "../../../abi.mjs";
import { FAILURE_RETRY_MS } from "../../runtime/retry.mjs";
import { decide } from "./decision.mjs";

export function createGraduationActions({
  publicClient,
  walletClient,
  launchpad,
  constants,
  logger,
  now,
  send,
  retry,
}) {
  async function graduationSimulates(token) {
    try {
      await publicClient.simulateContract({
        account: walletClient.account,
        address: launchpad,
        abi: launchpadAbi,
        functionName: "graduate",
        args: [token],
      });
      return true;
    } catch (error) {
      // An RPC failure must retry; only an EVM revert can justify aborting.
      if (
        error instanceof BaseError &&
        error.walk((cause) => cause instanceof ContractFunctionRevertedError)
      )
        return false;
      throw error;
    }
  }

  async function act(key, token, status) {
    const nowSeconds = BigInt(Math.floor(now() / 1_000));
    const needsGraduation =
      status.state === "ready" ||
      (status.state === "aborted" && status.soldOut);
    const graduationReverts =
      needsGraduation && !(await graduationSimulates(token));
    const action = decide({
      ...status,
      nowSeconds,
      timeout: constants.timeout,
      graduationReverts,
    });

    if (action === "graduate" || action === "abort") {
      const functionName =
        action === "graduate" ? "graduate" : "abortGraduation";
      const receipt = await send(functionName, launchpad, launchpadAbi, token);
      if (receipt) {
        logger.info(
          `${action === "graduate" ? "Graduated" : "Aborted the stuck graduation of"} ${token}.`,
        );
        retry.clearBackOff(key);
      }
    } else if (needsGraduation && graduationReverts) {
      retry.backOff(key, token, "Graduation would revert", FAILURE_RETRY_MS);
    }
    return action;
  }

  return { act };
}
