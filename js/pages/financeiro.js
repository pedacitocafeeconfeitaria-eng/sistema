// Financeiro por loja (Villa, Souza Cruz) ou Grupo.
import { loadData } from '../api.js';
import { h, kpi, card, barList, chart, table, progress, filterBar, rangeOf, inRange, mesesNoPeriodo, brl, num, pct, dataBR, sum, groupSum, loading, alertBox, empty, PALETA } from '../ui.js';
import { pageHeader, atualizadoEm, serieTemporal } from './_painel.js';

const LOJAS = { villa: 'Villa', 'souza-cruz': 'Souza Cruz', grupo: 'Grupo' };

export async function render(main, { match }) {
  const loja = LOJAS[match[1]];
  const st = { preset: 'mes', categoria: '', subcategoria: '', tipo: '', status: '' };
  const sub = h('span');
  pageHeader(main, {
    title: loja === 'Grupo' ? 'Financeiro · Grupo' : `Financeiro · ${loja}`,
    sub: loja === 'Grupo' ? 'Visão consolidada de todas as lojas' : `Receitas, despesas e indicadores da loja ${loja}`,
    onRefresh: () => carregar(true),
  });
  const filtros = h('div');
  const area = h('div', {}, loading());
  main.append(filtros, area);
  let dados;

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try {
      dados = await loadData('financeiro', force);
      desenharFiltros();
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(`Não foi possível carregar dados financeiros: ${e.message}`));
    }
  }

  const daLoja = (m) => loja === 'Grupo' || m.loja === loja;

  function desenharFiltros() {
    const base = dados.movimentacoes.filter(daLoja);
    const uniq = (f) => [...new Set(base.map(f).filter((v) => v && v !== '—'))].sort();
    filtros.replaceChildren(filterBar(st, [
      { key: 'tipo', label: 'Tipo', options: ['Receita', 'Despesa'] },
      { key: 'categoria', label: 'Categoria', all: 'Todas', options: uniq((m) => m.categoria) },
      { key: 'subcategoria', label: 'Subcategoria', all: 'Todas', options: uniq((m) => m.subcategoria) },
      { key: 'status', label: 'Status', options: uniq((m) => m.status) },
    ], desenhar));
  }

  function desenhar() {
    const range = rangeOf(st);
    const movs = dados.movimentacoes.filter((m) => daLoja(m) && inRange(m.data, range)
      && (!st.tipo || m.tipo === st.tipo) && (!st.categoria || m.categoria === st.categoria)
      && (!st.subcategoria || m.subcategoria === st.subcategoria) && (!st.status || m.status === st.status));
    const rec = movs.filter((m) => m.tipo === 'Receita');
    const desp = movs.filter((m) => m.tipo === 'Despesa');
    const receita = sum(rec, (m) => m.valor);
    const despesa = sum(desp, (m) => m.valor);
    const lucro = receita - despesa;
    const pedidos = sum(rec, (m) => m.pedidos);
    const funcs = dados.funcionarios.filter((f) => loja === 'Grupo' || f.loja === loja);
    const meses = mesesNoPeriodo(range, dados.movimentacoes.map((m) => m.data));
    const custoFunc = sum(funcs, (f) => f.custoMensal) * meses;

    // Série receita x despesa
    const serie = serieTemporal(movs.map((m) => m.data));
    const porData = new Map();
    for (const m of movs) {
      if (!m.data) continue;
      const k = serie.chave(m.data);
      const o = porData.get(k) || { r: 0, d: 0 };
      if (m.tipo === 'Receita') o.r += m.valor; else if (m.tipo === 'Despesa') o.d += m.valor;
      porData.set(k, o);
    }
    const ks = [...porData.keys()].sort();

    const porCategoria = groupSum(desp, (m) => m.categoria, (m) => m.valor);
    const porSub = groupSum(desp, (m) => (m.subcategoria !== '—' ? m.subcategoria : m.categoria), (m) => m.valor);
    const porForma = groupSum(desp, (m) => m.formaPagamento, (m) => m.valor);

    area.replaceChildren(h('div', {},
      h('div', { class: 'page-sub', style: { margin: '-8px 0 14px' } }, `${num(movs.length)} lançamentos no filtro · ${atualizadoEm(dados.atualizadoEm)}`),
      h('div', { class: 'grid g4' },
        kpi({ label: 'Receita total', value: brl(receita), tone: 'revenue', big: true }),
        kpi({ label: 'Despesas totais', value: brl(despesa), tone: 'expense', big: true }),
        kpi({ label: 'Lucro líquido', value: brl(lucro), hint: receita ? `Margem ${pct((lucro / receita) * 100)}` : '', tone: lucro >= 0 ? 'revenue' : 'expense', big: true }),
        kpi({ label: '% folha / receita', value: receita ? pct((custoFunc / receita) * 100) : '—', hint: `Custo funcionários ${brl(custoFunc)}`, tone: 'warning', big: true })),
      h('div', { class: 'grid g4', style: { marginTop: '16px' } },
        kpi({ label: 'Ticket médio', value: pedidos ? brl(receita / pedidos) : '—', hint: 'Receita ÷ pedidos', tone: 'info' }),
        kpi({ label: 'Total de pedidos', value: num(pedidos), hint: 'Soma de pedidos', tone: 'info' }),
        kpi({ label: 'Funcionários', value: num(funcs.length), hint: `${brl(sum(funcs, (f) => f.custoMensal))}/mês`, tone: 'sage' }),
        kpi({ label: 'Movimentações', value: num(movs.length), hint: 'Registros filtrados', tone: 'sage' })),

      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        card({ title: 'Receita vs Despesa', desc: 'Evolução no período', cls: 'span2' }, ks.length ? chart('bar', {
          labels: ks.map(serie.label),
          datasets: [
            { label: 'Receita', data: ks.map((k) => porData.get(k).r), backgroundColor: '#3f8a5c', borderRadius: 5 },
            { label: 'Despesa', data: ks.map((k) => porData.get(k).d), backgroundColor: '#ff6b73', borderRadius: 5 },
          ],
        }, { money: true }, { cls: 'tall' }) : empty()),
        card({ title: 'Despesas por categoria', desc: 'Top 12 · maior para menor' }, barList(porCategoria.map((c) => ({ ...c, extra: despesa ? pct((c.value / despesa) * 100) : '' })), { limit: 12, color: 'var(--coral)' })),
        card({ title: 'Gastos por subcategoria', desc: 'Principais fontes de gasto' }, barList(porSub, { limit: 12, color: 'var(--warning)' })),
        card({ title: 'Composição das despesas (%)', desc: 'Participação de cada categoria' }, porCategoria.length ? chart('doughnut', {
          labels: porCategoria.slice(0, 8).map((c) => c.name).concat(porCategoria.length > 8 ? ['Outros'] : []),
          datasets: [{ data: porCategoria.slice(0, 8).map((c) => c.value).concat(porCategoria.length > 8 ? [sum(porCategoria.slice(8), (c) => c.value)] : []), backgroundColor: PALETA, borderWidth: 2, borderColor: '#fffdf8' }],
        }, { money: true, cutout: '62%' }) : empty()),
        card({ title: 'Forma de pagamento', desc: 'Despesas por meio de pagamento' }, barList(porForma, { color: 'var(--info)' })),
        loja === 'Grupo' ? comparativoLojas(movs) : null,
        card({ title: 'Custo por funcionário', desc: 'Custo mensal · aba FUNCIONÁRIOS', cls: loja === 'Grupo' ? '' : 'span2' }, barList(funcs.map((f) => ({ name: `${f.nome} · ${f.cargo || '—'}${loja === 'Grupo' ? ` · ${f.loja}` : ''}`, value: f.custoMensal })).sort((a, b) => b.value - a.value), { limit: 40, color: 'var(--sage)' })),
        card({ title: '% sobre a receita', desc: 'Peso de cada categoria no faturamento', cls: 'span2' }, table([
          { label: 'Categoria', key: 'name' },
          { label: 'Valor', right: true, render: (r) => brl(r.value) },
          { label: '% da receita', right: true, render: (r) => (receita ? pct((r.value / receita) * 100) : '—') },
          { label: '% das despesas', right: true, render: (r) => (despesa ? pct((r.value / despesa) * 100) : '—') },
        ], porCategoria, { maxHeight: false }))),

      loja === 'Grupo' ? emprestimos(dados.emprestimos, receita) : null,

      h('div', { class: 'section-title' }, 'Lançamentos'),
      card({ title: 'Movimentações', desc: 'Mais recentes primeiro (até 300)' }, table([
        { label: 'Data', render: (m) => dataBR(m.data) },
        { label: 'Loja', key: 'loja' },
        { label: 'Tipo', render: (m) => h('span', { class: `badge ${m.tipo === 'Receita' ? 'ok' : 'danger'}` }, m.tipo) },
        { label: 'Categoria', key: 'categoria' },
        { label: 'Subcategoria', key: 'subcategoria' },
        { label: 'Nome', key: 'nome' },
        { label: 'Pagamento', key: 'formaPagamento' },
        { label: 'Status', key: 'status' },
        { label: 'Valor', right: true, render: (m) => brl(m.valor) },
      ], [...movs].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 300)))));
  }

  function comparativoLojas(movs) {
    const lojas = ['Villa', 'Souza Cruz'];
    const v = (l, t) => sum(movs.filter((m) => m.loja === l && m.tipo === t), (m) => m.valor);
    return card({ title: 'Comparativo por loja', desc: 'Receita, despesa e lucro' }, chart('bar', {
      labels: lojas,
      datasets: [
        { label: 'Receita', data: lojas.map((l) => v(l, 'Receita')), backgroundColor: '#3f8a5c', borderRadius: 6 },
        { label: 'Despesa', data: lojas.map((l) => v(l, 'Despesa')), backgroundColor: '#ff6b73', borderRadius: 6 },
        { label: 'Lucro', data: lojas.map((l) => v(l, 'Receita') - v(l, 'Despesa')), backgroundColor: '#5b6b5e', borderRadius: 6 },
      ],
    }, { money: true }));
  }

  await carregar();
}

export function emprestimos(lista, receita) {
  if (!lista.length) return null;
  const ativos = lista.filter((e) => e.status !== 'Quitado' && e.parcelasRestantes > 0);
  const saldo = sum(ativos, (e) => e.saldoDevedor);
  const parcela = sum(ativos, (e) => e.valorParcela);
  const pctRec = receita > 0 ? (parcela / receita) * 100 : 0;
  const pago = sum(lista, (e) => e.parcelasPagas * e.valorParcela);
  const finais = ativos.map((e) => e.dataFinal).filter(Boolean).sort();
  const mes = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '—');
  return h('div', {},
    h('div', { class: 'section-title' }, 'Empréstimos · controle de dívidas'),
    h('div', { class: 'grid g3' },
      kpi({ label: 'Saldo devedor total', value: brl(saldo), hint: `${ativos.length} empréstimo(s) ativo(s)`, tone: 'expense' }),
      kpi({ label: 'Parcela mensal total', value: brl(parcela), hint: 'Soma das parcelas ativas', tone: 'warning' }),
      kpi({ label: '% receita comprometida', value: pct(pctRec), hint: `Receita do período: ${brl(receita)}`, tone: pctRec > 30 ? 'expense' : pctRec > 15 ? 'warning' : 'revenue' }),
      kpi({ label: 'Total já pago', value: brl(pago), hint: 'Parcelas pagas × valor', tone: 'revenue' }),
      kpi({ label: 'Próxima quitação', value: mes(finais[0]), hint: 'Empréstimo que termina antes', tone: 'info' }),
      kpi({ label: 'Quitação total prevista', value: mes(finais[finais.length - 1]), hint: 'Quando todas as dívidas terminam', tone: 'sage' })),
    h('div', { class: 'grid g2', style: { marginTop: '16px' } },
      card({ title: 'Lista de empréstimos', desc: 'Status e progresso' }, table([
        { label: 'Nome', render: (e) => h('div', {}, h('b', {}, e.nome || '—'), e.credor ? h('div', { class: 'muted', style: { fontSize: '12px' } }, e.credor) : null) },
        { label: 'Saldo devedor', right: true, render: (e) => brl(e.saldoDevedor) },
        { label: 'Parcela', right: true, render: (e) => brl(e.valorParcela) },
        { label: 'Progresso', render: (e) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, progress(e.parcelasTotais ? (e.parcelasPagas / e.parcelasTotais) * 100 : 0), h('small', { class: 'muted tabular' }, `${e.parcelasPagas}/${e.parcelasTotais}`)) },
        { label: 'Status', render: (e) => h('span', { class: `badge ${e.status === 'Quitado' ? '' : 'warn'}` }, e.status) },
      ], [...lista].sort((a, b) => b.saldoDevedor - a.saldoDevedor))),
      card({ title: 'Ranking de saldo devedor', desc: 'Empréstimos com maior dívida' }, barList(ativos.map((e) => ({ name: e.nome || e.credor, value: e.saldoDevedor })).sort((a, b) => b.value - a.value), { color: 'var(--expense)' }))));
}
