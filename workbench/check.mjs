import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const sourceFiles = folder => readdirSync(`${root}${folder}`, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(`${folder}/${entry.name}`) : entry.name.endsWith('.mjs') ? [`${folder}/${entry.name}`] : []);
const files = ['server.mjs', 'build-server.mjs', ...sourceFiles('web/src'), ...sourceFiles('native'), ...sourceFiles('build-service')];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', `${root}${file}`], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`${files.length} 个 JavaScript 文件语法检查通过。`);
