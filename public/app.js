'use strict';

const $ = (selector) => document.querySelector(selector);
const labels = { github: 'GitHub', huggingface: 'Hugging Face' };
const kinds = { model: '模型', dataset: '数据集', space: 'Space', repository: '代码仓库' };
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const pageSize = 12;
let feed;
let topicNames = new Map();
let platform = 'all';
let limit = pageSize;
const searchBox = $('#search');
const topicBox = $('#topic');
const cards = $('#projects');

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function canvasContext(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

// Draw a range scan and a small vehicle on the same ground plane.
function drawRadar() {
  const canvas = $('#radar');
  const ctx = canvasContext(canvas);
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const radius = Math.min(width * .43, height * .84);
  const center = [width * .54, height * .58];
  const project = ([x, y, z = 0]) => [
    center[0] + radius * (.86 * x - .5 * y),
    center[1] + radius * (.28 * x + .45 * y - z)
  ];
  const onRing = (r, angle) => project([r * Math.cos(angle), r * Math.sin(angle)]);
  const tau = Math.PI * 2;

  function line(points, color, thickness = 1, closed = false) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (closed) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }
  function polygon(points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function circle([x, y], r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, tau); ctx.fill();
  }
  function ring(r, color, thickness = 1, from = 0, to = tau) {
    const steps = Math.ceil(100 * (to - from) / tau);
    line(Array.from({ length: steps + 1 }, (_, i) => onRing(r, from + (to - from) * i / steps)), color, thickness);
  }

  for (let i = -14; i <= 14; i++) {
    for (let j = -16; j <= 16; j++) {
      const point = [i / 8, j / 8];
      const distance = Math.hypot(...point);
      const alpha = .31 * Math.max(.2, 1 - Math.abs(distance - .85) / 1.65);
      circle(project(point), distance < 1 ? .8 : .65, 'rgba(190,168,236,' + alpha + ')');
    }
  }
  for (let i = -3; i <= 3; i++) {
    line([project([-1.6, i * .4]), project([1.6, i * .4])], '#c5a5ff0c');
    line([project([i * .4, -1.6]), project([i * .4, 1.6])], '#c5a5ff0c');
  }
  for (let i = 1; i <= 5; i++) ring(i * .2, i === 5 ? '#b8a0df91' : '#b8a0df42');
  ring(1.08, '#b8a0df34');
  ring(1.12, '#c9b3ea75', 1.5, 3.34, 4.42);
  ring(1.12, '#c9b3ea55', 1.5, .16, 1.07);
  for (let i = 0; i < 80; i++) {
    const angle = tau * i / 80;
    line([onRing(1.015, angle), onRing(i % 5 === 0 ? 1.065 : 1.033, angle)], '#bdabe37a');
  }
  for (let i = 0; i < 8; i++) line([onRing(.09, i * tau / 8), onRing(1, i * tau / 8)], '#c5b1e42b');
  const sweep = 4.87;
  for (let i = 0; i < 60; i++) {
    const a = sweep - .98 + i / 60;
    polygon([center, onRing(.99, a), onRing(.99, a + .018)], 'rgba(183,149,255,' + (.025 + .42 * (i / 60) ** 2) + ')');
  }
  line([center, onRing(1, sweep)], '#dcc9ff', 1.7);
  ring(1, '#cdb2ffb8', 1.8, sweep - .28, sweep);
  const marks = [[-.69, -.12, .18], [.23, -.66, .28], [.42, .4, .16], [-.18, .76, .1]];
  for (const [x, y, z] of marks) {
    const base = project([x, y]);
    const head = project([x, y, z]);
    const glow = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], 14);
    glow.addColorStop(0, '#e7f7bd55'); glow.addColorStop(1, '#e7f7bd00');
    circle(head, 14, glow);
    ctx.beginPath(); ctx.ellipse(base[0], base[1], 6.5, 3, 0, 0, tau);
    ctx.strokeStyle = '#d3e9abb3'; ctx.lineWidth = 1; ctx.stroke();
    line([base, head], '#c9df9c99');
    circle(head, 2.4, '#e6f2cb');
  }

  const v = (points) => points.map(project);
  const body = v([[-.16, -.079, .03], [.17, -.079, .03], [.19, .065, .03], [.15, .085, .03], [-.17, .085, .03]]);
  const top = v([[-.145, -.078, .07], [.13, -.078, .07], [.18, .066, .062], [.14, .085, .069], [-.16, .08, .07]]);
  polygon([body[2], body[3], body[4], top[4], top[3], top[2]], '#75638f', '#c8b4e7');
  polygon(top, '#a693c1', '#d7c4f4');
  const roof = v([[-.071, -.049, .112], [.047, -.049, .112], [.056, .049, .112], [-.084, .049, .112]]);
  const windshield = v([[.047, -.049, .112], [.10, -.064, .071], [.111, .057, .071], [.056, .049, .112]]);
  polygon(windshield, '#3c3454', '#c5b4df');
  polygon(roof, '#c6b8db', '#e5d7fa');
  polygon(v([[-.085, .049, .112], [.056, .049, .112], [.11, .057, .071], [-.118, .065, .071]]), '#3d3453', '#bca4d7');
  line(v([[.162, .055, .066], [.168, .072, .059]]), '#e2efbf', 2);
}
new ResizeObserver(drawRadar).observe($('#radar'));

const githubPath = new Path2D('M12 .9C5.87.9.9 5.87.9 12c0 4.9 3.18 9.05 7.6 10.51.55.1.76-.24.76-.53 0-.26-.01-.95-.02-1.87-3.1.67-3.75-1.49-3.75-1.49-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.7 1.14 1.7 1.14 1 .17 1.17 2.1 3.23 1.51.1-.72.39-1.21.7-1.49-2.48-.28-5.08-1.24-5.08-5.51 0-1.22.44-2.21 1.14-2.99-.12-.28-.5-1.42.1-2.95 0 0 .94-.3 3.05 1.14.89-.25 1.84-.38 2.79-.38s1.9.13 2.79.38c2.11-1.44 3.05-1.14 3.05-1.14.6 1.53.22 2.67.1 2.95.71.78 1.14 1.77 1.14 2.99 0 4.28-2.61 5.22-5.1 5.5.4.35.75 1.03.75 2.07v3.03c0 .29.2.63.77.52A11.12 11.12 0 0 0 23.1 12C23.1 5.87 18.13.9 12 .9z');

function sourceIcon(source) {
  if (source === 'huggingface') {
    const icon = element('span', 'platform-icon hf-icon', '🤗');
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  const icon = element('canvas', 'platform-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.width = icon.height = 48;
  const ctx = icon.getContext('2d');
  if (ctx) { ctx.scale(2, 2); ctx.fillStyle = '#292531'; ctx.fill(githubPath); }
  return icon;
}

function localDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return clock.format(date).replaceAll('/', '.');
}

function timeNode(value, text) {
  const node = element('time', '', text);
  node.dateTime = value;
  return node;
}

function metric(icon, value, label) {
  const node = element('span', 'metric');
  const symbol = element('span', 'metric-icon', icon);
  symbol.setAttribute('aria-hidden', 'true');
  node.append(symbol, element('span', '', compact.format(value)));
  node.setAttribute('aria-label', label + ' ' + value);
  node.title = label + ' ' + value.toLocaleString('zh-CN');
  return node;
}

function safeProjectLink(item) {
  try {
    const url = new URL(item.url);
    const host = item.source === 'github' ? 'github.com' : 'huggingface.co';
    return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function projectCard(item) {
  const card = element('article', 'project');
  const platformName = element('span', 'platform-label');
  platformName.append(sourceIcon(item.source), labels[item.source]);
  const top = element('div', 'card-top');
  top.append(platformName, element('span', 'kind', kinds[item.kind] || '项目'));
  const ageInDays = (Date.parse(feed.generatedAt) - Date.parse(item.createdAt)) / 86_400_000;
  if (ageInDays >= 0 && ageInDays <= 14) {
    const recent = element('span', 'recent', '近 14 天创建');
    recent.title = '创建于 ' + localDate(item.createdAt) + '（北京时间）';
    top.append(recent);
  }
  card.append(top);

  const split = item.name.indexOf('/');
  const displayName = split >= 0 ? item.name.slice(split + 1) : item.name;
  if (split >= 0) card.append(element('p', 'owner', item.name.slice(0, split)));
  const title = element('h3');
  const href = safeProjectLink(item);
  if (href) {
    const link = element('a', 'project-title', displayName);
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', '在 ' + labels[item.source] + ' 打开 ' + item.name + '（新标签页）');
    title.append(link);
  } else title.textContent = displayName;
  card.append(title);
  const matches = (item.keywords || []).join('、');
  const description = item.description || (matches ? '匹配关键词 · ' + matches : '');
  if (description) card.append(element('p', 'description', description));
  const tags = element('div', 'topic-tags');
  tags.setAttribute('aria-label', '匹配的研究方向');
  for (const id of item.topics || []) {
    const tag = element('span', 'topic-tag', topicNames.get(id) || id);
    if (matches) tag.title = '项目匹配关键词 · ' + matches;
    tags.append(tag);
  }
  card.append(tags);
  const meta = element('div', 'project-meta');
  if (Number.isFinite(item.stars)) meta.append(metric('☆', item.stars, 'GitHub 星标'));
  if (Number.isFinite(item.likes)) meta.append(metric('♡', item.likes, 'Hugging Face 点赞'));
  if (Number.isFinite(item.downloads)) meta.append(metric('↓', item.downloads, '近 30 天下载量'));
  if (Number.isFinite(item.starGrowth) && item.starGrowth !== 0 && item.growthDays > 0) {
    const delta = (item.starGrowth > 0 ? '+' : '') + compact.format(item.starGrowth);
    const change = element('span', item.starGrowth > 0 ? 'growth' : 'growth decline', delta + ' 星 / ' + item.growthDays + ' 天');
    meta.append(change);
  }
  const date = localDate(item.updatedAt);
  if (date) {
    const stamp = timeNode(item.updatedAt, date.split(' ')[0] + ' 更新');
    stamp.title = date + '（北京时间）';
    meta.append(stamp);
  }
  card.append(meta);
  return card;
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().trim();
}

function resetFilters() {
  platform = 'all'; searchBox.value = ''; topicBox.value = ''; limit = pageSize;
  renderFeed();
  searchBox.focus();
}

function state(title, text, action, handler) {
  const box = element('div', 'state');
  box.append(element('h3', '', title), element('p', '', text));
  if (action) {
    const button = element('button', 'secondary', action);
    button.type = 'button'; button.addEventListener('click', handler);
    box.append(button);
  }
  return box;
}

function renderFeed() {
  if (!feed) return;
  const query = normalize(searchBox.value).split(/\s+/).filter(Boolean);
  const eligible = feed.items.filter((item) => {
    if (topicBox.value && !item.topics?.includes(topicBox.value)) return false;
    if (query.length === 0) return true;
    const terms = normalize([item.name, item.description, labels[item.source], kinds[item.kind], item.language,
      ...(item.keywords || []), ...(item.topics || []).map((id) => topicNames.get(id) || id)].join(' '));
    return query.every((word) => terms.includes(word));
  });
  const items = eligible.filter((item) => platform === 'all' || platform === item.source);
  for (const button of document.querySelectorAll('[data-source]')) {
    const source = button.dataset.source;
    button.setAttribute('aria-pressed', String(platform === source));
    button.querySelector('[data-count]').textContent = source === 'all' ? eligible.length : eligible.filter((item) => item.source === source).length;
  }
  const results = document.createDocumentFragment();
  if (items.length) {
    for (const item of items.slice(0, limit)) results.append(projectCard(item));
  } else if (query.length || platform !== 'all' || topicBox.value) {
    results.append(state('没有符合条件的项目', '可以调整研究方向、平台或搜索词。', '清除筛选', resetFilters));
  } else {
    results.append(state('本期暂无匹配项目', '下次采集后，这里会显示符合研究方向的项目。'));
  }
  cards.replaceChildren(results);
  cards.setAttribute('aria-busy', 'false');
  $('#result-status').textContent = '找到 ' + items.length + ' 个项目，已显示 ' + Math.min(limit, items.length) + ' 个。';
  const more = $('#more');
  more.hidden = items.length <= limit;
  more.textContent = '再显示 ' + Math.min(pageSize, Math.max(0, items.length - limit)) + ' 个项目';
}

function showMetadata() {
  const date = new Date(feed.date + 'T12:00:00+08:00');
  const edition = Number.isFinite(date.getTime()) ? feed.date.replaceAll('-', '.') + '  /  ' + weekday.format(date) : '简报日期未知';
  $('#edition-text').textContent = edition;
  const alerts = $('#alerts');
  const details = $('#source-times');
  alerts.replaceChildren(); details.replaceChildren();
  for (const [id, label] of Object.entries(labels)) {
    const source = feed.sources?.[id];
    const asOf = localDate(source?.asOf);
    details.append(element('p', '', label + ' · ' + (asOf ? asOf + '（北京时间）' : '暂无采集记录')));
    let message = '';
    if (source?.status === 'stale') message = label + ' 本次采集未完成，沿用' + (asOf ? ' ' + asOf + ' 的' : '上一次的') + '数据。';
    if (source?.status === 'partial') message = label + ' 本次仅获取了部分搜索结果。';
    if (!source || source.status === 'unavailable') message = label + ' 本次采集不可用。';
    if (message) alerts.append(element('p', 'alert', message));
  }
  const generated = localDate(feed.generatedAt);
  if (generated) details.append(element('p', '', '简报生成于 ' + generated + '（北京时间）'));
}

async function load() {
  cards.setAttribute('aria-busy', 'true');
  cards.replaceChildren(element('p', 'state', '正在读取简报…'));
  try {
    const response = await fetch('./data/latest.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('feed unavailable');
    const data = await response.json();
    if (!Array.isArray(data.items) || !Array.isArray(data.topics)) throw new Error('invalid feed');
    feed = data;
    topicNames = new Map(feed.topics.map((topic) => [topic.id, topic.label]));
    for (const [id, label] of topicNames) topicBox.add(new Option(label, id));
    showMetadata();
    renderFeed();
  } catch {
    cards.setAttribute('aria-busy', 'false');
    cards.replaceChildren(state('暂时无法读取简报', '请确认数据文件已生成，并通过网页服务器访问。', '重新读取', load));
    $('#edition-text').textContent = '简报尚未载入';
    $('#source-times').textContent = '简报尚未载入。';
    $('#result-status').textContent = '简报加载失败。';
  }
}

for (const button of document.querySelectorAll('[data-source]')) {
  button.addEventListener('click', () => { platform = button.dataset.source; limit = pageSize; renderFeed(); });
}
searchBox.addEventListener('input', () => { limit = pageSize; renderFeed(); });
topicBox.addEventListener('change', () => { limit = pageSize; renderFeed(); });
$('#more').addEventListener('click', () => {
  const previous = limit;
  limit += pageSize;
  renderFeed();
  cards.children[previous]?.querySelector('a')?.focus();
});
const method = $('#method');
$('#method-open').addEventListener('click', () => method.showModal());
$('#close-method').addEventListener('click', () => method.close());
method.addEventListener('click', (event) => {
  if (event.target !== method) return;
  const bounds = method.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) method.close();
});
load();
