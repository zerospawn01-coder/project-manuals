import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

interface ParsedArgs {
  logPath?: string;
  outPath?: string;
}

interface DispatchAuditLine {
  timestamp?: string;
  event_id?: string;
  week_id?: string;
  run_id?: string;
  schema_validated?: boolean;
  schema_errors?: string[];
  failure_reason?: string;
}

interface DispatchAuditTelemetryReport {
  generated_at: string;
  source_log_path: string;
  line_count: number;
  parsed_line_count: number;
  parse_error_count: number;
  validation_failure_count: number;
  missing_required_context_count: number;
  dispatch_ready_count: number;
  dispatch_ready_rate: number;
  failures_by_week: Record<string, number>;
  failures_by_run: Record<string, number>;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\?\\/, '');
}

function repoRoot(): string {
  return normalizeWindowsPath(path.resolve(__dirname, '..', '..'));
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--log' && argv[i + 1]) {
      parsed.logPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
      continue;
    }

    if (token === '--out' && argv[i + 1]) {
      parsed.outPath = path.resolve(repoRoot(), argv[i + 1]);
      i += 1;
    }
  }

  return parsed;
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function main() {
  const args = parseArgs(process.argv.slice(1));
  const sourceLogPath = args.logPath ?? path.resolve(repoRoot(), 'logs', 'dynamic_prompt_orchestrator.dispatch.audit.jsonl');
  const lines = fs.existsSync(sourceLogPath)
    ? fs.readFileSync(sourceLogPath, 'utf8').split(/\r?\n/).filter((line) => line.trim().length > 0)
    : [];

  const failuresByWeek: Record<string, number> = {};
  const failuresByRun: Record<string, number> = {};

  let parsedLineCount = 0;
  let parseErrorCount = 0;
  let validationFailureCount = 0;
  let missingRequiredContextCount = 0;
  let dispatchReadyCount = 0;

  for (const line of lines) {
    let record: DispatchAuditLine;

    try {
      record = JSON.parse(line) as DispatchAuditLine;
      parsedLineCount += 1;
    } catch {
      parseErrorCount += 1;
      continue;
    }

    if (record.schema_validated === true) {
      dispatchReadyCount += 1;
      continue;
    }

    validationFailureCount += 1;

    if (record.failure_reason === 'missing_required_context') {
      missingRequiredContextCount += 1;
    }

    const weekKey = record.week_id && record.week_id.trim().length > 0 ? record.week_id : 'unknown_week';
    const runKey = record.run_id && record.run_id.trim().length > 0 ? record.run_id : 'unknown_run';

    increment(failuresByWeek, weekKey);
    increment(failuresByRun, runKey);
  }

  const dispatchReadyRate = parsedLineCount === 0
    ? 0
    : Number((dispatchReadyCount / parsedLineCount).toFixed(4));

  const report: DispatchAuditTelemetryReport = {
    generated_at: new Date().toISOString(),
    source_log_path: sourceLogPath,
    line_count: lines.length,
    parsed_line_count: parsedLineCount,
    parse_error_count: parseErrorCount,
    validation_failure_count: validationFailureCount,
    missing_required_context_count: missingRequiredContextCount,
    dispatch_ready_count: dispatchReadyCount,
    dispatch_ready_rate: dispatchReadyRate,
    failures_by_week: failuresByWeek,
    failures_by_run: failuresByRun,
  };

  if (args.outPath) {
    const outDir = path.dirname(args.outPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
