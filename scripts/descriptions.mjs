const MAX_READMES = 15;
const MAX_BYTES = 32 * 1024;
const CONCURRENCY = 3;

function readmeUrl(item) {
  const name = item.name;
  if (typeof name !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)?$/.test(name)
    || name.split('/').some(part => part === '.' || part === '..')) return null;
  if (item.source === 'github' && item.kind === 'repository' && name.includes('/')) {
    return new URL('https://api.github.com/repos/' + name + '/readme');
  }
  if (item.source !== 'huggingface' || !['model', 'dataset', 'space'].includes(item.kind)) return null;
  const prefix = item.kind === 'model' ? '' : item.kind + 's/';
  return new URL('https://huggingface.co/' + prefix + name + '/raw/main/README.md');
}

async function readBeginning(url) {
  // Use anonymous requests even when the collector has tokens: a repository may have become private.
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CatchGithubStar',
      Accept: url.hostname === 'api.github.com' ? 'application/vnd.github.raw+json' : 'text/plain',
    },
    signal: AbortSignal.timeout(7000),
    redirect: 'error',
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return '';
  }
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (length < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const prefix = value.subarray(0, MAX_BYTES - length);
      chunks.push(prefix);
      length += prefix.byteLength;
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function leadParagraph(markdown) {
  let body = markdown.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trimStart();
  if (body.startsWith('---\n')) {
    const delimiter = body.slice(4).search(/^---\s*$/m);
    if (delimiter === -1) return '';
    body = body.slice(4 + delimiter + 3);
  }
  const blocks = body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/^(?:```|~~~)[\s\S]*?(?:^(?:```|~~~)[^\n]*$|(?![\s\S]))/gm, '\n')
    .replace(/<(h[1-6]|table|picture|video|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<\/?(?:p|div|br)\b[^>]*>/gi, '\n\n')
    .replace(/^[ \t]*#{1,6}\s+.*$/gm, '\n')
    .split(/\n[\t ]*\n/);
  for (const block of blocks) {
    if (/^\s*(?:[-*+]\s|\d+\.\s|[|>]|\[!|!\[)/m.test(block)) continue;
    const cleaned = block
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_`]/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
    if (cleaned.length < 45 || /https?:\/\/|[|{}]|\.\.\.|… See the full description/i.test(cleaned)) continue;
    if (/^(?:developed by|created by|authors?\b|paper\s*[:|]|arxiv|license\s*:|install|click|please|see\b|run\b|clone\b|download\b|usage\b|to (?:use|install|run|download)|we (?:release|announce)|\[|[📄📦🚀🔥🎉])/iu.test(cleaned)) continue;
    if (!/[.!?。？！](?:\s|$)|[。？！]/u.test(cleaned)) continue;
    const sentences = cleaned.match(/^.{30,270}?[.!?。？！](?=\s|$)/u);
    if (sentences) return sentences[0];
    // Long abstracts can lack an early sentence break. Keep the excerpt within the card budget.
    const prefix = cleaned.slice(0, 250);
    return cleaned.length <= 250 ? cleaned : prefix.replace(/\s+\S*$/, '') + '…';
  }
  return '';
}

function needsDescription(item) {
  const description = item.description?.trim();
  if (!description || description.length < 20) return true;
  const compact = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return [item.name, item.name.split('/').at(-1)].some(name => compact(name) === compact(description));
}

// Enrichment is best effort and never changes an item's ranking or other metadata.
export async function enrichDescriptions(items) {
  const enriched = [...items];
  const candidates = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => needsDescription(item)).slice(0, MAX_READMES);
  for (let offset = 0; offset < candidates.length; offset += CONCURRENCY) {
    await Promise.all(candidates.slice(offset, offset + CONCURRENCY).map(async ({ item, index }) => {
      try {
        const url = readmeUrl(item);
        if (!url) return;
        const description = leadParagraph(await readBeginning(url));
        if (description) enriched[index] = { ...item, description };
      } catch {
        // Missing cards, timeouts and gated repositories are expected.
      }
    }));
  }
  return enriched;
}
