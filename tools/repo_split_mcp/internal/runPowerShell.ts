import { spawn } from 'node:child_process';

export interface PowerShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runPowerShell(scriptPath: string, args: string[]): Promise<PowerShellResult> {
  return new Promise((resolve) => {
    const processHandle = spawn(
      'pwsh',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      {
        shell: false,
        windowsHide: true,
      }
    );

    let stdout = '';
    let stderr = '';

    processHandle.stdout.on('data', (chunk: { toString(): string }) => {
      stdout += chunk.toString();
    });

    processHandle.stderr.on('data', (chunk: { toString(): string }) => {
      stderr += chunk.toString();
    });

    processHandle.on('close', (code: number | null) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
