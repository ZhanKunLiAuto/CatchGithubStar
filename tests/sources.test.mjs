import assert from 'node:assert/strict';
import test from 'node:test';
import { collectGithub, collectHuggingface } from '../scripts/sources.mjs';
import { enrichDescriptions } from '../scripts/descriptions.mjs';

const topic = { id: 'vla', label: 'VLA', keywords: ['VLA'], githubQuery: 'VLA', hfQueries: ['vla'] };

test('GitHub combines discovery windows without leaking private repos or counting search duplicates', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url));
    const sample = { full_name: 'org/VLA', private: false, stargazers_count: 3, topics: ['robotics'] };
    return Response.json({ items: [sample, { ...sample, full_name: 'org/hidden', private: true }],
      incomplete_results: urls.length === 1 });
  });
  const { items, warnings } = await collectGithub([topic], { now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://github.com/org/VLA');
  assert.ok(warnings.length > 0);
  assert.match(urls[0].searchParams.get('q'), /pushed:>=2026-04-02/);
  assert.match(urls[1].searchParams.get('q'), /created:>=2026-05-02/);
});

test('Hub merges trend and like searches, retaining distinct models, datasets and Spaces', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    urls.push(url);
    return Response.json([
      { id: 'lab/VLA', private: false, likes: 5, downloads: 10, lastModified: '2026-06-01T00:00:00Z' },
      { id: 'lab/private', private: true, likes: 100 },
    ]);
  });
  const { items, warnings } = await collectHuggingface([topic]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(items.map(item => item.url).sort(), [
    'https://huggingface.co/datasets/lab/VLA', 'https://huggingface.co/lab/VLA', 'https://huggingface.co/spaces/lab/VLA',
  ]);
  assert.equal(urls.filter(url => url.searchParams.get('sort') === 'likes').length, 3);
});

test('a README fetch can enrich a missing model summary or fail without losing the project', async t => {
  const sentence = 'This model predicts the physical consequences of actions from a camera observation.';
  const markdown = ['---', 'license: mit', '---', '# The World Model', '',
    '[![Badge](badge.svg)](badge.md)', '', sentence, '', '## Deployment instructions'].join('\n');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.host, 'huggingface.co');
    assert.equal(options.headers.Authorization, undefined);
    if (url.pathname.includes('/missing/')) return new Response('', { status: 404 });
    return new Response(markdown);
  });
  const model = { source: 'huggingface', kind: 'model', name: 'org/world-model', description: '' };
  const missing = { ...model, name: 'org/missing' };
  const [first, second] = await enrichDescriptions([model, missing]);
  assert.equal(first.description, sentence);
  assert.deepEqual(second, missing);
});
