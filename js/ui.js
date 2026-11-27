// Componentes de interface sem framework.

// Itens vazios (null/false) passados para append/replaceChildren são ignorados, em vez de virar o texto "null".
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false && n !== '')); };
}

// ---------- Criação de elementos ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

// ---------- Formatação ----------
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const brl = (v) => brlFmt.format(Number(v) || 0);
export const brlShort = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1).replace('.', ',')} mi`;
  if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1).replace('.', ',')} mil`;
  return brl(n);
};
export const num = (v) => numFmt.format(Number(v) || 0);
export const pct = (v, d = 1) => `${(Number(v) || 0).toFixed(d).replace('.', ',')}%`;
export const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
export const diaSemana = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return DIAS[new Date(y, m - 1, d).getDay()]; };
export const parseNum = (v) => { const t = String(v ?? '').replace(/[R$\s]/g, ''); if (!t) return 0; const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : 0; };
export const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
export function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x) || '—'; m.set(k, (m.get(k) || 0) + (valFn(x) || 0)); }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// ---------- Ícones (traço simples) ----------
const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
export const icons = {
  cake: I('<path d="M4 21V13a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8"/><path d="M4 16c1.5 1.5 3 1.5 4 0s2.5-1.5 4 0 2.5 1.5 4 0 2.5-1.5 4 0"/><path d="M2 21h20"/><path d="M12 11V8"/><path d="M12 4.5c.8 0 1.5.7 1.5 1.5S12.8 8 12 8s-1.5-.7-1.5-1.5S11.2 4.5 12 4.5z"/>'),
  home: I('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  money: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  trend: I('<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>'),
  chef: I('<path d="M6 13.9A4 4 0 0 1 7 6a5 5 0 0 1 10 0 4 4 0 0 1 1 7.9V20H6z"/><path d="M6 17h12"/>'),
  box: I('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>'),
  tag: I('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  shield: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  cart: I('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>'),
  clipboard: I('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h4"/>'),
  arrows: I('<path d="M7 4v16M7 4 3 8M7 4l4 4"/><path d="M17 20V4M17 20l-4-4M17 20l4-4"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>'),
  menu: I('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  check: I('<path d="M20 6 9 17l-5-5"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  trash: I('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  lock: I('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  calendar: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
  users: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3.2 4 1.8 4.5 4.5"/>'),
  file: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  logout: I('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  bell: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  download: I('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  camera: I('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
};
export const icon = (name) => svg(icons[name] || icons.cake);

export function brand({ light = true } = {}) {
  return h('a', { class: 'brand', href: '/', 'data-link': true, style: { color: light ? '#fff' : 'var(--ink)' } },
    h('div', { class: 'brand-mark', style: { color: '#fff' } }, icon('cake')),
    h('div', {}, h('div', { class: 'brand-name' }, 'Pedacito'), h('div', { class: 'brand-sub' }, 'Café e Confeitaria')));
}

// ---------- Feedback ----------
export function toast(msg, type = '') {
  const el = h('div', { class: `toast ${type}` }, msg);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}
export const loading = (txt = 'Carregando dados...') => h('div', { class: 'loading' }, h('div', { class: 'spinner' }), txt);
export const alertBox = (msg, kind = 'error') => h('div', { class: `alert ${kind}` }, msg);
export const empty = (txt = 'Sem registros no período.') => h('div', { class: 'empty' }, txt);

// ---------- Blocos ----------
export function kpi({ label, value, hint, tone = 'sage', big = false }) {
  return h('div', { class: `kpi t-${tone}${big ? ' big' : ''}` },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value tabular', title: String(value) }, value),
    hint ? h('div', { class: 'kpi-hint' }, hint) : null);
}

export function card({ title, desc, actions, cls = '' }, ...body) {
  return h('div', { class: `card ${cls}` },
    title ? h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title' }, title), desc ? h('div', { class: 'card-desc' }, desc) : null), actions || null) : null,
    ...body);
}

export function barList(items, { fmt = brl, color = 'var(--sage)', limit = 10, emptyText } = {}) {
  const list = items.slice(0, limit);
  if (!list.length) return empty(emptyText);
  const max = Math.max(...list.map((i) => Math.abs(i.value)), 1);
  return h('div', { class: 'bar-list' }, list.map((i) =>
    h('div', { class: 'bar-row' },
      h('div', { class: 'name', title: i.name }, i.name),
      h('div', { class: 'val' }, fmt(i.value), i.extra ? h('span', { class: 'muted', style: { fontWeight: 600, marginLeft: '6px' } }, i.extra) : null),
      h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(Math.abs(i.value) / max) * 100}%`, '--bar': i.color || color } })))));
}

export function table(columns, rows, { maxHeight = true, emptyText } = {}) {
  if (!rows.length) return empty(emptyText);
  // 'cards': no celular cada linha vira um cartão (rótulo à esquerda, valor à direita)
  const t = h('table', { class: 'tbl cards' },
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.right ? 'r' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return h('td', { class: c.right ? 'r' : '', 'data-label': c.label || '' }, v instanceof Node ? v : (v ?? '—'));
    })))));
  return h('div', { class: `table-wrap${maxHeight ? ' scroll-y' : ''}` }, t);
}

export function progress(p, color) {
  return h('div', { class: 'progress' }, h('div', { style: { width: `${Math.max(0, Math.min(100, p))}%`, background: color || 'var(--sage)' } }));
}

// ---------- Formulários ----------
export const field = (label, control, extra = {}) => h('label', { class: 'field', ...extra }, h('span', {}, label), control);
export const input = (attrs = {}) => h('input', { class: 'input', ...attrs });
export const textarea = (attrs = {}) => h('textarea', { class: 'textarea', ...attrs });
export function select(options, attrs = {}) {
  return h('select', { class: 'select', ...attrs },
    options.map((o) => (typeof o === 'string' ? h('option', { value: o }, o) : h('option', { value: o.value }, o.label))));
}
export function seg(options, value, onChange, { compact = false } = {}) {
  const el = h('div', { class: `seg${compact ? ' compact' : ''}` });
  const render = (v) => {
    el.replaceChildren(...options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      return h('button', { type: 'button', class: opt.value === v ? 'on' : '', onClick: () => { render(opt.value); onChange(opt.value); } }, opt.label);
    }));
  };
  render(value);
  return el;
}
export function radios(name, options, value, onChange) {
  return h('div', { class: 'radio-row' }, options.map((o) => h('label', { class: 'radio-pill' },
    h('input', { type: 'radio', name, value: o.value, checked: o.value === value, onChange: () => onChange(o.value) }), o.label)));
}

// Campo com busca (lista filtrável de produtos).
export function combo({ options = [], value = '', placeholder = 'Selecione', onSelect, disabled = false }) {
  let opts = options;
  let open = false;
  let hl = 0;
  const inp = input({ placeholder, value, autocomplete: 'off', disabled });
  const list = h('div', { class: 'combo-list hidden' });
  const wrap = h('div', { class: 'combo' }, inp, list);
  const filtered = () => {
    const q = inp.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const base = q ? opts.filter((o) => (o.label + ' ' + (o.sub || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)) : opts;
    return base.slice(0, 60);
  };
  const draw = () => {
    const f = filtered();
    list.replaceChildren(...(f.length ? f.map((o, i) => h('div', { class: `combo-opt${i === hl ? ' hl' : ''}`, onMousedown: (e) => { e.preventDefault(); pick(o); } }, h('span', {}, o.label), o.sub ? h('small', {}, o.sub) : null)) : [h('div', { class: 'combo-empty' }, 'Nenhum produto encontrado.')]));
    list.classList.toggle('hidden', !open);
  };
  const pick = (o) => { inp.value = o.label; open = false; draw(); onSelect && onSelect(o); };
  inp.addEventListener('focus', () => { open = true; hl = 0; inp.select(); draw(); });
  inp.addEventListener('blur', () => { open = false; draw(); });
  inp.addEventListener('input', () => { open = true; hl = 0; draw(); if (!inp.value) onSelect && onSelect(null); });
  inp.addEventListener('keydown', (e) => {
    const f = filtered();
    if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, f.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && open && f[hl]) { pick(f[hl]); e.preventDefault(); }
  });
  wrap.setOptions = (o) => { opts = o; draw(); };
  wrap.setDisabled = (d) => { inp.disabled = d; };
  wrap.setValue = (v) => { inp.value = v || ''; };
  wrap.setPlaceholder = (p) => { inp.placeholder = p; };
  return wrap;
}

// ---------- Gráficos (Chart.js) ----------
export const PALETA = ['#5b6b5e', '#ff6b73', '#c98a1b', '#3d7a99', '#8aa58f', '#b0697a', '#7d8f4e', '#e0a96d', '#6f5f8f', '#9aa9a0', '#d47f86', '#4f6f63'];
const charts = new Set();
export function destroyCharts() { charts.forEach((c) => c.destroy()); charts.clear(); }

export function chart(type, data, options = {}, { cls = '' } = {}) {
  const canvas = h('canvas');
  const box = h('div', { class: `chart-box ${cls}` }, canvas);
  if (!window.Chart) { box.append(alertBox('Biblioteca de gráficos não carregou.', 'warn')); return box; }
  const Chart = window.Chart;
  Chart.defaults.font.family = "'Nunito', system-ui, sans-serif";
  Chart.defaults.color = '#6d776f';
  const money = options.money;
  delete options.money;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    plugins: {
      legend: { display: data.datasets.length > 1 || type === 'doughnut', position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } },
      tooltip: { callbacks: { label: (ctx) => { const v = ctx.parsed?.y ?? ctx.parsed?.x ?? ctx.parsed; const val = typeof ctx.parsed === 'object' ? (ctx.chart.options.indexAxis === 'y' ? ctx.parsed.x : ctx.parsed.y) : v; return ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money ? brl(val) : num(val)}`; } } },
    },
    scales: type === 'doughnut' ? {} : {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12, callback: options.indexAxis === 'y' ? (v) => (money ? brlShort(v) : num(v)) : undefined } },
      y: { grid: { color: '#efeadf' }, ticks: { callback: options.indexAxis === 'y' ? function (v) { const l = this.getLabelForValue(v); return l.length > 24 ? l.slice(0, 23) + '…' : l; } : (v) => (money ? brlShort(v) : num(v)) } },
    },
  };
  requestAnimationFrame(() => {
    const c = new Chart(canvas, { type, data, options: deepMerge(base, options) });
    charts.add(c);
  });
  return box;
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}

// ---------- Períodos ----------
export const PERIODOS = [
  { value: 'hoje', label: 'Hoje' }, { value: '7d', label: 'Últimos 7 dias' }, { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mes', label: 'Este mês' }, { value: 'mes-1', label: 'Mês passado' }, { value: 'ano', label: 'Este ano' },
  { value: 'tudo', label: 'Todo o período' }, { value: 'custom', label: 'Personalizado' },
];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function rangeOf(p) {
  const now = new Date();
  const today = iso(now);
  if (p.preset === 'hoje') return [today, today];
  if (p.preset === '7d') { const d = new Date(now); d.setDate(d.getDate() - 6); return [iso(d), today]; }
  if (p.preset === '30d') { const d = new Date(now); d.setDate(d.getDate() - 29); return [iso(d), today]; }
  if (p.preset === 'mes') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), today];
  if (p.preset === 'mes-1') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (p.preset === 'ano') return [`${now.getFullYear()}-01-01`, today];
  if (p.preset === 'custom') return [p.from || null, p.to || null];
  return [null, null];
}
export const inRange = (d, [a, b]) => (!a || (d && d >= a)) && (!b || (d && d <= b));
export function mesesNoPeriodo([a, b], datas) {
  const lo = a || datas.filter(Boolean).sort()[0];
  const hi = b || hojeISO();
  if (!lo) return 1;
  return Math.max(1, (new Date(hi) - new Date(lo)) / 864e5 / 30 + 1 / 30);
}

// Barra de filtros com período + selects extras. Chama onChange(estado).
export function filterBar(state, extras, onChange) {
  const wrap = h('div', { class: 'filters' });
  const draw = () => {
    const per = select(PERIODOS, { onChange: (e) => { state.preset = e.target.value; draw(); onChange(); } });
    per.value = state.preset;
    const parts = [field('Período', per)];
    if (state.preset === 'custom') {
      parts.push(field('De', input({ type: 'date', value: state.from || '', onChange: (e) => { state.from = e.target.value; onChange(); } })));
      parts.push(field('Até', input({ type: 'date', value: state.to || '', onChange: (e) => { state.to = e.target.value; onChange(); } })));
    }
    for (const ex of extras) {
      const s = select([{ value: '', label: ex.all || 'Todos' }, ...ex.options.map((o) => ({ value: o, label: o }))], { onChange: (e) => { state[ex.key] = e.target.value; onChange(); } });
      s.value = state[ex.key] || '';
      parts.push(field(ex.label, s));
    }
    wrap.replaceChildren(...parts);
  };
  draw();
  return wrap;
}
