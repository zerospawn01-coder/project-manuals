"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("./errors");
const server_1 = require("./server");
(0, server_1.startRepoSplitMcpServer)().catch((error) => {
    console.error((0, errors_1.formatRepoSplitError)(error));
    process.exit(1);
});
