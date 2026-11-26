// Dashboard: visão geral do negócio (admin vê financeiro; gerente vê operação e estoque).
import { loadData } from '../api.js';
import { h, kpi, card, barList, chart, filterBar, rangeOf, inRange, mesesNoPeriodo, brl, num, pct, sum, groupSum, loading, alertBox, hojeISO } from '../ui.js';
import { pageHeader, avaliar, saudeGeral, STATUS_UI, ehCmv, ehProLabore, ehEmprestimo, serieTemporal } from './_painel.js';
import { calcSaldos } from './estoque-lista.js';

export async function render(main, { session }) {
  const admin = session.user.areas.includes('financeiro');
  const st = { preset: 'mes', loja: '' };
  const nome = session.user.username.charAt(0).toUpperCase() + session.user.username.slice(1);
  const hora = new Date().getHours();
  pageHeader(main, { title: `${hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'}, ${nome}!`, sub: 'Resumo da Pedacito no período selecionado', onRefresh: () => carregar(true) });
  const filtros = h('div');
  const area = h('div', {}, loading());
  main.append(filtros, area);
  let fin = null; let op = null; let est = null;

  async function carregar(force = false) {
    area.replaceChildren(loading());
    try {
      [fin, op, est] = await Promise.all([admin ? loadData('financeiro', force) : null, loadData('operacao', force), loadData('estoque', force).catch(() => null)]);
      filtros.replaceChildren(filterBar(st, [{ key: 'loja', label: 'Loja', all: 'Todas', options: ['Villa', 'Souza Cruz'] }], desenhar));
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.message));
    }
  }

  function desenhar() {
    const range = rangeOf(st);
    const daLoja = (x) => !st.loja || x.loja === st.loja;
    const prod = op.producao.filter((p) => daLoja(p) && inRange(p.data, range));
    const desp = op.desperdicio.filter((d) => d.produto && daLoja(d) && inRange(d.data, range));
    const vDesp = sum(desp, (d) => d.valor);
    const qP = sum(prod, (p) => p.quantidade);
    const qD = sum(desp, (d) => d.quantidade);
    const blocos = [];

    if (admin && fin) {
      const movs = fin.movimentacoes.filter((m) => daLoja(m) && inRange(m.data, range));
      const rec = movs.filter((m) => m.tipo === 'Receita');
      const dsp = movs.filter((m) => m.tipo === 'Despesa');
      const receita = sum(rec, (m) => m.valor);
      const despesa = sum(dsp, (m) => m.valor);
      const lucro = receita - despesa;
      const pedidos = sum(rec, (m) => m.pedidos);
      const meses = mesesNoPeriodo(range, fin.movimentacoes.map((m) => m.data));
      const folha = sum(fin.funcionarios.filter(daLoja), (f) => f.custoMensal) * meses;
      const p = (v) => (receita > 0 ? (v / receita) * 100 : 0);
      const cmv = sum(dsp.filter(ehCmv), (m) => m.valor);
      const pl = sum(dsp.filter(ehProLabore), (m) => m.valor);
      const emp = sum(dsp.filter(ehEmprestimo), (m) => m.valor);
      const metricas = [
        avaliar('cmv', p(cmv), cmv), avaliar('folha', p(folha), folha), avaliar('proLabore', p(pl), pl),
        avaliar('emprestimos', p(emp), emp), avaliar('desperdicio', p(vDesp), vDesp), avaliar('lucro', p(lucro), lucro),
      ];
      const geral = saudeGeral(metricas);

      // Próximos vencimentos
      const hoje = hojeISO();
      const em30 = new Date(); em30.setDate(em30.getDate() + 30);
      const lim = em30.toISOString().slice(0, 10);
      const pendentes = [...fin.boletos, ...fin.movimentacoes].filter((m) => m.tipo === 'Despesa' && m.status === 'Pendente' && m.data && daLoja(m));
      const aVencer = pendentes.filter((m) => m.data >= hoje && m.data <= lim);
      const vencidos = pendentes.filter((m) => m.data < hoje);

      // Receita por mês (últimos 12)
      const serie = serieTemporal(['2000-01-01', hoje]);
      const recMes = new Map();
      for (const m of fin.movimentacoes) if (m.tipo === 'Receita' && m.data && daLoja(m)) { const k = serie.chave(m.data); recMes.set(k, (recMes.get(k) || 0) + m.valor); }
      const despMes = new Map();
      for (const m of fin.movimentacoes) if (m.tipo === 'Despesa' && m.data && daLoja(m)) { const k = serie.chave(m.data); despMes.set(k, (despMes.get(k) || 0) + m.valor); }
      const meses12 = [...new Set([...recMes.keys(), ...despMes.keys()])].filter((k) => k <= hoje.slice(0, 7)).sort().slice(-12);

      blocos.push(
        h('div', { class: 'grid g4' },
          kpi({ label: 'Receita', value: brl(receita), hint: pedidos ? `${num(pedidos)} pedidos` : '', tone: 'revenue', big: true }),
          kpi({ label: 'Despesas', value: brl(despesa), tone: 'expense', big: true }),
          kpi({ label: 'Lucro líquido', value: brl(lucro), hint: receita ? `Margem ${pct((lucro / receita) * 100)}` : '', tone: lucro >= 0 ? 'revenue' : 'expense', big: true }),
          kpi({ label: 'Ticket médio', value: pedidos ? brl(receita / pedidos) : '—', hint: 'Receita ÷ pedidos', tone: 'info', big: true })),
        h('div', { class: 'grid g3', style: { marginTop: '16px' } },
          card({ title: 'Saúde financeira', desc: '% sobre a receita bruta do período', cls: 'span2' },
            h('div', { class: 'health', style: { marginBottom: '16px' } }, h('div', { class: 'health-dot', style: { background: geral.cor } }),
              h('div', {}, h('div', { style: { fontWeight: 800, fontSize: '18px' } }, geral.label), h('div', { class: 'muted', style: { fontSize: '13px' } }, `${metricas.filter((m) => m.status === 'critico').length} indicador(es) fora da meta`))),
            h('div', { class: 'grid g3' }, metricas.map((m) => h('div', { class: 'kpi', style: { '--tone': STATUS_UI[m.status].cor, boxShadow: 'none' } },
              h('div', { class: 'kpi-label' }, m.label),
              h('div', { class: 'kpi-value', style: { color: STATUS_UI[m.status].cor } }, pct(m.pct)),
              h('div', { class: 'kpi-hint' }, h('span', { class: `badge ${STATUS_UI[m.status].badge}` }, STATUS_UI[m.status].label), ' ', brl(m.valor)))))),
          card({ title: 'Contas a pagar', desc: 'Despesas com status pendente' },
            h('div', { class: 'form-stack' },
              kpi({ label: 'A vencer em 30 dias', value: brl(sum(aVencer, (m) => m.valor)), hint: `${aVencer.length} lançamento(s)`, tone: 'warning' }),
              kpi({ label: 'Vencidas', value: brl(sum(vencidos, (m) => m.valor)), hint: `${vencidos.length} lançamento(s)`, tone: vencidos.length ? 'expense' : 'revenue' }),
              h('a', { class: 'btn ghost small', href: '/gestao/projecoes', 'data-link': true }, 'Ver projeções →')))),
        h('div', { class: 'grid g2', style: { marginTop: '16px' } },
          card({ title: 'Receita e despesa mês a mês', desc: 'Últimos 12 meses', cls: 'span2' }, chart('bar', {
            labels: meses12.map(serie.label),
            datasets: [
              { label: 'Receita', data: meses12.map((k) => recMes.get(k) || 0), backgroundColor: '#3f8a5c', borderRadius: 5 },
              { label: 'Despesa', data: meses12.map((k) => despMes.get(k) || 0), backgroundColor: '#ff6b73', borderRadius: 5 },
            ],
          }, { money: true })),
          card({ title: 'Maiores gastos por categoria' }, barList(groupSum(dsp, (m) => m.categoria, (m) => m.valor), { limit: 8, color: 'var(--coral)' })),
          card({ title: 'Comparativo entre lojas', desc: 'Receita · despesa · lucro' }, barList(['Villa', 'Souza Cruz'].map((l) => {
            const r = sum(movs.filter((m) => m.loja === l && m.tipo === 'Receita'), (m) => m.valor);
            const d = sum(movs.filter((m) => m.loja === l && m.tipo === 'Despesa'), (m) => m.valor);
            return { name: `${l} — receita ${brl(r)} · despesa ${brl(d)}`, value: r - d, color: r - d >= 0 ? 'var(--revenue)' : 'var(--expense)' };
          }), { fmt: (v) => `Lucro ${brl(v)}` }))));
    }

    // Operação e estoque (todos os perfis)
    const saldos = est ? calcSaldos(est.base, est.movs, st.loja) : [];
    blocos.push(h('div', { class: 'section-title' }, 'Operação e estoque'),
      h('div', { class: 'grid g6' },
        kpi({ label: 'Produção (qtd)', value: num(qP), hint: brl(sum(prod, (x) => x.valor)), tone: 'revenue' }),
        kpi({ label: 'Desperdício (qtd)', value: num(qD), hint: brl(vDesp), tone: 'expense' }),
        kpi({ label: 'Taxa de desperdício', value: pct(qP ? (qD / qP) * 100 : 0), hint: 'Desperdício ÷ produção', tone: 'warning' }),
        kpi({ label: 'Eficiência operacional', value: pct(qP ? Math.max(0, 100 - (qD / qP) * 100) : 0), tone: 'info' }),
        kpi({ label: 'Estoque crítico', value: num(saldos.filter((s) => s.status === 'Crítico').length), hint: 'produtos', tone: 'warning' }),
        kpi({ label: 'Estoque zerado', value: num(saldos.filter((s) => s.status === 'Zerado').length), hint: 'produtos', tone: 'expense' })),
      h('div', { class: 'grid g3', style: { marginTop: '16px' } },
        card({ title: 'Ranking de produção' }, barList(groupSum(prod, (x) => x.produto, (x) => x.quantidade), { fmt: num, limit: 8, color: 'var(--revenue)' })),
        card({ title: 'Ranking de perdas', desc: 'Por valor' }, barList(groupSum(desp, (x) => x.produto, (x) => x.valor), { limit: 8, color: 'var(--expense)' })),
        card({ title: 'Repor no estoque', desc: 'Zerados e críticos' }, barList(saldos.filter((s) => s.sugestao > 0).sort((a, b) => a.saldo - b.saldo).map((s) => ({ name: s.produto, value: s.sugestao, extra: s.unidade, color: s.status === 'Zerado' ? 'var(--expense)' : 'var(--warning)' })), { fmt: num, limit: 8, emptyText: 'Nada para repor.' }))));
    area.replaceChildren(...blocos);
  }

  await carregar();
}
