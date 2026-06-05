"use strict";

const path = require("node:path");

const root = (process.env.INIT_CWD || process.cwd()).replace(/^[\\]{2}[?][\\]/, "");
process.chdir(root);

const [, , scriptPath, ...scriptArgs] = process.argv;

if (!scriptPath) {
  console.error("Usage: node tools/run_tsnode_cli.js <script.ts> [...args]");
  process.exit(1);
}

require(path.join(root, "node_modules", "ts-node", "register"));
process.argv = [process.argv[0], path.join(root, scriptPath), ...scriptArgs];
require(path.join(root, scriptPath));
