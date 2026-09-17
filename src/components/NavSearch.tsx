import { useEffect, useMemo, useRef, useState } from "react";
import { TokenAvatar } from "./TokenAvatar";
import { useStore } from "../app/useStore.js";
import { formatEthAmount } from "../lib/format.js";
import type { KeyboardEvent } from "react";
import type { Navigate, Token } from "../types";

const MAX_RESULTS = 8;

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="M13.5 13.5 17 17" />
    </svg>
  );
}

export function NavSearch({ navigate }: { navigate: Navigate }) {
  const { tokens, loading } = useStore() as {
    tokens: Token[];
    loading: boolean;
  };
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Under 640px the field is collapsed behind an icon; `expanded` reveals it.
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return tokens
      .filter((token) =>
        `${token.name} ${token.symbol} ${token.address}`
          .toLowerCase()
          .includes(needle),
      )
      .sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1))
      .slice(0, MAX_RESULTS);
  }, [tokens, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setExpanded(true);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open && !expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setExpanded(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, expanded]);

  function dismiss() {
    setOpen(false);
    setExpanded(false);
    inputRef.current?.blur();
  }

  function select(token: Token) {
    setQuery("");
    dismiss();
    navigate("market", { address: token.address });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      dismiss();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(results[active]);
    }
  }

  const showPanel = open && query.trim().length > 0;

  return (
    <div className="nav-search" ref={rootRef} data-open={String(expanded)}>
      <button
        className="nav-search-toggle"
        type="button"
        aria-label="Search tokens"
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
      >
        <SearchIcon />
      </button>
      <div className="nav-search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search tokens"
          aria-autocomplete="list"
          aria-expanded={showPanel}
          aria-controls="nav-search-results"
          aria-activedescendant={
            showPanel && results.length ? `nav-result-${active}` : undefined
          }
          autoComplete="off"
          placeholder="Search tokens"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">⌘K</kbd>
      </div>

      {showPanel && (
        <div className="nav-results" id="nav-search-results">
          {loading && !tokens.length ? (
            <p className="nav-empty">Loading markets…</p>
          ) : results.length ? (
            <ul role="listbox" aria-label="Token results">
              {results.map((token, index) => (
                <li key={token.address} role="none">
                  <button
                    className="nav-result"
                    type="button"
                    id={`nav-result-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => select(token)}
                  >
                    <TokenAvatar token={token} index={index} />
                    <span className="nav-result-name">{token.name}</span>
                    <span className="nav-result-symbol">${token.symbol}</span>
                    <span className="nav-result-cap">
                      {formatEthAmount(token.marketCap)} ETH
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="nav-empty">
              No tokens match “{query.trim()}”.{" "}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  dismiss();
                  navigate("launch");
                }}
              >
                Launch one
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
