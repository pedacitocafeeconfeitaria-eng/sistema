// Roteador e layouts.
import { api, clearMemo, sb, carregarSessao } from './api.js';
import { h, icon, brand, destroyCharts, alertBox, loading } from './ui.js';

const root = document.getElementById('app');
export const session = { user: null };

// Rotas por hash (#/cozinha): funciona em qualquer hospedagem estática.
export const rotaAtual = () => { const h = location.hash.replace(/^#/, '') || '/'; return h.split('?')[0]; };
export const rotaQuery = () => new URLSearchParams((location.hash.split('?')[1]) || '');
new MutationObserver(() => { document.querySelectorAll('a[href^="/"]').forEach((a) => a.setAttribute('href', '#' + a.getAttribute('href'))); })
  .observe(document.documentElement, { childList: true, subtree: true });

// Telas públicas (equipe das lojas, sem login)
const PUBLIC = {
  '/': () => import('./pages/portal.js'),
  '/cozinha': () => import('./pages/form-cozinha.js'),
  '/balcao': () => import('./pages/form-balcao.js'),
  '/movimentacao': () => import('./pages/form-movimentacao.js'),
  '/lista': () => import('./pages/form-lista.js'),
  '/denuncia': () => import('./pages/form-denuncia.js'),
  '/login': () => import('./pages/login.js'),
};

// Telas da gestão (com login). area = permissão exigida.
const GESTAO = [
  { re: /^\/gestao\/?$/, area: 'dashboard', load: () => import('./pages/dashboard.js') },
  { re: /^\/gestao\/lancamentos$/, area: 'financeiro', load: () => import('./pages/lancamentos.js') },
  { re: /^\/gestao\/financeiro\/(villa|souza-cruz|grupo)$/, area: 'financeiro', load: () => import('./pages/financeiro.js') },
  { re: /^\/gestao\/projecoes$/, area: 'projecoes', load: () => import('./pages/projecoes.js') },
  { re: /^\/gestao\/operacao\/(producao|desperdicio|ambos)$/, area: 'operacao', load: () => import('./pages/operacao.js') },
  { re: /^\/gestao\/estoque$/, area: 'estoque', load: () => import('./pages/estoque-lista.js') },
  { re: /^\/gestao\/estoque\/dashboard$/, area: 'estoque', load: () => import('./pages/estoque-dashboard.js') },
  { re: /^\/gestao\/compras(?:\/(pedidos|sugestao|fornecedores|cotacoes))?$/, area: 'compras', load: () => import('./pages/compras.js') },
  { re: /^\/gestao\/fichas$/, area: 'fichas', load: () => import('./pages/fichas.js') },
  { re: /^\/gestao\/cadastros\/(produtos|insumos)$/, area: 'cadastros', load: () => import('./pages/cadastros.js') },
  { re: /^\/gestao\/pessoas(?:\/(equipe|ocorrencias|ferias|documentos))?$/, area: 'rh', load: () => import('./pages/pessoas.js') },
  { re: /^\/gestao\/contratos$/, area: 'contratos', load: () => import('./pages/contratos.js') },
  { re: /^\/gestao\/denuncias$/, area: 'denuncias', load: () => import('./pages/denuncias.js') },
  { re: /^\/gestao\/config$/, area: 'config', load: () => import('./pages/config.js') },
];

const NAV = [
  ['Visão geral', [
    { area: 'dashboard', label: 'Painel', icon: 'home', href: '/gestao' },
  ]],
  ['Operação', [
    { area: 'operacao', label: 'Produção e perdas', icon: 'chef', href: '/gestao/operacao/ambos', sub: [['Visão geral', '/gestao/operacao/ambos'], ['Produção', '/gestao/operacao/producao'], ['Desperdício', '/gestao/operacao/desperdicio']] },
    { area: 'estoque', label: 'Estoque', icon: 'box', href: '/gestao/estoque', sub: [['Saldos', '/gestao/estoque'], ['Indicadores', '/gestao/estoque/dashboard']] },
    { area: 'compras', label: 'Compras', icon: 'cart', href: '/gestao/compras/pedidos', sub: [['Pedidos', '/gestao/compras/pedidos'], ['Sugestão de compra', '/gestao/compras/sugestao'], ['Fornecedores', '/gestao/compras/fornecedores'], ['Cotações e preços', '/gestao/compras/cotacoes']] },
    { area: 'fichas', label: 'Fichas técnicas', icon: 'clipboard', href: '/gestao/fichas' },
    { area: 'cadastros', label: 'Cadastros', icon: 'tag', href: '/gestao/cadastros/produtos', sub: [['Produtos de venda', '/gestao/cadastros/produtos'], ['Insumos', '/gestao/cadastros/insumos']] },
  ]],
  ['Financeiro', [
    { area: 'financeiro', label: 'Lançamentos', icon: 'money', href: '/gestao/lancamentos' },
    { area: 'financeiro', label: 'Resultados', icon: 'trend', href: '/gestao/financeiro/grupo', sub: [['Grupo', '/gestao/financeiro/grupo'], ['Villa', '/gestao/financeiro/villa'], ['Souza Cruz', '/gestao/financeiro/souza-cruz']] },
    { area: 'projecoes', label: 'Projeções', icon: 'calendar', href: '/gestao/projecoes' },
  ]],
  ['Pessoas e documentos', [
    { area: 'rh', label: 'Gestão de pessoas', icon: 'users', href: '/gestao/pessoas/equipe', sub: [['Equipe', '/gestao/pessoas/equipe'], ['Ocorrências', '/gestao/pessoas/ocorrencias'], ['Férias', '/gestao/pessoas/ferias'], ['Documentos', '/gestao/pessoas/documentos']] },
    { area: 'contratos', label: 'Contratos', icon: 'file', href: '/gestao/contratos' },
    { area: 'denuncias', label: 'Denúncias', icon: 'shield', href: '/gestao/denuncias' },
  ]],
  ['Sistema', [
    { area: 'config', label: 'Configurações', icon: 'gear', href: '/gestao/config' },
  ]],
];

export function navigate(path, replace = false) {
  path = String(path).replace(/^#/, '');
  if (replace) { history.replaceState({}, '', '#' + path); render(); }
  else if (location.hash === '#' + path) render();
  else location.hash = path;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('hashchange', render);
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { session.user = null; clearMemo(); } });

export async function refreshSession() {
  session.user = await carregarSessao();
}

export async function logout() {
  await sb.auth.signOut();
  session.user = null;
  clearMemo();
  navigate('/login');
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  destroyCharts();
  const path = rotaAtual().replace(/\/+$/, '') || '/';
  window.scrollTo(0, 0);

  if (PUBLIC[path]) {
    // Fora da rede da loja, os formulários pedem o código da equipe (uma vez por aparelho).
    if (path !== '/login' && path !== '/denuncia') {
      const acesso = await api.get('/api/public/acesso').catch(() => ({ precisaCodigo: false }));
      if (token !== renderToken) return;
      if (acesso.precisaCodigo) {
        const { render: telaCodigo } = await import('./pages/codigo.js');
        root.replaceChildren();
        return telaCodigo(root, { onOk: render });
      }
    }
    const mod = await PUBLIC[path]();
    if (token !== renderToken) return;
    root.replaceChildren();
    await mod.render(root, { navigate });
    return;
  }

  if (!path.startsWith('/gestao')) return navigate('/', true);
  if (!session.user) await refreshSession().catch(() => {});
  if (!session.user) return navigate(`/login?next=${encodeURIComponent(path)}`, true);

  const route = GESTAO.find((r) => r.re.test(path));
  const main = h('main', { class: 'main' });
  root.replaceChildren(shell(path, main));
  if (!route) { main.append(alertBox('Página não encontrada.')); return; }
  if (session.user.role === 'pendente') { main.append(alertBox(`Sua conta (${session.user.email}) foi criada e está aguardando o administrador liberar o acesso.`, 'warn')); return; }
  if (!session.user.areas.includes(route.area)) { main.append(alertBox('Seu usuário não tem acesso a esta área.', 'warn')); return; }
  main.append(loading('Abrindo...'));
  const mod = await route.load();
  if (token !== renderToken) return;
  main.replaceChildren();
  try {
    await mod.render(main, { match: path.match(route.re), navigate, session });
  } catch (e) {
    main.append(alertBox(e.message));
  }
}

function shell(path, main) {
  const areas = session.user.areas;
  const grupos = NAV.map(([titulo, itens]) => {
    const vis = itens.filter((n) => areas.includes(n.area));
    if (!vis.length) return null;
    return h('nav', { class: 'nav-group' }, h('div', { class: 'nav-title' }, titulo), vis.map((n) => {
      const active = path === n.href || (n.sub && n.sub.some(([, href]) => path === href));
      return h('div', {},
        h('a', { class: `nav-link${active && !n.sub ? ' active' : ''}${active && n.sub ? ' open' : ''}`, href: n.href, 'data-link': true }, icon(n.icon), n.label),
        n.sub && active ? h('div', { class: 'nav-sub' }, n.sub.map(([label, href]) => h('a', { class: `nav-link${path === href ? ' active' : ''}`, href, 'data-link': true }, label))) : null);
    }));
  });
  const el = h('div', { class: 'shell' });
  const iniciais = session.user.username.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'sidebar-brand' }, brand()),
    h('div', { class: 'sidebar-scroll' }, grupos,
      h('nav', { class: 'nav-group' }, h('div', { class: 'nav-title' }, 'Lojas'),
        h('a', { class: 'nav-link', href: '/', 'data-link': true }, icon('clipboard'), 'Formulários da equipe'))),
    h('div', { class: 'sidebar-foot' },
      h('div', { class: 'avatar' }, iniciais),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { class: 'who' }, session.user.username), h('div', { class: 'role' }, session.user.label)),
      h('button', { class: 'icon-btn light', title: 'Sair', onClick: logout }, icon('logout'))));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) el.classList.remove('nav-open'); });
  const mobile = h('div', { class: 'mobile-bar' }, brand(), h('button', { onClick: () => el.classList.toggle('nav-open'), 'aria-label': 'Menu' }, icon('menu')));
  el.append(sidebar, h('div', { class: 'content' }, mobile, main));
  return el;
}

render();
