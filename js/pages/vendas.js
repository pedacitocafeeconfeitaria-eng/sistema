// Vendas (Raffinato): faturamento, nº de vendas, ticket médio e itens mais vendidos, por loja e dia.
import { sb } from '../api.js';
import { h, card, field, input, select, loading, alertBox, kpi, brl, dataBR, diaSemana, hojeISO, pct } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok } from '../crud.js';

const LOJAS = [{ value: '', label: 'As duas lojas' }, { value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : 'Souza Cruz');
const num = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const ontem = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };

export async function render(main) {
  const hoje = hojeISO();
  const st = { de: `${hoje.slice(0, 7)}-01`, ate: ontem() < `${hoje.slice(0, 7)}-01` ? hoje : ontem(), loja: '' };
  pageHeader(main, { title: 'Vendas', sub: 'Faturamento, ticket médio e itens vendidos, importados do Raffinato todo dia' });
  const area = h('div', {}, loading());
  main.append(area);

  async function carregar() {
    area.replaceChildren(loading());
    try {
      let q = sb.from('vendas_dia').select('*').gte('data', st.de).lte('data', st.ate).order('data');
      if (st.loja) q = q.eq('loja', st.loja);
      const dias = ok(await q);
      const itens = [];
      for (let de = 0; ; de += 1000) {
        let qi = sb.from('vendas').select('loja,produto_nome,grupo,quantidade,valor_total').eq('importacao_id', 'raffinato').gte('data', st.de).lte('data', st.ate).range(de, de + 999);
        if (st.loja) qi = qi.eq('loja', st.loja);
        const lote = ok(await qi); itens.push(...lote); if (lote.length < 1000) break;
      }
      desenhar(dias, itens);
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar(dias, itens) {
    const lojaSel = select(LOJAS, { onChange: (e) => { st.loja = e.target.value; carregar(); } }); lojaSel.value = st.loja;
    const filtros = h('div', { class: 'filters', style: { marginBottom: '14px' } },
      field('De', input({ type: 'date', value: st.de, onChange: (e) => { st.de = e.target.value; carregar(); } })),
      field('Até', input({ type: 'date', value: st.ate, onChange: (e) => { st.ate = e.target.value; carregar(); } })),
      field('Loja', lojaSel));
    if (!dias.length) { area.replaceChildren(filtros, h('div', { class: 'empty' }, 'Sem vendas importadas neste período.')); return; }
    const total = dias.reduce((s, d) => s + Number(d.total), 0); const qtd = dias.reduce((s, d) => s + Number(d.qtd_vendas), 0);
    const desc = dias.reduce((s, d) => s + Number(d.desconto), 0); const bruto = dias.reduce((s, d) => s + Number(d.bruto), 0);
    const nDias = new Set(dias.map((d) => d.data)).size;
    // por dia (somando lojas)
    const porDia = new Map(); dias.forEach((d) => { const x = porDia.get(d.data) || { VILLA: null, SOUZA_CRUZ: null }; x[d.loja] = d; porDia.set(d.data, x); });
    const pagto = {}; dias.forEach((d) => Object.entries(d.pagamentos || {}).forEach(([k, v]) => { pagto[k] = (pagto[k] || 0) + Number(v); }));
    const top = new Map(); itens.forEach((i) => { const k = i.produto_nome; const x = top.get(k) || { nome: k, grupo: i.grupo, q: 0, v: 0 }; x.q += Number(i.quantidade); x.v += Number(i.valor_total); top.set(k, x); });
    const grupos = new Map(); itens.forEach((i) => grupos.set(i.grupo || 'Outros', (grupos.get(i.grupo || 'Outros') || 0) + Number(i.valor_total)));
    const somaItens = itens.reduce((s, i) => s + Number(i.valor_total), 0);
    const ranking = [...top.values()].sort((a, b) => b.v - a.v);
    const lojasVis = st.loja ? [st.loja] : ['VILLA', 'SOUZA_CRUZ'];

    area.replaceChildren(filtros,
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Faturamento', value: brl(total), hint: `${nDias} dia(s) · média ${brl(total / nDias)}/dia`, tone: 'revenue' }),
        kpi({ label: 'Vendas', value: num(qtd), hint: `${num(qtd / nDias)} por dia` }),
        kpi({ label: 'Ticket médio', value: brl(qtd ? total / qtd : 0) }),
        kpi({ label: 'Descontos', value: brl(desc), hint: bruto ? `${pct((desc / bruto) * 100)} do bruto` : '', tone: 'warning' })),
      card({ title: 'Dia a dia' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Dia'), ...lojasVis.flatMap((l) => [h('th', { class: 'r' }, `${lojaNome(l)} · faturamento`), h('th', { class: 'r' }, 'vendas'), h('th', { class: 'r' }, 'ticket')]), lojasVis.length > 1 ? h('th', { class: 'r' }, 'Total') : null)),
        h('tbody', {}, [...porDia].reverse().map(([d, x]) => h('tr', {}, h('td', {}, `${diaSemana(d).slice(0, 3)} ${dataBR(d)}`),
          ...lojasVis.flatMap((l) => [h('td', { class: 'r' }, x[l] ? brl(x[l].total) : '—'), h('td', { class: 'r' }, x[l] ? String(x[l].qtd_vendas) : '—'), h('td', { class: 'r' }, x[l] ? brl(x[l].ticket_medio) : '—')]),
          lojasVis.length > 1 ? h('td', { class: 'r' }, h('b', {}, brl((Number(x.VILLA?.total) || 0) + (Number(x.SOUZA_CRUZ?.total) || 0)))) : null)))))),
      h('div', { class: 'grid g2', style: { marginTop: '14px' } },
        card({ title: 'Mais vendidos (valor)', desc: `${ranking.length} produtos diferentes` }, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Produto'), h('th', { class: 'r' }, 'Qtd'), h('th', { class: 'r' }, 'Valor'), h('th', { class: 'r' }, '%'))),
          h('tbody', {}, ranking.slice(0, 25).map((p) => h('tr', {}, h('td', {}, p.nome, h('div', { class: 'muted', style: { fontSize: '11.5px' } }, p.grupo || '')),
            h('td', { class: 'r' }, num(p.q)), h('td', { class: 'r' }, brl(p.v)), h('td', { class: 'r muted' }, somaItens ? pct((p.v / somaItens) * 100) : ''))))))),
        h('div', { class: 'form-stack' },
          card({ title: 'Por grupo de produto' }, h('div', { class: 'form-stack', style: { gap: '6px' } }, [...grupos].sort((a, b) => b[1] - a[1]).map(([g, v]) =>
            h('div', {}, h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' } }, h('span', {}, g), h('b', {}, brl(v))),
              h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${somaItens ? (v / somaItens) * 100 : 0}%` } })))))),
          card({ title: 'Formas de pagamento' }, h('div', { class: 'form-stack', style: { gap: '6px' } }, Object.entries(pagto).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13.5px' } }, h('span', {}, k), h('span', {}, h('b', {}, brl(v)), h('span', { class: 'muted' }, ` · ${pct((v / total) * 100)}`)))))))),
      h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Os números vêm dos relatórios do Raffinato (Movimento por Origem, Movimento de Vendas e Produtos Faturados). O faturamento de cada dia também entra no financeiro como receita, sem duplicar o que já foi lançado.'));
  }

  carregar();
}
