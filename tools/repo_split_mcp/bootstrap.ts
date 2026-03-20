import { formatRepoSplitError } from './errors';
import { startRepoSplitMcpServer } from './server';

startRepoSplitMcpServer().catch((error) => {
  console.error(formatRepoSplitError(error));
  process.exit(1);
});
