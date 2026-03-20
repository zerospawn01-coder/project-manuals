"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listStaticResources = listStaticResources;
exports.lookupStaticResource = lookupStaticResource;
const node_fs_1 = __importDefault(require("node:fs"));
const staticResources_1 = require("./staticResources");
function listStaticResources() {
    return [...staticResources_1.staticResources];
}
function lookupStaticResource(uri) {
    const resource = (0, staticResources_1.getStaticResourceByUri)(uri);
    if (!resource) {
        throw new Error(`Unknown repo split resource: ${uri}`);
    }
    return {
        ...resource,
        content: node_fs_1.default.readFileSync(resource.filePath, 'utf-8'),
    };
}
