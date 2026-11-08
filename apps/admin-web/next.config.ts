import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // Runtime databases and encryption keys must never enter build artifacts.
  outputFileTracingExcludes: { '/*': ['./.data/**/*', './.test-dist/**/*'] },
};

export default config;
