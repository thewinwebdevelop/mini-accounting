# Supabase regression tests

These tests run the application against a real, isolated local Supabase instance. LINE, Shopee, and Google are simulated upstream services; no orders are shipped and no external messages or documents are sent.

Requirements: Node 22+, Docker, Supabase CLI, installed Playwright Chromium, and the Python dependencies used by the application.

1. Create a separate Supabase CLI project outside the application data directory and copy `supabase/migrations/*.sql` into it.
2. Start that project with `supabase start --workdir <isolated-project>`. Use unused ports if another local stack is running.
3. Save its local connection configuration without printing keys:
   ```sh
   supabase status --workdir <isolated-project> -o json > /tmp/sweet-house-e2e-status.json
   ```
4. Run:
   ```sh
   E2E_SUPABASE_CONFIG=/tmp/sweet-house-e2e-status.json \
   SWEET_HOUSE_PYTHON_BIN=/path/to/python3 \
   npm run e2e:supabase
   ```

The fixture rejects remote Supabase URLs and inherited production credentials. Tests create unique records and track exact identities for deletion in `finally`. Cleanup deletes Storage objects and database records, then checks that they are absent. Tests that modify singleton settings require those settings to be absent in the isolated database before starting. Do not point this suite at a developer database containing real company configuration.

HTTP journeys live in `e2e/supabase/`; browser journeys live in `e2e/supabase-browser/`. Fresh application instances use empty temporary roots so SQLite or filesystem caches cannot mask persistence failures. A cleanup failure fails the test.
