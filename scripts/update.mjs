import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { collectGithub, collectHuggingface } from './sources.mjs';
import { enrichDescriptions } from './descriptions.mjs';
import { buildEdition, validateTopics } from './rank.mjs';

const dataDir = new URL('../public/data/', import.meta.url);
const snapshotFile = new URL('latest.json', dataDir);

async function loadSnapshot() {
  try {
    return JSON.parse(await readFile(snapshotFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function update() {
  const [config, previous] = await Promise.all([
    readFile(new URL('../config/research.json', import.meta.url), 'utf8'), loadSnapshot(),
  ]);
  const topics = validateTopics(JSON.parse(config));
  const now = new Date();
  const [github, huggingface] = await Promise.allSettled([
    collectGithub(topics, { now }), collectHuggingface(topics, { now }),
  ]);
  for (const [source, result] of Object.entries({ github, huggingface })) {
    if (result.status === 'rejected') console.warn(source, result.reason.message);
    else for (const warning of result.value.warnings) console.warn(source, warning);
  }
  const edition = buildEdition({ topics, previous, now, results: { github, huggingface } });
  const current = edition.items.filter(item => ['ok', 'partial'].includes(edition.sources[item.source].status));
  const enriched = new Map((await enrichDescriptions(current)).map(item => [item.url, item]));
  edition.items = edition.items.map(item => enriched.get(item.url) ?? item);
  await mkdir(dataDir, { recursive: true });
  const temporaryFile = new URL('latest-' + randomUUID() + '.tmp', dataDir);
  try {
    await writeFile(temporaryFile, JSON.stringify(edition, null, 2) + '\n');
    await rename(temporaryFile, snapshotFile);
  } finally {
    await rm(temporaryFile, { force: true });
  }
  for (const [source, { status }] of Object.entries(edition.sources)) {
    console.log(source, status, edition.items.filter(item => item.source === source).length + ' 个项目');
  }
  console.log(edition.date, '快照已写入 public/data/latest.json');
}

update().catch(error => { console.error(error.message); process.exitCode = 1; });
