import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { validateWorkflowEvent } from './eventSchemaRuntimeValidator';

interface ParsedArgs {
  eventPath?: string;
  schemaPath?: string;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, '');
}

function repoRoot(): string {
  return normalizeWindowsPath(path.resolve(__dirname, '..', '..'));
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--event' && argv[i + 1]) {
      parsed.eventPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--schema' && argv[i + 1]) {
      parsed.schemaPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
    }
  }

  return parsed;
}

function main() {
  // node -e forwarding on Windows may place the first custom flag at argv[1].
  const args = parseArgs(process.argv.slice(1));

  if (!args.eventPath) {
    console.error('Usage: --event <path-to-event-json> [--schema <path-to-schema-json>]');
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(args.eventPath, 'utf8'));
  const result = validateWorkflowEvent(payload, args.schemaPath);
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
}

main();
