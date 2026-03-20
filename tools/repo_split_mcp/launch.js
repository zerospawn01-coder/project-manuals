const path = require('node:path');

const scriptDir = __dirname.replace(/^\\\\\?\\/, '');
const repoRoot = path.resolve(scriptDir, '..', '..');

process.chdir(repoRoot);

require('ts-node/register');
require(path.join(scriptDir, 'bootstrap.ts'));
