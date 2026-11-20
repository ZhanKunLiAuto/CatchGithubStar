// Match complete tokens so "VLA" does not select a user named "Vladimir".
function normalize(text, splitCamelCase = true) {
  let value = String(text ?? '').normalize('NFKC');
  if (splitCamelCase) {
    value = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  }
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function searchable(text) {
  return [normalize(text), normalize(text, false)];
}

function matches(field, keyword) {
  if (!keyword) return false;
  return /\p{Script=Han}/u.test(keyword)
    ? field.includes(keyword)
    : (' ' + field + ' ').includes(' ' + keyword + ' ');
}

export function validateTopics(config) {
  if (!Array.isArray(config?.topics) || !config.topics.length) {
    throw new Error('config/research.json 必须包含非空 topics 数组');
  }
  const ids = new Set();
  for (const topic of config.topics) {
    const validList = (value) => Array.isArray(value) && value.length > 0
      && value.every(word => typeof word === 'string' && normalize(word));
    if (typeof topic?.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(topic.id)
      || ids.has(topic.id) || typeof topic.label !== 'string' || !topic.label.trim()
      || typeof topic.githubQuery !== 'string' || !topic.githubQuery.trim()
      || !validList(topic.keywords) || !validList(topic.hfQueries)) {
      throw new Error('方向配置有误，请检查唯一 id、label、keywords、githubQuery 和 hfQueries');
    }
    ids.add(topic.id);
  }
  return config.topics;
}

const dayMs = 86_400_000;
export function editionDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(date));
}

function publicItem(item) {
  try {
    const url = new URL(item.url);
    const expectedHost = item.source === 'github' ? 'github.com' : 'huggingface.co';
    return item.name && url.protocol === 'https:' && url.host === expectedHost && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Compare against all eligible projects observed on the preceding distinct date.
function nextBaseline(previous, now) {
  const asOf = previous?.sources?.github?.asOf;
  if (!asOf) return null;
  if (editionDate(asOf) === editionDate(now)) return previous.githubBaseline ?? null;
  if (Date.parse(asOf) > now.getTime()) return null;
  const stars = previous.githubObservations ?? Object.fromEntries(previous.items
    .filter(item => item.source === 'github' && Number.isFinite(item.stars))
    .map(item => [item.name.toLowerCase(), item.stars]));
  return { asOf, stars };
}

function growthFor(item, baseline, asOf) {
  if (item.source !== 'github' || !baseline || !Number.isFinite(item.stars)) return {};
  const previousStars = baseline.stars[item.name.toLowerCase()];
  const growthDays = (Date.parse(editionDate(asOf)) - Date.parse(editionDate(baseline.asOf))) / dayMs;
  if (!Number.isFinite(previousStars) || growthDays < 1) return {};
  return { starGrowth: item.stars - previousStars, growthDays };
}

// Saturation keeps lifetime audience size from dominating a small, recent release.
function logSignal(value, ceiling) {
  return Math.min(1, Math.log1p(Math.max(0, Number(value) || 0)) / Math.log1p(ceiling));
}

function scoreItem(item, relevance, now, growth) {
  const age = Math.max(0, (now.getTime() - Date.parse(item.updatedAt)) / dayMs);
  const freshness = Number.isFinite(age) ? 24 * Math.exp(-age / 40) : 0;
  let heat;
  if (item.source === 'github') {
    heat = 22 * logSignal(item.stars, 20000)
      + 18 * logSignal(growth.starGrowth / growth.growthDays, 100);
  } else {
    heat = 19 * logSignal(item.trendingScore, 100) + 13 * logSignal(item.likes, 1500)
      + 8 * logSignal(item.downloads, 50000);
  }
  return Math.round((relevance + freshness + heat) * 10) / 10;
}

function rankItem(item, topics, now, baseline, asOf, stale) {
  if (!publicItem(item)) return null;
  const hasAttention = item.source === 'github' ? item.stars >= 1
    : item.likes > 0 || item.trendingScore > 0 || item.downloads >= 20;
  if (!hasAttention) return null;
  const prominent = [item.name.split('/').at(-1), ...(item.tags ?? [])].flatMap(searchable);
  const description = searchable(item.description);
  const topicIds = [];
  const hits = new Set();
  let strongestMatch = 0;
  for (const topic of topics) {
    let matched = false;
    for (const keyword of topic.keywords) {
      const terms = searchable(keyword);
      const hasKeyword = field => terms.some(term => matches(field, term));
      const strength = prominent.some(hasKeyword) ? 30 : description.some(hasKeyword) ? 23 : 0;
      if (!strength) continue;
      strongestMatch = Math.max(strongestMatch, strength);
      hits.add(keyword);
      matched = true;
    }
    if (matched) topicIds.push(topic.id);
  }
  if (!topicIds.length) return null;
  const relevance = strongestMatch + Math.min(6, (hits.size - 1) * 2);
  const growth = stale
    ? (Number.isFinite(item.starGrowth) ? { starGrowth: item.starGrowth, growthDays: item.growthDays } : {})
    : growthFor(item, baseline, asOf);
  return { ...item, topics: topicIds, keywords: [...hits], ...growth, score: scoreItem(item, relevance, now, growth) };
}

const compare = (a, b) => b.score - a.score || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  || a.url.localeCompare(b.url);

function selectItems(candidates, topics, now, limit) {
  const sorted = candidates.sort(compare);
  const chosen = new Set();
  for (const topic of topics) {
    if (chosen.size >= limit) break;
    const best = sorted.find(item => item.topics.includes(topic.id));
    if (best) chosen.add(best);
  }
  const recent = sorted.filter(item => {
    const age = now.getTime() - Date.parse(item.createdAt);
    return age >= 0 && age <= 14 * dayMs;
  });
  for (const item of recent.slice(0, 2)) {
    if (chosen.size < limit) chosen.add(item);
  }
  for (const item of sorted) {
    if (chosen.size >= limit) break;
    chosen.add(item);
  }
  return [...chosen];
}

function rankedCandidates(raw, { source, topics, now, baseline, asOf, stale }) {
  const unique = new Map();
  for (const item of raw) {
    if (item.source !== source) continue;
    const ranked = rankItem(item, topics, now, baseline, asOf, stale);
    if (!ranked) continue;
    const key = source === 'github' ? ranked.url.toLowerCase() : ranked.url;
    if (!unique.has(key) || compare(ranked, unique.get(key)) < 0) unique.set(key, ranked);
  }
  return [...unique.values()];
}

export function buildEdition({ topics, previous, now, results }) {
  const generatedAt = now.toISOString();
  const freshBaseline = nextBaseline(previous, now);
  let githubBaseline = previous?.githubBaseline ?? null;
  let githubObservations = previous?.githubObservations ?? null;
  const sources = {};
  const items = [];
  for (const [source, result] of Object.entries(results)) {
    const fresh = result.status === 'fulfilled';
    const options = { source, topics, now, baseline: freshBaseline, asOf: generatedAt, stale: false };
    let candidates = fresh ? rankedCandidates(result.value.items, options) : [];
    let status = fresh ? (result.value.warnings.length ? 'partial' : 'ok') : 'unavailable';
    let asOf = fresh ? generatedAt : null;
    const lastAsOf = previous?.sources?.[source]?.asOf;
    if (lastAsOf && (!fresh || (status === 'partial' && !candidates.length))) {
      const older = rankedCandidates(previous.items, { ...options, asOf: lastAsOf, stale: true });
      if (older.length || !fresh) {
        candidates = older;
        asOf = lastAsOf;
        status = 'stale';
      }
    }
    sources[source] = { status, asOf };
    if (source === 'github' && (status === 'ok' || status === 'partial')) {
      githubBaseline = freshBaseline;
      githubObservations = Object.fromEntries(candidates.map(item => [item.name.toLowerCase(), item.stars]));
    }
    items.push(...selectItems(candidates, topics, now, 12));
  }
  if (Object.values(sources).every(({ status }) => status === 'stale' || status === 'unavailable')) {
    throw new Error('两个平台均未取得有效的新数据，已保留原有快照');
  }
  return {
    date: editionDate(now), generatedAt, topics: topics.map(({ id, label }) => ({ id, label })),
    sources, items: items.sort(compare), githubBaseline, githubObservations,
  };
}
