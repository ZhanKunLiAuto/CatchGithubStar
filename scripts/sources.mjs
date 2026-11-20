import { readJson } from './http.mjs';

const DAY_MS = 86_400_000;
const HUB_KINDS = ['model', 'dataset', 'space'];

function headersFor(token) {
  const headers = { Accept: 'application/json', 'User-Agent': 'CatchGithubStar' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Construct public links locally. Only repository identifiers from the APIs become path segments.
function repositoryPath(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('/');
  if (parts.length > 2 || parts.some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')) return null;
  return parts.map(encodeURIComponent).join('/');
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function strings(values) {
  return Array.isArray(values) ? values.filter(value => typeof value === 'string' && value.length <= 180) : [];
}

function metric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function summary(...values) {
  const value = values.find(candidate => typeof candidate === 'string' && candidate.trim());
  if (!value) return '';
  const plain = value.slice(0, 6000)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/(?:^|\n)\s*#{1,6}\s+/g, ' ')
    .replace(/\s+/g, ' ').replace(/(?:…|\.\.\.)?\s*See the full description on the (?:dataset|model|space) page.*/i, '').trim();
  return plain.length <= 500 ? plain : plain.slice(0, 499).replace(/\s+\S*$/, '') + '…';
}

function githubItem(repo) {
  const path = repositoryPath(repo?.full_name);
  if (!path || repo.private !== false || repo.fork || repo.archived || repo.disabled) return null;
  return {
    source: 'github',
    kind: 'repository',
    name: repo.full_name,
    url: `https://github.com/${path}`,
    description: summary(repo.description),
    tags: strings(repo.topics),
    updatedAt: validDate(repo.pushed_at),
    createdAt: validDate(repo.created_at),
    stars: metric(repo.stargazers_count),
    language: typeof repo.language === 'string' ? repo.language : undefined,
  };
}

function hubItem(repo, kind) {
  const path = repositoryPath(repo?.id);
  if (!path || repo.private !== false || repo.disabled) return null;
  const prefix = kind === 'model' ? '' : `${kind}s/`;
  const card = repo.cardData;
  return {
    source: 'huggingface',
    kind,
    name: repo.id,
    url: `https://huggingface.co/${prefix}${path}`,
    description: summary(repo.description, card?.short_description, card?.description,
      card?.pretty_name, card?.title, card?.model_name, card?.['model-index']?.[0]?.name),
    tags: strings(repo.tags),
    updatedAt: validDate(repo.lastModified),
    createdAt: validDate(repo.createdAt),
    likes: metric(repo.likes),
    downloads: metric(repo.downloads),
    trendingScore: metric(repo.trendingScore),
  };
}

async function collectQueries(queries, headers, parse, concurrency) {
  const items = new Map();
  const warnings = [];
  let successes = 0;
  let consecutiveFailedBatches = 0;
  for (let offset = 0; offset < queries.length; offset += concurrency) {
    const batch = queries.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map(async query => {
      const payload = await readJson(query.url, headers);
      return parse(payload, query);
    }));
    let stop = false;
    for (const [index, result] of results.entries()) {
      const label = batch[index].label;
      if (result.status === 'rejected') {
        warnings.push(`${label} · ${result.reason.message}`);
        stop ||= Boolean(result.reason.stopSource);
        continue;
      }
      successes++;
      if (result.value.incomplete) warnings.push(`${label} · 接口标记本次结果不完整`);
      for (const item of result.value.items) {
        if (!item) continue;
        const key = item.source === 'github' ? item.url.toLowerCase() : item.url;
        items.set(key, item);
      }
    }
    consecutiveFailedBatches = results.every(result => result.status === 'rejected') ? consecutiveFailedBatches + 1 : 0;
    if (stop || consecutiveFailedBatches >= 3) break;
  }
  if (!successes) throw new Error(warnings.join('；') || '没有可执行的查询');
  return { items: [...items.values()], warnings };
}

export async function collectGithub(topics, { now = new Date() } = {}) {
  const cutoff = days => new Date(new Date(now).getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const windows = [
    { filter: `pushed:>=${cutoff(60)}`, label: '近期活跃' },
    { filter: `created:>=${cutoff(30)}`, label: '近期新建' },
  ];
  const queries = windows.flatMap(window => topics.map(topic => {
    const url = new URL('https://api.github.com/search/repositories');
    url.search = new URLSearchParams({
      q: `${topic.githubQuery} is:public fork:false archived:false ${window.filter}`,
      sort: 'stars',
      order: 'desc',
      per_page: '40',
    }).toString();
    return { label: `${topic.label} / ${window.label}`, url };
  }));
  const headers = {
    ...headersFor(process.env.GITHUB_TOKEN),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  return collectQueries(queries, headers, payload => {
    if (!Array.isArray(payload?.items)) throw new Error('仓库列表格式异常');
    return { items: payload.items.map(githubItem), incomplete: payload.incomplete_results };
  }, 1);
}

function hubQuery(kind, term, sort = 'trendingScore') {
  const url = new URL(`https://huggingface.co/api/${kind}s`);
  url.search = new URLSearchParams({
    sort,
    direction: '-1',
    limit: term ? '25' : '50',
  }).toString();
  if (term) url.searchParams.set('search', term);
  const fields = ['private', 'disabled', 'lastModified', 'createdAt', 'likes', 'tags', 'trendingScore'];
  if (kind !== 'space') fields.push('downloads');
  fields.push(kind === 'dataset' ? 'description' : 'cardData');
  for (const field of fields) url.searchParams.append('expand[]', field);
  return { kind, label: `${kind} / ${term || '全站趋势'}${sort === 'likes' ? ' / 点赞' : ''}`, url };
}

export async function collectHuggingface(topics) {
  const terms = new Set(topics.flatMap(topic => topic.hfQueries));
  const primaryTerms = new Set(topics.map(topic => topic.hfQueries[0]));
  const queries = [
    ...['', ...terms].flatMap(term => HUB_KINDS.map(kind => hubQuery(kind, term))),
    ...[...primaryTerms].flatMap(term => HUB_KINDS.map(kind => hubQuery(kind, term, 'likes'))),
  ];
  return collectQueries(queries, headersFor(process.env.HF_TOKEN), (payload, { kind }) => {
    if (!Array.isArray(payload)) throw new Error('Hub 项目列表格式异常');
    return { items: payload.map(repo => hubItem(repo, kind)) };
  }, 3);
}
