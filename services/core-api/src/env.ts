import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const repoRootEnvPath = path.resolve(currentDir, '../../../.env');

config({ path: repoRootEnvPath, quiet: true });