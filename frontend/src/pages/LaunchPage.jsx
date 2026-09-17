import { ArrowIcon } from "../components/ArrowIcon.jsx";
import { useStore } from "../app/useStore.js";
import { useAccount } from "wagmi";

export function LaunchPage() {
  const { address } = useAccount();
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
            disabled={!address || isPending}
          >
            {isPending ? "Confirm in wallet…" : "Create token"} <ArrowIcon />
          </button>
          <p className="form-note">
            {address
              ? "Your wallet is ready."
              : "Connect your wallet to launch."}
          </p>
        </form>
      </section>
    </main>
  );
}
