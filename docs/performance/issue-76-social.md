# Issue 76 social read measurements

Measured with PostgreSQL 17 in a temporary local Docker container. The migrated schema held 200,000 canonical trades over 48 hours, 500 markets, 1,000 trader profiles, 400 performance snapshots, 100 wallets followed by the viewer, and 10,000 inbox rows for one recipient. `EXPLAIN (ANALYZE, BUFFERS)` used the production query shape; these timings describe this synthetic dataset and machine, not production latency.

| Read | Execution time | Database work |
| --- | ---: | --- |
| Following buys, 1h | 20 ms | Trader/time index scans; no full trade scan |
| Following buys, 24h | 352 ms | 3,415 shared buffers; approximately 5 MB temporary sort spill |
| Inbox first page, 21 rows | <1 ms | 9 shared buffers; recipient index scan |
| Inbox unread count, 10,000 rows | 1.8 ms | 228 shared buffers |
| Profile name search, first 25 rows | 0.4 ms | 23 shared buffers |
| Provisional leaderboard, 400 candidates | 19–109 ms | Up to 14,755 shared buffers; category-dependent |

Following qualifies each followed trader/market pair when its latest canonical trade in the chosen window is a buy, then sums that pair's buy volume in the window. The existing `trades_trader_idx` was used; there was no full trade-table scan. The 24h sort spill, per-viewer work, and provisional leaderboard candidate scans are the main scaling risks. Re-measure against production-like follow counts and trade rates before raising concurrency targets; add an index or persisted rollup only if those measurements justify it. No cross-request cache was added because follow, block, and opt-out changes must take effect promptly across API replicas.

Transactional SQL checks also confirmed that a buy followed by a sell yields no Following card; a later buy restores the card with 150 units of buy volume from the two buys in the window. Turning off discoverability for all followed profiles yielded zero cards, even while their follow rows still existed inside the transaction.
