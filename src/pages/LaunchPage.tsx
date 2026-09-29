import { ArrowIcon } from "../components/ArrowIcon";
import { useStore } from "../app/useStore.js";
import { useAccount, useReadContract } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import { activeChainId, launchpadAddress } from "../lib/web3";

export function LaunchPage() {
  const { address } = useAccount();
  const { data: publicOpen } = useReadContract({
    address: launchpadAddress ?? undefined, abi: launchpadAbi,
    functionName: "publicLaunchOpen", chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress) && activeChainId !== RISE_TESTNET_CHAIN_ID },
  });
  const { data: invited } = useReadContract({
    address: launchpadAddress ?? undefined, abi: launchpadAbi,
    functionName: "invited", args: [address!], chainId: activeChainId,
    query: { enabled: Boolean(address && launchpadAddress) && activeChainId !== RISE_TESTNET_CHAIN_ID },
  });
  const canCreate = activeChainId === RISE_TESTNET_CHAIN_ID || publicOpen === true || invited === true;
  const { createToken: create, isPending, actionError: error } = useStore();

  return (
    <main className="launch-page">
      <section className="wrap launch-layout">
        <div className="launch-copy">
          <div className="eyebrow light">
            <span /> Create
          </div>
          <h1>
            Your idea.
            <br />
            One honest curve.
          </h1>
          <p>
            No presale maze, no hidden allocation. Name it, launch it, and let
            the market decide what happens next.
          </p>
          <ol>
            <li>
              <span>01</span> Create your token
            </li>
            <li>
              <span>02</span> Build the curve
            </li>
            <li>
              <span>03</span> Graduate to liquidity
            </li>
          </ol>
        </div>
        <form className="launch-form" onSubmit={create}>
          <div className="form-heading">
            <span>New launch</span>
            <strong>It starts here.</strong>
          </div>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          {!canCreate && address && <p className="notice" role="status">Limited beta: this wallet needs an invitation to create a token.</p>}
          <label>
            Token name
            <input
              name="name"
              required
              placeholder="e.g. Curveball"
              autoComplete="off"
            />
          </label>
          <label>
            Symbol
            <span className="symbol-input">
              <i>$</i>
              <input
                name="symbol"
                required
                placeholder="CURVE"
                autoComplete="off"
              />
            </span>
          </label>
          <label>
            Metadata URI <small>Optional</small>
            <input name="uri" type="url" placeholder="https://…" />
          </label>
          <button
            className="launch-button"
            type="submit"
            disabled={!address || isPending || !canCreate}
          >
            {isPending ? "Confirm in wallet…" : "Create token"} <ArrowIcon />
          </button>
          <p className="form-note">
            {address
              ? canCreate ? "Your wallet is ready." : "Ask the beta owner for an invitation."
              : "Connect your wallet to launch."}
          </p>
        </form>
      </section>
    </main>
  );
}
