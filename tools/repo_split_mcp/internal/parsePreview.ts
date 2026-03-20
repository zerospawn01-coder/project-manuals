export interface PreviewParseResult {
  warnings: string[];
  detectedOperationCount: number;
  repoHints: string[];
  pathHints: string[];
}

const WHAT_IF_PREFIX = /^What if:/i;
const WARNING_PREFIX = /^WARNING:/i;
const REPO_HEADER_PATTERN = /^\[(.+?)\]$/;
const PATH_ARROW_PATTERN = /\s{2,}(.+?)\s+->\s+(.+?)(?:\s+\[|$)/;

export function parsePreview(stdout: string, stderr = ''): PreviewParseResult {
  const warnings: string[] = [];
  const repoHints = new Set<string>();
  const pathHints = new Set<string>();
  let detectedOperationCount = 0;

  const combined = `${stdout}\n${stderr}`;
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (WHAT_IF_PREFIX.test(line)) {
      detectedOperationCount += 1;
    }

    if (WARNING_PREFIX.test(line) || /source path not found/i.test(line) || /already exists/i.test(line)) {
      warnings.push(line);
    }

    const repoMatch = line.match(REPO_HEADER_PATTERN);
    if (repoMatch) {
      repoHints.add(repoMatch[1]);
    }

    const pathMatch = rawLine.match(PATH_ARROW_PATTERN);
    if (pathMatch) {
      pathHints.add(`${pathMatch[1].trim()} -> ${pathMatch[2].trim()}`);
    }
  }

  return {
    warnings,
    detectedOperationCount,
    repoHints: [...repoHints],
    pathHints: [...pathHints],
  };
}
