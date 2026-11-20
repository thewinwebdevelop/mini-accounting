"use strict";

const {
  DatabaseSync
} = require('node:sqlite');
const {
  mkdirSync
} = require('node:fs');
const path = require('node:path');
const {isCloudRunEnvironment}=require('./cloud-run.logic.js');
const {
  transition,
  bindStore
} = require('./line-workflow-state.logic.js');
const {
  createSupabaseAdminClient,
  supabaseRequest
} = require('./supabase.logic.js');
function createLocalLineWorkflowStore({
  rootDir
}) {
  const file = path.join(rootDir, 'data', 'line-workflow.sqlite');
  mkdirSync(path.dirname(file), {
    recursive: true
  });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workflow_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); INSERT OR IGNORE INTO workflow_state VALUES(1,'{}');");
  const store = bindStore((method, args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = JSON.parse(db.prepare('SELECT data FROM workflow_state WHERE id=1').get().data);
      const result = transition(state, method, args);
      db.prepare('UPDATE workflow_state SET data=? WHERE id=1').run(JSON.stringify(state));
      db.exec('COMMIT');
      return structuredClone(result);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
  return {
    ...store,
    close: () => db.close()
  };
}
function createSupabaseLineWorkflowStore({
  client = createSupabaseAdminClient()
} = {}) {
  return bindStore(async (method, args) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const rows = await supabaseRequest(client, '/rest/v1/line_workflow_state?id=eq.1&select=version,data');
      const row = rows[0];
      if (!row) throw new Error('Apply LINE workflow migration first');
      const state = structuredClone(row.data);
      const result = transition(state, method, args);
      const changed = await supabaseRequest(client, '/rest/v1/rpc/line_workflow_state_cas', {
        method: 'POST',
        body: {
          expected_version: row.version,
          next_data: state
        }
      });
      if (changed) return structuredClone(result);
    }
    throw Object.assign(new Error('Workflow state busy; retry'), {
      statusCode: 409
    });
  });
}
function createLineWorkflowStore({
  rootDir,
  env = process.env
}) {
  return isCloudRunEnvironment(env) ? createSupabaseLineWorkflowStore({
    client: createSupabaseAdminClient({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
    })
  }) : createLocalLineWorkflowStore({
    rootDir
  });
}
module.exports = {
  createLocalLineWorkflowStore,
  createSupabaseLineWorkflowStore,
  createLineWorkflowStore
};
