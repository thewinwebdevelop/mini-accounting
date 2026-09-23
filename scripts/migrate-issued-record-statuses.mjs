#!/usr/bin/env node

import { runMigration } from "./issued-record-migration.logic.mjs";

function usageError(message) {
  process.stderr.write(`migration error: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  const valueFlags = new Set(["--root", "--at", "--report", "--reviewed-plan", "--backup-root"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply" || arg === "--dry-run") {
      flags.add(arg);
      continue;
    }
    if (!valueFlags.has(arg)) throw new Error(`unknown argument ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (values[arg]) throw new Error(`${arg} was supplied more than once`);
    values[arg] = value;
    index += 1;
  }
  if (!values["--root"]) throw new Error("--root is required");
  if (!values["--at"]) throw new Error("--at is required");
  if (flags.has("--apply") && flags.has("--dry-run")) throw new Error("--apply and --dry-run are contradictory");
  const applyOnly = ["--reviewed-plan", "--backup-root"].some((name) => values[name]);
  if (!flags.has("--apply") && applyOnly) throw new Error("--reviewed-plan and --backup-root require --apply");
  if (flags.has("--apply") && (!values["--reviewed-plan"] || !values["--backup-root"])) throw new Error("--apply requires --reviewed-plan and --backup-root");
  return { rootDir: values["--root"], at: values["--at"], reportPath: values["--report"], mode: flags.has("--apply") ? "apply" : "dry-run", reviewedPlanPath: values["--reviewed-plan"], backupRoot: values["--backup-root"] };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await runMigration(options);
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error && /^unknown argument|requires a value|was supplied more than once|--root is required|--at is required|--apply and --dry-run|--reviewed-plan and --backup-root|--apply requires/.test(error.message)
    ? error.message
    : "operational failure";
  usageError(message);
}
