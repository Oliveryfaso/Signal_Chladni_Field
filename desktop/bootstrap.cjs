// Signal Field modification notice (2026-07-27). See LICENSE, UPSTREAM_NOTICE.md, and MODIFICATIONS.md.
const { extractRenderWorkerArguments } = require('./render-queue.cjs');

const workerArguments = extractRenderWorkerArguments(process.argv.slice(1));

if (workerArguments) {
  // Dispatch before loading the normal desktop main process. In a packaged app,
  // process.execPath is the app executable rather than the Electron CLI, so the
  // explicit worker flag is the only reliable way to avoid opening the UI again.
  require('../scripts/export-video.cjs').runCli(workerArguments);
} else {
  require('./main.cjs');
}
