import { createApp } from './app.js';
import { PosModel } from './models/pos-model.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const directory=path.resolve(process.env.POS_DATA_DIR??'.data');
mkdirSync(directory,{recursive:true});
const model=new PosModel(path.join(directory,'online.sqlite'));
await model.bootstrap();
const app=createApp(model);
export default app;

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`);
});
server.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close((error) => {
      model.close();
      if (error) console.error(error);
      process.exit(error ? 1 : 0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
