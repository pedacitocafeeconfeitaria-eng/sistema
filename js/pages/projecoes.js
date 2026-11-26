// Projeções: contas a pagar, receitas previstas, empréstimos e fluxo futuro.
import { loadData } from '../api.js';
import { h, kpi, card, chart, table, select, field, brl, num, pct, dataBR, sum, loading, alertBox, hojeISO } from '../ui.js';
import { pageHeader, atualizadoEm } from './_painel.js';
import { emprestimos } from './financeiro.js';

const addDias = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (k) => `${MESES[+k.slice(5, 7) - 1]}/${k.slice(2, 4)}`;

export async function render(main) {
  const st = { horizonte: '90', loja: '', status: 'pendente', categoria: '' };
  pageHeader(main, { title: 'Projeções', sub: 'Receitas previstas, contas a pagar e compromissos de empréstimos', onRefresh: () => carregar(true) });
  const filtros = h('div', { class: 'filters' });
  const area = h('div', {}, loading());
  main.append(filtros, area);
  let dados;

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try {
      dados = await loadData('financeiro', force);
      const sel = (opts, key) => { const s = select(opts, { onChange: (e) => { st[key] = e.target.value; desenhar(); } }); s.value = st[key]; return s; };
      const cats = [...new Set([...dados.boletos, ...dados.movimentacoes].filter((m) => m.tipo === 'Despesa').map((m) => m.categoria))].sort();
      filtros.replaceChildren(
        field('Horizonte', sel([{ value: '30', label: 'Próximos 30 dias' }, { value: '60', label: 'Próximos 60 dias' }, { value: '90', label: 'Próximos 90 dias' }, { value: '180', label: 'Próximos 6 meses' }], 'horizonte')),
        field('Loja', sel([{ value: '', label: 'Todas' }, 'Villa', 'Souza Cruz'], 'loja')),
        field('Contas', sel([{ value: 'pendente', label: 'Pendentes' }, { value: 'vencido', label: 'Vencidas' }, { value: 'pago', label: 'Pagas' }], 'status')),
        field('Categoria', sel([{ value: '', label: 'Todas' }, ...cats], 'categoria')));
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.message));
    }
  }

  function desenhar() {
    const hoje = hojeISO();
    const fim = addDias(hoje, Number(st.horizonte));
    const daLoja = (m) => !st.loja || m.loja === st.loja;
    // Boletos + lançamentos de despesa sem duplicar (mesma data, nome e valor).
    const vistos = new Set();
    const contas = [...dados.boletos, ...dados.movimentacoes].filter((m) => {
      if (m.tipo !== 'Despesa' || !m.data || !daLoja(m) || (st.categoria && m.categoria !== st.categoria)) return false;
      const k = `${m.data}|${m.nome}|${m.valor}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    const pendentes = contas.filter((m) => m.status === 'Pendente');
    const futuras = pendentes.filter((m) => m.data >= hoje && m.data <= fim);
    const vencidas = pendentes.filter((m) => m.data < hoje);
    const receitasPrev = dados.movimentacoes.filter((m) => m.tipo === 'Receita' && m.status === 'Previsto' && m.data && m.data >= hoje && m.data <= fim && daLoja(m));
    const ativos = dados.emprestimos.filter((e) => e.status !== 'Quitado' && e.parcelasRestantes > 0);
    const nMeses = Math.max(1, Math.round(Number(st.horizonte) / 30));
    const parcelasFuturas = sum(ativos, (e) => e.valorParcela * Math.min(e.parcelasRestantes, nMeses));

    // Média de receita dos últimos 3 meses fechados (base da projeção)
    const recMes = new Map();
    for (const m of dados.movimentacoes) if (m.tipo === 'Receita' && m.data && daLoja(m) && m.status !== 'Previsto') recMes.set(m.data.slice(0, 7), (recMes.get(m.data.slice(0, 7)) || 0) + m.valor);
    const mesAtual = hoje.slice(0, 7);
    const fechados = [...recMes.keys()].filter((k) => k < mesAtual).sort().slice(-3);
    const mediaRec = fechados.length ? sum(fechados, (k) => recMes.get(k)) / fechados.length : 0;

    const receitaPrevista = receitasPrev.length ? sum(receitasPrev, (m) => m.valor) : mediaRec * nMeses;
    const despContas = sum(futuras, (m) => m.valor);
    const despesasFuturas = despContas + parcelasFuturas;
    const resultado = receitaPrevista - despesasFuturas;
    const compromet = receitaPrevista > 0 ? (despesasFuturas / receitaPrevista) * 100 : 0;

    // Fluxo mês a mês dentro do horizonte
    const mesesFut = [];
    for (let i = 0; i < Math.max(1, nMeses); i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); mesesFut.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const contasMes = (k) => sum(futuras.filter((m) => m.data.startsWith(k)), (m) => m.valor);
    const parcMes = (i) => sum(ativos.filter((e) => e.parcelasRestantes > i), (e) => e.valorParcela);
    const recPrevMes = (k) => { const r = sum(receitasPrev.filter((m) => m.data.startsWith(k)), (m) => m.valor); return r || (receitasPrev.length ? 0 : mediaRec); };
    let acumulado = 0;
    const saldoAcum = mesesFut.map((k, i) => (acumulado += recPrevMes(k) - contasMes(k) - parcMes(i)));

    const historico = [...recMes.keys()].filter((k) => k < mesAtual).sort().slice(-9);
    const listaContas = (st.status === 'vencido' ? vencidas : st.status === 'pago' ? contas.filter((m) => m.status === 'Pago').sort((a, b) => b.data.localeCompare(a.data)).slice(0, 200) : futuras).sort((a, b) => (st.status === 'pago' ? 0 : a.data.localeCompare(b.data)));

    area.replaceChildren(h('div', {},
      h('div', { class: 'page-sub', style: { margin: '-6px 0 14px' } }, `${atualizadoEm(dados.atualizadoEm)} · ${receitasPrev.length ? 'receita prevista lançada (status Previsto)' : `receita estimada pela média dos últimos ${fechados.length} mês(es): ${brl(mediaRec)}/mês`}`),
      h('div', { class: 'grid g4' },
        kpi({ label: 'Receita prevista', value: brl(receitaPrevista), hint: receitasPrev.length ? `${receitasPrev.length} lançamento(s) · status Previsto` : 'Estimativa pela média', tone: 'revenue', big: true }),
        kpi({ label: 'Despesas futuras', value: brl(despesasFuturas), hint: `${brl(despContas)} contas + ${brl(parcelasFuturas)} empréstimos`, tone: 'expense', big: true }),
        kpi({ label: 'Resultado projetado', value: brl(resultado), hint: resultado >= 0 ? 'Saldo positivo previsto' : 'Saldo negativo previsto', tone: resultado >= 0 ? 'revenue' : 'expense', big: true }),
        kpi({ label: 'Comprometimento', value: pct(compromet), hint: 'Despesas futuras ÷ receita prevista', tone: compromet > 70 ? 'expense' : compromet > 40 ? 'warning' : 'revenue', big: true })),
      vencidas.length ? h('div', { class: 'alert error', style: { marginTop: '16px' } }, h('b', {}, 'Alerta: '), `${vencidas.length} conta(s) pendente(s) com vencimento passado, somando ${brl(sum(vencidas, (m) => m.valor))}.`) : null,
      h('div', { class: 'grid g3', style: { marginTop: '16px' } }, [30, 60, 90].map((d) => {
        const lim = addDias(hoje, d);
        const c = pendentes.filter((m) => m.data >= hoje && m.data <= lim);
        const p = sum(ativos, (e) => e.valorParcela * Math.min(e.parcelasRestantes, Math.round(d / 30)));
        return card({ title: `Próximos ${d} dias` },
          h('div', { class: 'bar-list' },
            h('div', { class: 'bar-row' }, h('span', {}, `Boletos/contas (${c.length})`), h('b', { class: 'tabular' }, brl(sum(c, (m) => m.valor)))),
            h('div', { class: 'bar-row' }, h('span', {}, 'Parcelas de empréstimos'), h('b', { class: 'tabular' }, brl(p))),
            h('div', { class: 'bar-row', style: { borderTop: '1px solid var(--line)', paddingTop: '8px' } }, h('b', {}, 'Total comprometido'), h('b', { class: 'tabular', style: { color: 'var(--expense)' } }, brl(sum(c, (m) => m.valor) + p)))));
      })),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        card({ title: 'Fluxo financeiro futuro', desc: `Receita prevista, despesas e saldo acumulado — ${nMeses} mês(es)` }, chart('bar', {
          labels: mesesFut.map(rotuloMes),
          datasets: [
            { type: 'bar', label: 'Receita prevista', data: mesesFut.map(recPrevMes), backgroundColor: '#3f8a5c', borderRadius: 5 },
            { type: 'bar', label: 'Despesas', data: mesesFut.map((k, i) => contasMes(k) + parcMes(i)), backgroundColor: '#ff6b73', borderRadius: 5 },
            { type: 'line', label: 'Saldo acumulado', data: saldoAcum, borderColor: '#5b6b5e', backgroundColor: '#5b6b5e', tension: 0.3 },
          ],
        }, { money: true })),
        card({ title: 'Histórico vs projeção', desc: 'Faturamento mensal + projeção dos próximos meses' }, chart('line', {
          labels: [...historico, ...mesesFut].map(rotuloMes),
          datasets: [
            { label: 'Faturamento', data: [...historico.map((k) => recMes.get(k)), ...mesesFut.map(() => null)], borderColor: '#3f8a5c', backgroundColor: 'rgba(63,138,92,.12)', fill: true, tension: 0.3 },
            { label: 'Projeção', data: [...historico.map((k, i) => (i === historico.length - 1 ? recMes.get(k) : null)), ...mesesFut.map(recPrevMes)], borderColor: '#ff6b73', borderDash: [6, 5], tension: 0.3 },
          ],
        }, { money: true }))),
      emprestimos(dados.emprestimos, receitaPrevista / Math.max(1, nMeses)),
      h('div', { class: 'section-title' }, 'Calendário financeiro'),
      card({ title: st.status === 'vencido' ? 'Contas vencidas' : st.status === 'pago' ? 'Contas pagas (recentes)' : 'Próximos vencimentos', desc: 'Ordenados por data' }, table([
        { label: 'Vencimento', render: (m) => h('span', {}, dataBR(m.data), m.data < hoje && m.status === 'Pendente' ? h('span', { class: 'badge danger', style: { marginLeft: '6px' } }, 'vencido') : '') },
        { label: 'Loja', key: 'loja' },
        { label: 'Categoria', key: 'categoria' },
        { label: 'Descrição', key: 'nome' },
        { label: 'Pagamento', key: 'formaPagamento' },
        { label: 'Banco', key: 'banco' },
        { label: 'Valor', right: true, render: (m) => brl(m.valor) },
      ], listaContas, { emptyText: 'Nenhuma conta neste filtro.' }))));
  }

  await carregar();
}
