import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/supabase-browser',
  workers: 1,
  timeout: 60000,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
