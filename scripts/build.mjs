import { mkdir, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
for (const name of ['index.html', 'src', 'public']) {
  await cp(new URL(name, root), new URL(`dist/${name}`, root), { recursive: true });
}
console.log('Static site built in dist/ (GitHub Pages compatible relative paths).');
