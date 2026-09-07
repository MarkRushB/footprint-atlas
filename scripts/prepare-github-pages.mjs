import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
if (!repository) throw new Error('GITHUB_REPOSITORY is required (owner/repository).');

const client = path.resolve('dist/client');
await access(path.join(client, 'index.html'));
await writeFile(path.join(client, '.nojekyll'), '');
const html = await readFile(path.join(client, 'index.html'), 'utf8');
await writeFile(path.join(client, '404.html'), html);
console.log(JSON.stringify({ output: client, assetPrefix: `/${repository}/` }));
