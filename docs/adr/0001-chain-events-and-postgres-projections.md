# Use canonical chain events with rebuildable Postgres projections

Curveball treats finalized contract events as trading truth and projects them into Supabase Postgres for feeds, markets, charts, portfolios, and rankings. Raw occurrences retain block identity for reorg reconciliation, while performance and market tables are disposable projections that can be deterministically rebuilt instead of becoming a second source of truth.
