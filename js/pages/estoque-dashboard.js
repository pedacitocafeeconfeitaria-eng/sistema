// Estoque: painel de movimentações e valores.
import { loadData } from '../api.js';
import { h, kpi, card, barList, chart, table, seg, select, field, num, brl, dataBR, sum, groupSum, loading, alertBox, empty, rangeOf, inRange } from '../ui.js';
import { pageHeader, atualizadoEm, serieTemporal } from './_painel.js';
import { calcSaldos, badgeStatus } from './estoque-lista.js';

export async function render(main) {
  const st = { preset: 'mes', loja: '' };
  pageHeader(main, { title: 'Estoque · Dashboard', sub: 'Entradas, saídas, consumo e investimento', onRefresh: () => carregar(true) });
  const lojaSel = select([{ value: '', label: 'Todas' }, 'Villa', 'Souza Cruz'], { onChange: (e) => { st.loja = e.target.value; desenhar(); } });
  main.append(h('div', { class: 'filters' },
    field('Período', seg([{ value: 'hoje', label: 'Hoje' }, { value: 'mes', label: 'Este mês' }, { value: 'ano', label: 'Este ano' }, { value: 'tudo', label: 'Tudo' }], st.preset, (v) => { st.preset = v; desenhar(); }, { compact: true })),
    field('Loja', lojaSel)));
  const area = h('div', {}, loading());
  main.append(area);
  let dados;

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try { dados = await loadData('estoque', force); desenhar(); } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    if (!dados) return;
    const range = rangeOf(st);
    const catDe = new Map(dados.base.map((b) => [b.produto.toLowerCase().trim(), b.categoria]));
    const movs = dados.movs.filter((m) => inRange(m.data, range) && (!st.loja || m.loja === st.loja));
    const ent = movs.filter((m) => m.tipo === 'Entrada');
    const sai = movs.filter((m) => m.tipo === 'Saída');
    const saldos = calcSaldos(dados.base, dados.movs, st.loja);
    const repor = saldos.filter((s) => s.sugestao > 0);
    const comprado = sum(ent, (m) => m.valorTotal);
    const consumido = sum(sai, (m) => m.valorTotal || m.quantidade * m.valorUnitario);
    const investimento = sum(saldos, (s) => Math.max(0, s.saldo) * s.valorUnidade);
    const compras = new Set(ent.map((m) => `${m.data}|${m.nome}|${m.loja}`)).size;

    const serie = serieTemporal(movs.map((m) => m.data));
    const porDia = new Map();
    for (const m of movs) {
      if (!m.data) continue;
      const k = serie.chave(m.data);
      const o = porDia.get(k) || { eq: 0, sq: 0, ev: 0, sv: 0 };
      if (m.tipo === 'Entrada') { o.eq += m.quantidade; o.ev += m.valorTotal; } else if (m.tipo === 'Saída') { o.sq += m.quantidade; o.sv += m.valorTotal; }
      porDia.set(k, o);
    }
    const ks = [...porDia.keys()].sort();

    area.replaceChildren(
      h('div', { class: 'page-sub', style: { margin: '-6px 0 14px' } }, atualizadoEm(dados.atualizadoEm)),
      h('div', { class: 'grid g6' },
        kpi({ label: 'Total de produtos', value: num(saldos.length), tone: 'sage' }),
        kpi({ label: 'Produtos críticos', value: num(saldos.filter((s) => s.status === 'Crítico').length), tone: 'warning' }),
        kpi({ label: 'Produtos zerados', value: num(saldos.filter((s) => s.status === 'Zerado').length), tone: 'expense' }),
        kpi({ label: 'Entradas', value: num(sum(ent, (m) => m.quantidade)), hint: `${num(ent.length)} lançamentos`, tone: 'revenue' }),
        kpi({ label: 'Saídas', value: num(sum(sai, (m) => m.quantidade)), hint: `${num(sai.length)} lançamentos`, tone: 'coral' }),
        kpi({ label: 'Itens p/ reposição', value: num(repor.length), tone: 'warning' })),
      h('div', { class: 'grid g4', style: { marginTop: '16px' } },
        kpi({ label: 'Valor comprado', value: brl(comprado), tone: 'revenue', big: true }),
        kpi({ label: 'Valor consumido', value: brl(consumido), tone: 'coral', big: true }),
        kpi({ label: 'Investimento em estoque', value: brl(investimento), hint: 'Saldo atual × valor unitário', tone: 'info', big: true }),
        kpi({ label: 'Ticket médio de compra', value: compras ? brl(comprado / compras) : '—', hint: `${num(compras)} compra(s)`, tone: 'sage', big: true })),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        card({ title: 'Evolução financeira', desc: 'Entradas vs saídas (R$)', cls: 'span2' }, ks.length ? chart('bar', {
          labels: ks.map(serie.label),
          datasets: [{ label: 'Entradas', data: ks.map((k) => porDia.get(k).ev), backgroundColor: '#3f8a5c', borderRadius: 5 }, { label: 'Saídas', data: ks.map((k) => porDia.get(k).sv), backgroundColor: '#ff6b73', borderRadius: 5 }],
        }, { money: true }, { cls: 'tall' }) : empty()),
        card({ title: 'Produtos com maior saída', desc: 'Top 8 por quantidade' }, barList(groupSum(sai, (m) => m.produto, (m) => m.quantidade), { fmt: num, limit: 8, color: 'var(--coral)' })),
        card({ title: 'Produtos com maior entrada', desc: 'Top 8 por quantidade' }, barList(groupSum(ent, (m) => m.produto, (m) => m.quantidade), { fmt: num, limit: 8, color: 'var(--revenue)' })),
        card({ title: 'Entradas vs saídas (quantidade)', desc: 'Por dia/mês' }, ks.length ? chart('line', {
          labels: ks.map(serie.label),
          datasets: [{ label: 'Entradas', data: ks.map((k) => porDia.get(k).eq), borderColor: '#3f8a5c', tension: 0.3, pointRadius: 2 }, { label: 'Saídas', data: ks.map((k) => porDia.get(k).sq), borderColor: '#ff6b73', tension: 0.3, pointRadius: 2 }],
        }) : empty()),
        card({ title: 'Categorias com maior investimento', desc: 'Soma do valor total das entradas' }, barList(groupSum(ent, (m) => catDe.get(m.produto.toLowerCase().trim()) || 'Sem categoria', (m) => m.valorTotal), { color: 'var(--info)' })),
        card({ title: 'Produtos com maior valor movimentado', desc: 'Ranking por valor total' }, barList(groupSum(movs, (m) => m.produto, (m) => m.valorTotal), { limit: 10, color: 'var(--sage)' })),
        card({ title: 'Sugestão de compra', desc: 'Produtos críticos e zerados' }, table([
          { label: 'Produto', key: 'produto' },
          { label: 'Saldo', right: true, render: (s) => `${num(s.saldo)} ${s.unidade}` },
          { label: 'Status', render: (s) => badgeStatus(s.status) },
          { label: 'Comprar', right: true, render: (s) => h('b', {}, `${num(s.sugestao)} ${s.unidade}`) },
        ], repor.sort((a, b) => a.saldo - b.saldo), { emptyText: 'Nada para repor. 🎉' }))),
      h('div', { class: 'section-title' }, 'Movimentações'),
      card({ title: 'Últimas movimentações', desc: 'Até 200 registros do período' }, table([
        { label: 'Data', render: (m) => dataBR(m.data) },
        { label: 'Tipo', render: (m) => h('span', { class: `badge ${m.tipo === 'Entrada' ? 'ok' : 'danger'}` }, m.tipo) },
        { label: 'Loja', key: 'loja' },
        { label: 'Produto', key: 'produto' },
        { label: 'Qtd', right: true, render: (m) => `${num(m.quantidade)} ${m.unidade || ''}` },
        { label: 'Valor unit.', right: true, render: (m) => brl(m.valorUnitario) },
        { label: 'Total', right: true, render: (m) => brl(m.valorTotal) },
        { label: 'Nome', key: 'nome' },
        { label: 'Obs.', render: (m) => m.observacao || '—' },
      ], [...movs].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 200))));
  }

  await carregar();
}
