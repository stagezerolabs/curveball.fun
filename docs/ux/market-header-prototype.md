# Market header prototype

The header answers three questions in order: which token is this, what does it cost now, and how close is its curve to graduation? The token name and live state anchor the left side. Price is the first metric on the right; market cap is secondary; curve sold uses a measured bar rather than a bare percentage.

```text
[avatar] AURA  $FARM  live        PRICE           MARKET CAP
         FARM / WETH             $0.0257         $25.7K
         Fee 0.50% · Tax 0.50%   0.0000104 WETH   CURVE SOLD
         CA · Creator · Launched                  2.4%  ▰────────
```

Desktop gives price its own column and stacks market cap with curve progress beside it. Typography and spacing group the data without metric boxes or borders. Static lime is reserved for the live state and measured progress; it does not animate. At tablet widths, stats move below identity. At phone widths, price occupies the first metric row, market cap and progress share the second, and chain metadata follows the metrics. All values retain their existing onchain sources.
