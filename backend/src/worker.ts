import { setTimeout } from 'node:timers/promises';
import { processOneDocument } from './services/knowledge.service.js';
import { db } from './config/database.js';
let running = true;
process.on('SIGINT', () => {
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});
// Ingestion runs separately so parsing or embedding a file does not hold an HTTP request open.
while (running) {
  try {
    if (!(await processOneDocument())) await setTimeout(2000);
  } catch (error) {
    console.error('Worker failed:', error instanceof Error ? error.name : 'UnknownError');
    await setTimeout(5000);
  }
}
await db.$disconnect();
