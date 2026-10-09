import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { formatAddress } from "../lib/format.js";

export type PaymentTokenOption<T extends string = string> = {
  value: T;
  symbol: string;
  name: string;
  imageUrl?: string | null;
  address?: string;
};

export function filterPaymentTokens<T extends string>(options: readonly PaymentTokenOption<T>[], query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return options;
  return options.filter((option) =>
    [option.symbol, option.name, option.address].some((field) => field?.toLowerCase().includes(term)),
  );
}

function TokenMark({ symbol, imageUrl }: { symbol: string; imageUrl?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (imageUrl && imageUrl !== failedUrl) {
    return <img className="payment-token-mark" src={imageUrl} alt="" onError={() => setFailedUrl(imageUrl)} />;
  }

  if (symbol === "WETH") {
    return (
      <span className="payment-token-mark weth" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M16 3 7.5 16l8.5 5 8.5-5L16 3Z" fill="#F4F5FF" />
          <path d="M16 3v18l8.5-5L16 3Z" fill="#B8C2F0" />
          <path d="m7.5 18.2 8.5 11 8.5-11-8.5 5-8.5-5Z" fill="#F4F5FF" />
          <path d="M16 23.2v6l8.5-11-8.5 5Z" fill="#B8C2F0" />
        </svg>
      </span>
    );
  }

  return <span className="payment-token-mark token-fallback" aria-hidden="true">{symbol.slice(0, 2)}</span>;
}

export function PaymentTokenPicker<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly PaymentTokenOption<T>[];
  onChange: (token: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const visible = filterPaymentTokens(options, query);

  return (
    <div className="trade-payment">
      <span className="trade-payment-label">Pay with</span>
      <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <Dialog.Trigger className="payment-token-trigger" aria-label={`Pay with ${selected?.symbol ?? value}. Select a token`}>
          {selected && <TokenMark symbol={selected.symbol} imageUrl={selected.imageUrl} />}
          <span>{selected?.symbol ?? value}</span>
          <svg className="payment-token-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 6 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="payment-token-backdrop" />
          <Dialog.Popup className="payment-token-dialog" initialFocus={searchRef}>
            <div className="payment-token-dialog-head">
              <Dialog.Title>Select a token</Dialog.Title>
              <Dialog.Close className="payment-token-close" aria-label="Close token picker">×</Dialog.Close>
            </div>
            <div className="payment-token-search">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.75" cy="10.75" r="6.75" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search tokens" placeholder="Search tokens" autoComplete="off" />
            </div>
            <div className="payment-token-list-head">Available tokens</div>
            {visible.length ? (
              <ul className="payment-token-results" aria-label="Available payment tokens">
                {visible.map((option) => (
                  <li key={option.value}>
                    <button type="button" className="payment-token-option" aria-pressed={value === option.value} onClick={() => { onChange(option.value); setQuery(""); setOpen(false); }}>
                      <TokenMark symbol={option.symbol} imageUrl={option.imageUrl} />
                      <span className="payment-token-option-copy"><strong>{option.name}</strong><small>{option.symbol}{option.address ? ` · ${formatAddress(option.address)}` : ""}</small></span>
                      {value === option.value && <span className="payment-token-check" aria-hidden="true">✓</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="payment-token-empty" role="status">No matching tokens</p>}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
