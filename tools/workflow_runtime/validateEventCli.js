"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const eventSchemaRuntimeValidator_1 = require("./eventSchemaRuntimeValidator");
function normalizeWindowsPath(value) {
    return value.replace(/^\\\\\?\\/, '');
}
function repoRoot() {
    return normalizeWindowsPath(node_path_1.default.resolve(__dirname, '..', '..'));
}
function parseArgs(argv) {
    const parsed = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--event' && argv[i + 1]) {
            parsed.eventPath = node_path_1.default.resolve(repoRoot(), argv[i + 1]);
            i += 1;
            continue;
        }
        if (token === '--schema' && argv[i + 1]) {
            parsed.schemaPath = node_path_1.default.resolve(repoRoot(), argv[i + 1]);
            i += 1;
        }
    }
    return parsed;
}
function main() {
    // node -e forwarding on Windows may place the first custom flag at argv[1].
    const args = parseArgs(node_process_1.default.argv.slice(1));
    if (!args.eventPath) {
        console.error('Usage: --event <path-to-event-json> [--schema <path-to-schema-json>]');
        node_process_1.default.exit(1);
    }
    const payload = JSON.parse(node_fs_1.default.readFileSync(args.eventPath, 'utf8'));
    const result = (0, eventSchemaRuntimeValidator_1.validateWorkflowEvent)(payload, args.schemaPath);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
        node_process_1.default.exit(1);
    }
}
main();
