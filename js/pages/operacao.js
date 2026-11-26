// Operação: produção, desperdício e eficiência.
import { loadData } from '../api.js';
import { h, kpi, card, barList, chart, table, filterBar, rangeOf, inRange, brl, num, pct, dataBR, sum, groupSum, loading, alertBox, empty, seg } from '../ui.js';
import { pageHeader, atualizadoEm, serieTemporal } from './_painel.js';

const TITULOS = { producao: 'Produção', desperdicio: 'Desperdício', ambos: 'Produção + Desperdício' };

export async function render(main, { match, navigate }) {
  const mode = match[1];
  const st = { preset: 'mes', loja: '', categoria: '', origem: '' };
  pageHeader(main, { title: `Operação · ${TITULOS[mode]}`, sub: 'Produção, desperdícios e performance diária', onRefresh: () => carregar(true) });
  main.append(h('div', { style: { maxWidth: '520px', marginBottom: '14px' } },
    seg([{ value: 'ambos', label: 'Visão geral' }, { value: 'producao', label: 'Produção' }, { value: 'desperdicio', label: 'Desperdício' }], mode, (v) => navigate(`/gestao/operacao/${v}`), { compact: true })));
  const filtros = h('div');
  const area = h('div', {}, loading());
  main.append(filtros, area);
  let dados;

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try {
      dados = await loadData('operacao', force);
      const cats = [...new Set([...dados.producao.map((p) => p.categoria), ...dados.desperdicio.map((d) => d.tipo)].filter((c) => c && c !== 'Não definido' && c !== 'Sem categoria' && c !== 'Cozinha'))].sort();
      filtros.replaceChildren(filterBar(st, [
        { key: 'loja', label: 'Loja', all: 'Todas', options: ['Villa', 'Souza Cruz'] },
        { key: 'categoria', label: 'Categoria', all: 'Todas', options: cats },
        ...(mode !== 'producao' ? [{ key: 'origem', label: 'Origem desperdício', all: 'Loja e cozinha', options: ['Loja', 'Cozinha'] }] : []),
      ], desenhar));
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.message));
    }
  }

  function desenhar() {
    const range = rangeOf(st);
    const prod = dados.producao.filter((p) => inRange(p.data, range) && (!st.loja || p.loja === st.loja) && (!st.categoria || p.categoria === st.categoria));
    const desp = dados.desperdicio.filter((d) => d.produto && inRange(d.data, range) && (!st.loja || d.loja === st.loja) && (!st.categoria || d.tipo === st.categoria) && (!st.origem || d.origem === st.origem));
    const qP = sum(prod, (p) => p.quantidade);
    const vP = sum(prod, (p) => p.valor);
    const qD = sum(desp, (d) => d.quantidade);
    const vD = sum(desp, (d) => d.valor);
    const perda = qP > 0 ? (qD / qP) * 100 : 0;

    const topProd = groupSum(prod, (p) => p.produto, (p) => p.quantidade);
    const topPerdaValor = groupSum(desp, (d) => d.produto, (d) => d.valor);
    const topPerdaQtd = groupSum(desp, (d) => d.produto, (d) => d.quantidade);
    const motivos = groupSum(desp.filter((d) => d.motivo), (d) => d.motivo.trim().toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 60), () => 1);

    // Eficiência por produto
    const ef = new Map();
    for (const p of prod) { const o = ef.get(p.produto) || { produto: p.produto, prod: 0, perda: 0 }; o.prod += p.quantidade; ef.set(p.produto, o); }
    for (const d of desp) { const o = ef.get(d.produto) || { produto: d.produto, prod: 0, perda: 0 }; o.perda += d.quantidade; ef.set(d.produto, o); }
    const eficiencia = [...ef.values()].map((o) => ({ ...o, taxa: o.prod ? (o.perda / o.prod) * 100 : o.perda ? 100 : 0 })).sort((a, b) => b.prod - a.prod);
    const maisEficiente = eficiencia.filter((e) => e.prod >= 10).sort((a, b) => a.taxa - b.taxa || b.prod - a.prod)[0];

    // Série diária
    const serie = serieTemporal([...prod, ...desp].map((x) => x.data));
    const porDia = new Map();
    for (const p of prod) if (p.data) { const k = serie.chave(p.data); const o = porDia.get(k) || { p: 0, d: 0 }; o.p += p.quantidade; porDia.set(k, o); }
    for (const d of desp) if (d.data) { const k = serie.chave(d.data); const o = porDia.get(k) || { p: 0, d: 0 }; o.d += d.quantidade; porDia.set(k, o); }
    const ks = [...porDia.keys()].sort();

    // Por categoria
    const cats = [...new Set([...prod.map((p) => p.categoria), ...desp.map((d) => d.tipo)])].filter((c) => c && c !== 'Não definido');
    const catP = (c) => sum(prod.filter((p) => p.categoria === c), (p) => p.quantidade);
    const catD = (c) => sum(desp.filter((d) => d.tipo === c), (d) => d.quantidade);

    const verP = mode !== 'desperdicio';
    const verD = mode !== 'producao';
    const blocos = [];
    blocos.push(h('div', { class: 'page-sub', style: { margin: '-6px 0 14px' } }, atualizadoEm(dados.atualizadoEm)));

    if (mode === 'ambos') {
      blocos.push(h('div', { class: 'grid g4' },
        kpi({ label: 'Produção total', value: num(qP), hint: `${num(prod.length)} registros`, tone: 'revenue', big: true }),
        kpi({ label: 'Desperdício total', value: num(qD), hint: `${num(desp.length)} registros`, tone: 'expense', big: true }),
        kpi({ label: '% de perda', value: pct(perda), hint: 'Desperdício ÷ produção (qtd)', tone: perda > 10 ? 'expense' : perda > 5 ? 'warning' : 'revenue', big: true }),
        kpi({ label: 'Custo do desperdício', value: brl(vD), hint: `Valor produzido ${brl(vP)}`, tone: 'coral', big: true })));
    }
    if (mode === 'producao') {
      blocos.push(h('div', { class: 'grid g4' },
        kpi({ label: 'Produção total', value: num(qP), hint: 'Unidades', tone: 'revenue', big: true }),
        kpi({ label: 'Valor produzido', value: brl(vP), hint: 'Soma do valor', tone: 'revenue', big: true }),
        kpi({ label: 'Valor médio por unidade', value: qP ? brl(vP / qP) : '—', tone: 'info', big: true }),
        kpi({ label: 'Produtos produzidos', value: num(new Set(prod.map((p) => p.produto)).size), hint: 'Itens distintos', tone: 'sage', big: true })));
    }
    if (mode === 'desperdicio') {
      blocos.push(h('div', { class: 'grid g4' },
        kpi({ label: 'Desperdício total', value: num(qD), hint: 'Unidades', tone: 'expense', big: true }),
        kpi({ label: 'Custo do desperdício', value: brl(vD), hint: 'Soma do valor perdido', tone: 'expense', big: true }),
        kpi({ label: 'Produtos com perda', value: num(new Set(desp.map((d) => d.produto)).size), hint: 'Itens distintos', tone: 'warning', big: true }),
        kpi({ label: 'Motivos distintos', value: num(motivos.length), hint: 'Top motivos abaixo', tone: 'sage', big: true })));
    }
    blocos.push(h('div', { class: 'grid g3', style: { marginTop: '16px' } },
      kpi({ label: 'Mais produzido', value: topProd[0]?.name || '—', hint: topProd[0] ? `${num(topProd[0].value)} unidades` : '', tone: 'revenue' }),
      kpi({ label: 'Maior desperdício', value: topPerdaValor[0]?.name || '—', hint: topPerdaValor[0] ? brl(topPerdaValor[0].value) : '', tone: 'expense' }),
      kpi({ label: 'Mais eficiente', value: maisEficiente?.produto || '—', hint: maisEficiente ? `${pct(maisEficiente.taxa)} de perda · ${num(maisEficiente.prod)} produzidos` : 'Mín. 10 unidades', tone: 'info' })));

    blocos.push(h('div', { class: 'grid g2', style: { marginTop: '16px' } },
      card({ title: verP && verD ? 'Produção × desperdício' : verP ? 'Produção no período' : 'Desperdício no período', desc: 'Quantidade unitária', cls: 'span2' }, ks.length ? chart('line', {
        labels: ks.map(serie.label),
        datasets: [
          ...(verP ? [{ label: 'Produção', data: ks.map((k) => porDia.get(k).p), borderColor: '#3f8a5c', backgroundColor: 'rgba(63,138,92,.12)', fill: true, tension: 0.35, pointRadius: 2 }] : []),
          ...(verD ? [{ label: 'Desperdício', data: ks.map((k) => porDia.get(k).d), borderColor: '#ff6b73', backgroundColor: 'rgba(255,107,115,.12)', fill: true, tension: 0.35, pointRadius: 2 }] : []),
        ],
      }, {}, { cls: 'tall' }) : empty()),
      verP ? card({ title: 'Top produtos produzidos', desc: 'Quantidade total por produto' }, barList(topProd, { fmt: num, limit: 12, color: 'var(--revenue)' })) : null,
      verD ? card({ title: 'Ranking de perdas', desc: 'Top produtos por valor de desperdício' }, barList(topPerdaValor.length && topPerdaValor[0].value ? topPerdaValor : topPerdaQtd, { fmt: topPerdaValor[0]?.value ? brl : num, limit: 12, color: 'var(--expense)' })) : null,
      cats.length ? card({ title: 'Produção vs perda por categoria', desc: 'Doce, Salgado, Bolo, Cuca...' }, chart('bar', {
        labels: cats,
        datasets: [
          ...(verP ? [{ label: 'Produção', data: cats.map(catP), backgroundColor: '#3f8a5c', borderRadius: 5 }] : []),
          ...(verD ? [{ label: 'Desperdício', data: cats.map(catD), backgroundColor: '#ff6b73', borderRadius: 5 }] : []),
        ],
      })) : null,
      verD ? card({ title: 'Motivos mais frequentes', desc: 'Quantidade de registros por motivo' }, barList(motivos, { fmt: (v) => `${num(v)}×`, limit: 12, color: 'var(--warning)' })) : null,
      card({ title: 'Eficiência por produto', desc: 'Quantidade produzida, perdida e % de perda', cls: 'span2' }, table([
        { label: 'Produto', key: 'produto' },
        { label: 'Produzido', right: true, render: (e) => num(e.prod) },
        { label: 'Perdido', right: true, render: (e) => num(e.perda) },
        { label: '% perda', right: true, render: (e) => h('span', { class: `badge ${e.taxa > 10 ? 'danger' : e.taxa > 5 ? 'warn' : 'ok'}` }, pct(e.taxa)) },
      ], eficiencia.slice(0, 200)))));

    const recentes = [
      ...(verP ? prod.map((p) => ({ ...p, kind: 'Produção', motivo: p.observacao, tipo: p.categoria })) : []),
      ...(verD ? desp.map((d) => ({ ...d, kind: `Desperdício · ${d.origem}` })) : []),
    ].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 100);
    blocos.push(h('div', { class: 'section-title' }, 'Registros'),
      card({ title: 'Registros recentes', desc: 'Últimos 100 registros' }, table([
        { label: 'Data', render: (r) => dataBR(r.data) },
        { label: 'Registro', render: (r) => h('span', { class: `badge ${r.kind === 'Produção' ? 'ok' : 'danger'}` }, r.kind) },
        { label: 'Loja', key: 'loja' },
        { label: 'Turno', key: 'turno' },
        { label: 'Nome', key: 'nome' },
        { label: 'Produto', key: 'produto' },
        { label: 'Qtd', right: true, render: (r) => num(r.quantidade) },
        { label: 'Valor', right: true, render: (r) => brl(r.valor) },
        { label: 'Motivo / obs.', render: (r) => r.motivo || '—' },
      ], recentes)));
    area.replaceChildren(...blocos);
  }

  await carregar();
}
