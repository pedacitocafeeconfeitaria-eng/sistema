// Estoque: saldos, status e sugestão de compra.
import { loadData } from '../api.js';
import { h, kpi, card, table, filterBar, num, brl, loading, alertBox, toast, icon } from '../ui.js';
import { pageHeader, atualizadoEm } from './_painel.js';

const chave = (s) => (s || '').toLowerCase().trim();

// Saldo = Σ entradas − Σ saídas. Status: Zerado (≤0), Crítico (≤ mínimo), OK.
export function calcSaldos(base, movs, loja = '') {
  const saldo = new Map();
  for (const m of movs) {
    if (loja && m.loja !== loja) continue;
    const k = chave(m.produto);
    const q = m.tipo === 'Entrada' ? m.quantidade : m.tipo === 'Saída' ? -m.quantidade : 0;
    saldo.set(k, (saldo.get(k) || 0) + q);
  }
  return base.filter((p) => p.status === 'ATIVO').map((p) => {
    const s = Math.round((saldo.get(chave(p.produto)) || 0) * 1000) / 1000;
    const status = s <= 0 ? 'Zerado' : s <= p.estoqueMinimo ? 'Crítico' : 'OK';
    const alvo = Math.max(p.estoqueMinimo * 1.2, p.estoqueMinimo + 1);
    const sugestao = status === 'OK' ? 0 : Math.max(0, Math.ceil(alvo - s));
    return { ...p, saldo: s, status, sugestao };
  });
}

export const badgeStatus = (s) => h('span', { class: `badge ${s === 'OK' ? 'ok' : s === 'Crítico' ? 'warn' : 'danger'}` }, s);

export async function render(main) {
  const st = { preset: 'tudo', categoria: '', status: '', loja: '', ordem: 'status' };
  const copiar = h('button', { class: 'btn coral small' }, icon('copy'), 'Copiar lista de reposição');
  pageHeader(main, { title: 'Estoque', sub: 'Saldos, movimentações e reposição inteligente', onRefresh: () => carregar(true), actions: [copiar] });
  const filtros = h('div');
  const area = h('div', {}, loading());
  main.append(filtros, area);
  let dados;
  let linhas = [];

  copiar.addEventListener('click', async () => {
    const rep = linhas.filter((l) => l.sugestao > 0);
    if (!rep.length) return toast('Nenhum item precisa de reposição.', '');
    const texto = `*Lista de reposição · Pedacito*${st.loja ? ` (${st.loja})` : ''}\n${new Date().toLocaleDateString('pt-BR')}\n\n` + rep.map((l) => `• ${l.produto} — ${num(l.sugestao)} ${l.unidade}${l.status === 'Zerado' ? ' (zerado)' : ''}`).join('\n');
    try { await navigator.clipboard.writeText(texto); toast('Lista copiada. Pronto para colar no WhatsApp.', 'ok'); } catch { toast('Não foi possível copiar.', 'error'); }
  });

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try {
      dados = await loadData('estoque', force);
      const cats = [...new Set(dados.base.map((b) => b.categoria))].sort();
      filtros.replaceChildren(h('div', { class: 'filters' },
        ...filterBar(st, [
          { key: 'loja', label: 'Loja', all: 'Todas', options: ['Villa', 'Souza Cruz'] },
          { key: 'categoria', label: 'Categoria', all: 'Todas', options: cats },
          { key: 'status', label: 'Status', options: ['OK', 'Crítico', 'Zerado'] },
        ], desenhar).querySelectorAll('.field:not(:first-child)')));
      const ordem = h('select', { class: 'select', onChange: (e) => { st.ordem = e.target.value; desenhar(); } },
        [['status', 'Status (mais urgente)'], ['nome', 'Nome'], ['saldo', 'Menor saldo'], ['categoria', 'Categoria']].map(([v, l]) => h('option', { value: v }, l)));
      filtros.firstChild.append(h('label', { class: 'field' }, h('span', {}, 'Ordenar por'), ordem));
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.message));
    }
  }

  function desenhar() {
    const todos = calcSaldos(dados.base, dados.movs, st.loja);
    linhas = todos.filter((l) => (!st.categoria || l.categoria === st.categoria) && (!st.status || l.status === st.status));
    const peso = { Zerado: 0, Crítico: 1, OK: 2 };
    const ord = {
      status: (a, b) => peso[a.status] - peso[b.status] || a.produto.localeCompare(b.produto),
      nome: (a, b) => a.produto.localeCompare(b.produto),
      saldo: (a, b) => a.saldo - b.saldo,
      categoria: (a, b) => a.categoria.localeCompare(b.categoria) || a.produto.localeCompare(b.produto),
    }[st.ordem];
    linhas.sort(ord);
    area.replaceChildren(
      h('div', { class: 'page-sub', style: { margin: '-6px 0 14px' } }, `${atualizadoEm(dados.atualizadoEm)}${st.loja ? ` · saldos só da loja ${st.loja}` : ' · saldos somando as duas lojas'}`),
      h('div', { class: 'grid g4' },
        kpi({ label: 'Produtos', value: num(todos.length), hint: 'Ativos na base', tone: 'sage', big: true }),
        kpi({ label: 'Críticos', value: num(todos.filter((l) => l.status === 'Crítico').length), hint: 'No mínimo ou abaixo', tone: 'warning', big: true }),
        kpi({ label: 'Zerados', value: num(todos.filter((l) => l.status === 'Zerado').length), hint: 'Sem saldo', tone: 'expense', big: true }),
        kpi({ label: 'Valor em estoque', value: brl(todos.reduce((s, l) => s + Math.max(0, l.saldo) * l.valorUnidade, 0)), hint: 'Saldo × valor unitário', tone: 'revenue', big: true })),
      h('div', { style: { marginTop: '16px' } }, card({ title: 'Saldos por produto', desc: `${num(linhas.length)} produto(s) no filtro` }, table([
        { label: 'Produto', key: 'produto' },
        { label: 'Categoria', key: 'categoria' },
        { label: 'Saldo', right: true, render: (l) => `${num(l.saldo)} ${l.unidade}` },
        { label: 'Mínimo', right: true, render: (l) => `${num(l.estoqueMinimo)} ${l.unidade}` },
        { label: 'Status', render: (l) => badgeStatus(l.status) },
        { label: 'Sugestão de compra', right: true, render: (l) => (l.sugestao ? h('b', {}, `${num(l.sugestao)} ${l.unidade}`) : '—') },
        { label: 'Valor unit.', right: true, render: (l) => (l.valorUnidade ? brl(l.valorUnidade) : '—') },
      ], linhas, { maxHeight: false }))));
  }

  await carregar();
}
