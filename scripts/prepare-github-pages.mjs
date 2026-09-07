import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];
if (!repository) throw new Error('GITHUB_REPOSITORY is required (owner/repository).');

const client = path.resolve('dist/client');
await access(path.join(client, 'index.html'));

// vinext emits assetPrefix files under dist/client/<repository>/_next, while
// GitHub Pages already mounts this artifact at /<repository>. Flatten that
// generated prefix so /<repository>/_next/* resolves instead of being doubled.
const prefixedRoot = path.join(client, repository);
const prefixedNext = path.join(prefixedRoot, '_next');
try {
  await access(prefixedNext);
  await rm(path.join(client, '_next'), { recursive: true, force: true });
  await rename(prefixedNext, path.join(client, '_next'));
  await rm(prefixedRoot, { recursive: true, force: true });
} catch {
  // A future vinext version may already emit the correct flat artifact.
}

await writeFile(path.join(client, '.nojekyll'), '');
const html = await readFile(path.join(client, 'index.html'), 'utf8');
await writeFile(path.join(client, '404.html'), html);
console.log(JSON.stringify({ output: client, assetPrefix: `/${repository}/` }));
