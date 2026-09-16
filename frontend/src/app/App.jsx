import { useEffect, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useConnect, useWriteContract } from "wagmi";
import { Footer, Header } from "../components/Navigation.jsx";
import {
  apiUrl,
  contractAbi,
  launchpadAddress,
  publicClient,
} from "../lib/web3.js";
import { HomePage } from "../pages/HomePage.jsx";
import { LaunchPage } from "../pages/LaunchPage.jsx";
import { MarketPage } from "../pages/MarketPage.jsx";
import { MarketsPage } from "../pages/MarketsPage.jsx";
import { NotFoundPage } from "../pages/NotFoundPage.jsx";
import { useRouter } from "./useRouter.js";

export function App() {
  const { navigate, route } = useRouter();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [actionError, setActionError] = useState("");
  const [amount, setAmount] = useState("1");
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { writeContractAsync, isPending } = useWriteContract();

  useEffect(() => {
    fetch(`${apiUrl}/tokens`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setTokens)
      .catch(() =>
        setMarketError(
          "Markets are taking a breather. Check the API and try again.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function createToken(event) {
    event.preventDefault();
    setActionError("");
    try {
      if (!launchpadAddress)
        throw Error("Set VITE_LAUNCHPAD_ADDRESS to launch a token.");
      const form = new FormData(event.currentTarget);
      await writeContractAsync({
        address: launchpadAddress,
        abi: contractAbi,
        functionName: "createToken",
        args: [form.get("name"), form.get("symbol"), form.get("uri")],
      });
    } catch (error) {
      setActionError(error.message || "Token creation failed");
    }
  }

  async function trade(side, token) {
    setActionError("");
    try {
      if (!launchpadAddress || !token)
        throw Error("Select a market and configure the launchpad.");
      const input = parseEther(amount);
      const output = await publicClient.readContract({
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [token.address, input],
      });
      await writeContractAsync({
        address: launchpadAddress,
        abi: contractAbi,
        functionName: side === "buy" ? "buyTokens" : "sellTokens",
        args: [token.address, input, (output * 97n) / 100n],
      });
    } catch (error) {
      setActionError(error.message || "Trade failed");
    }
  }

  const token =
    route.id === "market"
      ? tokens.find(
          (item) =>
            item.address.toLowerCase() === route.params.address.toLowerCase(),
        )
      : undefined;

  let page;
  switch (route.id) {
    case "home":
      page = <HomePage navigate={navigate} />;
      break;
    case "markets":
      page = (
        <MarketsPage
          navigate={navigate}
          tokens={tokens}
          loading={loading}
          error={marketError}
        />
      );
      break;
    case "market":
      page = (
        <MarketPage
          navigate={navigate}
          token={token}
          loading={loading}
          error={actionError || marketError}
          address={address}
          amount={amount}
          setAmount={setAmount}
          trade={trade}
          isPending={isPending}
        />
      );
      break;
    case "launch":
      page = (
        <LaunchPage
          address={address}
          create={createToken}
          isPending={isPending}
          error={actionError}
        />
      );
      break;
    default:
      page = <NotFoundPage navigate={navigate} />;
  }

  return (
    <div className="site-shell">
      <Header
        address={address}
        connectWallet={() => connect({ connector: connectors[0] })}
        navigate={navigate}
        routeId={route.id}
      />
      {page}
      <Footer navigate={navigate} />
    </div>
  );
}
