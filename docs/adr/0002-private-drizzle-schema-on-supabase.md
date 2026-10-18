# Keep application data in a private Drizzle-managed Supabase schema

Curveball owns one typed Drizzle schema in the shared `@curveball/db` workspace package and applies ordered migrations through Supabase's direct connection while runtime traffic uses its pooler. Tables live under the private `curveball` Postgres schema rather than the Data API-exposed `public` schema, trading direct browser access for one enforceable backend interface and safer wallet authorization.
