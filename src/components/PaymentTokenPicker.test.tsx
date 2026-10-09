import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { filterPaymentTokens, PaymentTokenPicker, type PaymentTokenOption } from "./PaymentTokenPicker";

const options: PaymentTokenOption[] = [
  { value: "WETH", symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006" },
  { value: "ASD", symbol: "ASD", name: "ASD test token", address: "0x1234567890123456789012345678901234567890" },
  { value: "USDC", symbol: "USDC", name: "USD Coin", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
];

test("payment selector shows the selected token and its custom mark", () => {
  const html = renderToStaticMarkup(<PaymentTokenPicker value="WETH" options={options} onChange={() => undefined} />);
  expect(html).toContain("Pay with");
  expect(html).toContain("Select a token");
  expect(html).toContain('payment-token-mark weth');
  expect(html).toContain("WETH");
});

test("search matches token name, symbol, and address across any option list", () => {
  expect(filterPaymentTokens(options, "ether").map((option) => option.symbol)).toEqual(["WETH"]);
  expect(filterPaymentTokens(options, "asd").map((option) => option.symbol)).toEqual(["ASD"]);
  expect(filterPaymentTokens(options, "0x4200").map((option) => option.symbol)).toEqual(["WETH"]);
  expect(filterPaymentTokens(options, "usd").map((option) => option.symbol)).toEqual(["USDC"]);
  expect(filterPaymentTokens(options, "missing")).toEqual([]);
});
