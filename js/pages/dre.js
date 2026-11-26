// DRE gerencial: mês a mês, por loja ou grupo, com exportação para Excel e PDF.
import { sb } from '../api.js';
import { h, card, field, select, toast, loading, alertBox, icon, brl, pct } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok } from '../crud.js';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const norm = (s) => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mesmo critério do banco (categorias_financeiras.grupo_dre), para categorias novas sem grupo
function grupoPadrao(tipo, cat) {
  const c = norm(cat);
  if (tipo === 'RECEITA') return 'RECEITA';
  if (c.startsWith('IMPOSTO')) return 'DEDUCOES';
  if (['FORNECEDOR', 'INSUMO', 'MATERIA PRIMA', 'MATERIA-PRIMA'].includes(c)) return 'CMV';
  if (c.startsWith('FUNCION') || c.startsWith('FOLHA')) return 'PESSOAL';
  if (/^PRO.?LABORE/.test(c)) return 'PROLABORE';
  if (/^EMPR.STIMO|^DESPESA BANC|^JUROS/.test(c)) return 'FINANCEIRO';
  if (/^AQUISI|^INVESTIMENTO/.test(c)) return 'INVESTIMENTOS';
  return 'OPERACIONAL';
}
// Estrutura do DRE: grupos (detalhados por categoria) e subtotais
const LINHAS = [
  { g: 'RECEITA', label: 'Receita bruta', sinal: 1 },
  { g: 'DEDUCOES', label: '(−) Impostos sobre vendas', sinal: -1 },
  { t: 'Receita líquida', soma: ['RECEITA', 'DEDUCOES'] },
  { g: 'CMV', label: '(−) CMV · fornecedores e insumos', sinal: -1 },
  { t: 'Lucro bruto', soma: ['RECEITA', 'DEDUCOES', 'CMV'], destaque: true },
  { g: 'PESSOAL', label: '(−) Folha de pagamento', sinal: -1 },
  { g: 'PROLABORE', label: '(−) Pró-labore', sinal: -1 },
  { g: 'OPERACIONAL', label: '(−) Despesas operacionais', sinal: -1 },
  { t: 'Resultado operacional (EBITDA)', soma: ['RECEITA', 'DEDUCOES', 'CMV', 'PESSOAL', 'PROLABORE', 'OPERACIONAL'], destaque: true },
  { g: 'FINANCEIRO', label: '(−) Empréstimos, juros e tarifas', sinal: -1 },
  { t: 'Resultado líquido', soma: ['RECEITA', 'DEDUCOES', 'CMV', 'PESSOAL', 'PROLABORE', 'OPERACIONAL', 'FINANCEIRO'], destaque: true, final: true },
  { g: 'INVESTIMENTOS', label: '(−) Investimentos e aquisições', sinal: -1 },
  { t: 'Resultado após investimentos', soma: ['RECEITA', 'DEDUCOES', 'CMV', 'PESSOAL', 'PROLABORE', 'OPERACIONAL', 'FINANCEIRO', 'INVESTIMENTOS'] },
];

export async function render(main) {
  const hoje = new Date();
  const st = { ano: hoje.getFullYear(), loja: '*', regime: 'competencia', abertos: new Set(['OPERACIONAL']) };
  pageHeader(main, { title: 'DRE', sub: 'Demonstração do resultado, mês a mês' });
  const area = h('div', { class: 'dre-area' }, loading('Montando o DRE...'));
  main.append(area);
  let cats = new Map(); let lanc = [];

  async function carregar() {
    area.replaceChildren(loading('Montando o DRE...'));
    try {
      const c = ok(await sb.from('categorias_financeiras').select('tipo,nome,grupo_dre'));
      cats = new Map(c.map((x) => [`${x.tipo}|${norm(x.nome)}`, x.grupo_dre]));
      lanc = [];
      for (let de = 0; ; de += 1000) {
        // Competência: pega uma folga de meses porque a competência pode ser diferente do vencimento
        const ini = `${st.ano - 1}-11-01`; const fim = `${st.ano + 1}-02-28`;
        // Boletos antigos da planilha (legado_boleto/estoque) já aparecem nas movimentações: ficam fora para não contar duas vezes
        let q = sb.from('lancamentos').select('id,loja,tipo,categoria,valor,vencimento,competencia,pagamento,status,origem')
          .gte('vencimento', ini).lte('vencimento', fim).neq('status', 'CANCELADO').or('origem.is.null,origem.not.in.(legado_boleto,estoque)').order('id').range(de, de + 999);
        const lote = ok(await q); lanc.push(...lote); if (lote.length < 1000) break;
      }
      desenhar();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  // matriz[grupo][categoria][mes] = valor (positivo; o sinal vem da linha)
  function calcular() {
    const m = {}; const tot = {};
    for (const l of lanc) {
      if (st.loja !== '*' && (l.loja || '') !== st.loja) continue;
      if (st.regime === 'caixa' && l.status !== 'PAGO') continue;
      const d = st.regime === 'caixa' ? (l.pagamento || l.vencimento) : (l.competencia || l.vencimento);
      if (!d || !d.startsWith(String(st.ano))) continue;
      const mes = Number(d.slice(5, 7)) - 1;
      const g = cats.get(`${l.tipo}|${norm(l.categoria)}`) || grupoPadrao(l.tipo, l.categoria);
      const cat = l.categoria || 'Sem categoria';
      ((m[g] ||= {})[cat] ||= Array(12).fill(0))[mes] += Number(l.valor) || 0;
      (tot[g] ||= Array(12).fill(0))[mes] += Number(l.valor) || 0;
    }
    return { m, tot };
  }

  function linhasDRE() {
    const { m, tot } = calcular();
    const sinal = Object.fromEntries(LINHAS.filter((l) => l.g).map((l) => [l.g, l.sinal]));
    const meses = MESES.map((_, i) => i).filter((i) => Object.values(tot).some((arr) => arr[i]));
    const receita = (tot.RECEITA || Array(12).fill(0));
    const out = [];
    for (const L of LINHAS) {
      if (L.g) {
        const v = (tot[L.g] || Array(12).fill(0)).map((x) => x * L.sinal);
        out.push({ tipo: 'grupo', g: L.g, label: L.label, v });
        if (st.abertos.has(L.g) && m[L.g]) {
          for (const [cat, arr] of Object.entries(m[L.g]).sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0))) {
            out.push({ tipo: 'cat', label: cat, v: arr.map((x) => x * L.sinal) });
          }
        }
      } else {
        const v = Array(12).fill(0).map((_, i) => L.soma.reduce((s, g) => s + (tot[g]?.[i] || 0) * sinal[g], 0));
        out.push({ tipo: 'total', label: L.t, v, destaque: L.destaque, final: L.final });
      }
    }
    return { out, meses, receita };
  }

  function desenhar() {
    const { out, meses, receita } = linhasDRE();
    const recTot = meses.reduce((s, i) => s + receita[i], 0);
    const anoSel = select([hoje.getFullYear() - 1, hoje.getFullYear()].map(String), { onChange: (e) => { st.ano = Number(e.target.value); carregar(); } }); anoSel.value = String(st.ano);
    const lojaSel = select([{ value: '*', label: 'Grupo (as duas lojas)' }, { value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }], { onChange: (e) => { st.loja = e.target.value; desenhar(); } }); lojaSel.value = st.loja;
    const regSel = select([{ value: 'competencia', label: 'Competência (tudo lançado no mês)' }, { value: 'caixa', label: 'Caixa (só o que foi pago)' }], { onChange: (e) => { st.regime = e.target.value; carregar(); } }); regSel.value = st.regime;
    const tituloLoja = { '*': 'Grupo Pedacito', VILLA: 'Pedacito Villa Schlosser', SOUZA_CRUZ: 'Pedacito Souza Cruz' }[st.loja];
    const fmt = (v) => (v ? brl(v) : '—');
    const tabela = h('table', { class: 'tbl dre' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), ...meses.map((i) => h('th', { class: 'r' }, MESES[i])), h('th', { class: 'r' }, 'Total'), h('th', { class: 'r' }, '% receita'))),
      h('tbody', {}, out.map((r) => {
        const total = meses.reduce((s, i) => s + r.v[i], 0);
        const cls = r.tipo === 'total' ? `dre-total${r.destaque ? ' destaque' : ''}${r.final ? ' final' : ''}` : r.tipo === 'cat' ? 'dre-cat' : 'dre-grupo';
        const rotulo = r.tipo === 'grupo'
          ? h('button', { class: 'link-btn', onClick: () => { st.abertos.has(r.g) ? st.abertos.delete(r.g) : st.abertos.add(r.g); desenhar(); } }, `${st.abertos.has(r.g) ? '▾' : '▸'} ${r.label}`)
          : r.label;
        return h('tr', { class: cls }, h('td', {}, rotulo),
          ...meses.map((i) => h('td', { class: `r${r.v[i] < 0 && r.tipo === 'total' ? ' neg' : ''}` }, fmt(r.v[i]))),
          h('td', { class: `r${total < 0 && r.tipo === 'total' ? ' neg' : ''}` }, h('b', {}, fmt(total))),
          h('td', { class: 'r muted' }, recTot ? pct((total / recTot) * 100) : '—'));
      })));
    area.replaceChildren(
      h('div', { class: 'filters no-print', style: { marginBottom: '14px' } },
        field('Ano', anoSel), field('Loja', lojaSel), field('Regime', regSel),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } },
          h('button', { class: 'btn ghost', onClick: () => exportarExcel(out, meses, recTot, tituloLoja) }, icon('copy'), 'Exportar Excel'),
          h('button', { class: 'btn', onClick: () => window.print() }, icon('file'), 'Exportar PDF'))),
      h('div', { class: 'print-only dre-cabecalho' }, h('h2', {}, `DRE ${st.ano} · ${tituloLoja}`),
        h('div', {}, `Regime de ${st.regime === 'caixa' ? 'caixa' : 'competência'} · gerado em ${new Date().toLocaleDateString('pt-BR')}`)),
      card({ title: `${tituloLoja} · ${st.ano}`, desc: `Regime de ${st.regime === 'caixa' ? 'caixa: só o que foi pago, pela data do pagamento' : 'competência: tudo o que foi lançado, pelo mês do vencimento'}. Clique num grupo para abrir as categorias.` },
        meses.length ? h('div', { class: 'table-wrap' }, tabela) : h('div', { class: 'empty' }, 'Sem lançamentos neste ano.')),
      h('p', { class: 'muted no-print', style: { fontSize: '12.5px' } }, 'O DRE usa os lançamentos financeiros. Cada categoria cai num grupo (CMV, folha, operacionais…). Categorias novas entram em "Despesas operacionais" até serem classificadas.'));
  }

  async function exportarExcel(out, meses, recTot, tituloLoja) {
    try {
      const X = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const linhas = [[`DRE ${st.ano} · ${tituloLoja} · regime de ${st.regime === 'caixa' ? 'caixa' : 'competência'}`], [],
        ['', ...meses.map((i) => MESES[i]), 'Total', '% receita']];
      // Exporta todas as categorias abertas, para o Excel ficar completo
      const salvo = new Set(st.abertos); LINHAS.filter((l) => l.g).forEach((l) => st.abertos.add(l.g));
      const completo = linhasDRE().out; st.abertos = salvo;
      for (const r of completo) {
        const total = meses.reduce((s, i) => s + r.v[i], 0);
        linhas.push([(r.tipo === 'cat' ? '      ' : '') + r.label, ...meses.map((i) => Math.round(r.v[i] * 100) / 100), Math.round(total * 100) / 100, recTot ? Math.round((total / recTot) * 1000) / 1000 : null]);
      }
      const ws = X.utils.aoa_to_sheet(linhas);
      ws['!cols'] = [{ wch: 38 }, ...meses.map(() => ({ wch: 13 })), { wch: 14 }, { wch: 10 }];
      const ref = X.utils.decode_range(ws['!ref']);
      for (let r = 3; r <= ref.e.r; r++) for (let c = 1; c <= ref.e.c; c++) {
        const cell = ws[X.utils.encode_cell({ r, c })]; if (!cell || typeof cell.v !== 'number') continue;
        cell.z = c === ref.e.c ? '0.0%' : '#,##0.00;[Red]-#,##0.00';
      }
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, `DRE ${st.ano}`);
      X.writeFile(wb, `DRE_${st.ano}_${tituloLoja.replace(/\s+/g, '_')}.xlsx`);
    } catch (e) { toast(`Não consegui gerar o Excel: ${e.message}`, 'error'); }
  }

  carregar();
}
