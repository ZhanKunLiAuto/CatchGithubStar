import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEdition, editionDate, validateTopics } from '../scripts/rank.mjs';

const topics = validateTopics(JSON.parse(await readFile(new URL('../config/research.json', import.meta.url))));
const now = new Date('2026-05-21T23:00:00Z');
const repo = (name, description = '', stars = 30) => ({
  source: 'github', kind: 'repository', name, url: 'https://github.com/' + name,
  description, tags: [], updatedAt: '2026-05-21T10:00:00Z', stars,
});
const ok = (items = [], warnings = []) => ({ status: 'fulfilled', value: { items, warnings } });
const failed = { status: 'rejected', reason: new Error('offline') };
const edition = (github, other = {}) => buildEdition({
  now, topics, ...other, results: { github, huggingface: other.huggingface ?? ok() },
});

test('edition date follows Shanghai and configuration rejects ambiguous topic IDs', () => {
  assert.equal(editionDate(now), '2026-05-22');
  assert.throws(() => validateTopics({ topics: [topics[0], topics[0]] }), /配置/);
});

test('matches actual metadata, requires word boundaries and merges duplicate search hits', () => {
  const project = repo('lab/OpenVLA', '端到端自动驾驶的动作预测');
  const feed = edition(ok([repo('lab/Vladimir'), repo('SelfDriving-VLA/backup'), repo('lab/tools', 'a generic chat app'), project, project]));
  assert.equal(feed.items.length, 1);
  assert.deepEqual(feed.items[0].topics.sort(), ['autonomous-driving', 'end-to-end-driving', 'vla']);
  assert.ok(feed.items[0].keywords.includes('VLA'));
  assert.equal(feed.items[0].starGrowth, undefined);
});

test('project limit preserves a relevant smaller research direction', () => {
  const many = Array.from({ length: 18 }, (_, i) => repo('lab/VLA-' + i, '', 2000 + i));
  const feed = edition(ok([...many, repo('lab/world_model', '', 1)]));
  assert.equal(feed.items.length, 12);
  assert.ok(feed.items.some(i => i.name === 'lab/world_model'));
});

test('growth uses two dated observations, preserves the baseline on same-day reruns', () => {
  const project = repo('lab/world-model');
  const first = edition(ok([project]));
  const next = edition(ok([{ ...project, stars: 34 }]), {
    previous: first, now: new Date('2026-05-23T01:00:00Z'),
  });
  assert.equal(next.items[0].starGrowth, 4);
  assert.equal(next.items[0].growthDays, 1);
  const rerun = edition(ok([{ ...project, stars: 39 }]), {
    previous: next, now: new Date('2026-05-23T02:00:00Z'),
  });
  assert.equal(rerun.items[0].starGrowth, 9);
});

test('partial outage retains only observed data with its timestamp and handles recovery', () => {
  const project = repo('lab/world-model');
  const first = edition(ok([project]));
  const gap = edition(failed, { previous: first, now: new Date('2026-05-23T00:00:00Z') });
  assert.equal(gap.sources.github.status, 'stale');
  assert.equal(gap.sources.github.asOf, first.generatedAt);
  assert.equal(gap.items[0].name, project.name);
  const recovered = edition(ok([{ ...project, stars: 35 }]), {
    previous: gap, now: new Date('2026-05-24T02:00:00Z'),
  });
  assert.equal(recovered.items[0].growthDays, 2);
  assert.equal(recovered.items[0].starGrowth, 5);
  assert.equal(edition(failed).sources.github.status, 'unavailable');
  assert.equal(edition(ok([], ['one query failed'])).sources.github.status, 'partial');
  assert.throws(() => edition(failed, { previous: first, huggingface: failed }), /保留原有快照/);
});

test('HF items across resource types retain unique URLs and zero counts', () => {
  const hf = { source: 'huggingface', kind: 'model', name: 'org/VLA', description: '', tags: [],
    url: 'https://huggingface.co/org/VLA', likes: 0, downloads: 25 };
  const data = { ...hf, kind: 'dataset', url: 'https://huggingface.co/datasets/org/VLA' };
  const feed = edition(ok(), { huggingface: ok([hf, data, { ...hf, url: 'javascript:alert(1)' }]) });
  assert.equal(feed.items.length, 2);
  assert.ok(feed.items.every(i => i.likes === 0 && Number.isFinite(i.score)));
});

test('retains prior observations when only an irrelevant partial response succeeds', () => {
  const previous = edition(ok([repo('lab/world-model')]));
  const next = edition(ok([repo('lab/other')], ['rate-limited']), {
    previous, now: new Date('2026-05-23T02:00:00Z'),
  });
  assert.equal(next.sources.github.status, 'stale');
  assert.equal(next.sources.github.asOf, previous.generatedAt);
  assert.deepEqual(next.githubObservations, previous.githubObservations);
  assert.equal(next.items[0].name, 'lab/world-model');
  assert.equal(edition(ok([]), { previous }).items.length, 0);
});

test('detects star growth on candidates outside the previous shortlist', () => {
  const wellKnown = Array.from({ length: 12 }, (_, i) => repo('lab/VLA-' + i, '', 1000));
  const breakout = repo('lab/VLA-breakout', '', 1);
  const previous = edition(ok([...wellKnown, breakout]));
  assert.ok(!previous.items.some(i => i.name === breakout.name));
  const next = edition(ok([...wellKnown, { ...breakout, stars: 900 }]), {
    previous, now: new Date('2026-05-23T02:00:00Z'),
  });
  assert.equal(next.items[0].name, breakout.name);
  assert.equal(next.items[0].starGrowth, 899);
});

test('recently created projects receive space, zero-signal candidates do not', () => {
  const popular = Array.from({ length: 15 }, (_, i) => repo('lab/VLA-' + i, '', 5000));
  const recent = { ...repo('lab/VLA-new', '', 1), createdAt: now.toISOString() };
  const zero = { ...repo('lab/world-model-new', '', 0), createdAt: now.toISOString() };
  const items = edition(ok([...popular, recent, zero])).items;
  assert.ok(items.some(i => i.name === recent.name));
  assert.ok(!items.some(i => i.name === zero.name));
});
