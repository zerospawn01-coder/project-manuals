"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPowerShell = runPowerShell;
const node_child_process_1 = require("node:child_process");
async function runPowerShell(scriptPath, args) {
    return new Promise((resolve) => {
        const processHandle = (0, node_child_process_1.spawn)('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
            shell: false,
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        processHandle.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        processHandle.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        processHandle.on('close', (code) => {
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr,
            });
        });
    });
}
