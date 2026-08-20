# D1 to Supabase Data Migration Plan

Do not delete or detach the existing production D1 database until this export is complete and verified.

1. Export every D1 table to JSON or CSV: `sessions`, `person_profiles`, `email_subscriptions`, `moments`, `moment_access_tokens`, `attempts`, `retrieval_deliveries`, `retrieval_variations`, `feedback`, and `analytics_events`.
2. Apply `supabase/202607280001_outloud_supabase_production.sql` to the target Supabase project.
3. Load parent tables first: `sessions`, `email_subscriptions`, then `person_profiles`.
4. Load `moments` next, converting D1 integer booleans to booleans and JSON-as-TEXT columns to `jsonb`.
5. Load dependent tables: `moment_access_tokens`, `attempts`, `retrieval_deliveries`, `retrieval_variations`, `feedback`, and `analytics_events`.
6. Verify counts by table, verify unique indexes, then spot-check private review access with a known token hash.
7. Run one retrieval dry run against a scratch Supabase project before pointing production env vars at Supabase.

No destructive production step should run until row counts, token validation, retrieval idempotency, and feedback insertion are verified.
