import { app } from './app.js';
import { db } from './config/database.js';
import { config } from './config/env.js';
const server = app.listen(config.PORT, '127.0.0.1', () =>
  console.log(`RetailPulse API: http://127.0.0.1:${config.PORT}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    }),
  );
