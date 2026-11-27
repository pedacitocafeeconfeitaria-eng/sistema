// Contas a pagar: tudo o que está em aberto, por vencimento, com baixa individual ou em lote.
import { sb, clearMemo } from '../api.js';
import { h, card, field, input, select, toast, loading, alertBox, kpi, icon, brl, dataBR, hojeISO, parseNum } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok, drawer } from '../crud.js';

const LOJAS = [{ value: '', label: 'As duas lojas' }, { value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : 'Grupo');
const somaDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
// Boletos antigos da planilha que já aparecem como movimentação não entram aqui (contaria duas vezes)
const ehDuplicado = (l) => l.origem === 'legado_boleto' || l.origem === 'estoque';

export async function render(main) {
  const st = { aba: 'aberto', loja: '', q: '', sel: new Set() };
  pageHeader(main, { title: 'Contas a pagar', sub: 'Boletos e despesas em aberto, por data de vencimento',
    actions: [h('button', { class: 'btn', onClick: () => nova() }, icon('plus'), 'Nova conta a pagar')] });
  const area = h('div', {}, loading());
  main.append(area);
  let lista = [], contas = [], forn = new Map(), cats = [];

  async function carregar() {
    area.replaceChildren(loading());
    try {
      let q = sb.from('lancamentos').select('*').eq('tipo', 'DESPESA');
      q = st.aba === 'aberto' ? q.in('status', ['PENDENTE', 'PREVISTO']).order('vencimento') : q.eq('status', 'PAGO').gte('pagamento', somaDias(-30)).order('pagamento', { ascending: false });
      const [l, c, f, k] = await Promise.all([q.limit(2000).then(ok), sb.from('contas_bancarias').select('*').eq('ativo', true).order('nome').then(ok),
        sb.from('fornecedores').select('id,nome').then(ok), sb.from('categorias_financeiras').select('nome,tipo').eq('tipo', 'DESPESA').order('nome').then(ok)]);
      lista = l.filter((x) => !ehDuplicado(x)); contas = c; forn = new Map(f.map((x) => [x.id, x.nome])); cats = k;
      st.sel.clear(); desenhar();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    const hoje = hojeISO(); const em7 = somaDias(7);
    const q = st.q.toLowerCase();
    const vis = lista.filter((l) => (!st.loja || l.loja === st.loja) && (!q || `${l.descricao} ${forn.get(l.fornecedor_id) || ''} ${l.categoria}`.toLowerCase().includes(q)));
    const soma = (arr) => arr.reduce((s, l) => s + Number(l.valor), 0);
    const atrasadas = vis.filter((l) => l.vencimento < hoje), deHoje = vis.filter((l) => l.vencimento === hoje),
      semana = vis.filter((l) => l.vencimento > hoje && l.vencimento <= em7), depois = vis.filter((l) => l.vencimento > em7);
    const abas = h('div', { class: 'tabs', style: { marginBottom: '12px' } },
      ...[['aberto', 'Em aberto'], ['pagas', 'Pagas (últimos 30 dias)']].map(([v, t]) => h('button', { class: `tab${st.aba === v ? ' active' : ''}`, onClick: () => { st.aba = v; carregar(); } }, t)));
    const lojaSel = select(LOJAS, { onChange: (e) => { st.loja = e.target.value; desenhar(); } }); lojaSel.value = st.loja;
    const busca = input({ value: st.q, placeholder: 'Fornecedor, descrição...', onInput: (e) => { st.q = e.target.value; clearTimeout(desenhar.t); desenhar.t = setTimeout(desenhar, 250); } });
    const filtros = h('div', { class: 'filters', style: { marginBottom: '14px' } }, field('Loja', lojaSel), field('Buscar', busca));

    if (st.aba === 'pagas') {
      area.replaceChildren(abas, filtros, card({ title: `Pagas nos últimos 30 dias · ${brl(soma(vis))}` },
        vis.length ? h('div', { class: 'form-stack', style: { gap: 0 } }, vis.map((l) => linha(l, true))) : h('div', { class: 'empty' }, 'Nenhum pagamento registrado nos últimos 30 dias.')));
      return;
    }
    const selecionadas = vis.filter((l) => st.sel.has(l.id));
    const barra = selecionadas.length ? h('div', { class: 'cp-barra' }, h('span', {}, `${selecionadas.length} selecionada(s) · ${brl(soma(selecionadas))}`),
      h('button', { class: 'btn small', onClick: () => pagar(selecionadas) }, 'Pagar selecionadas'),
      h('button', { class: 'btn ghost small', onClick: () => { st.sel.clear(); desenhar(); } }, 'Limpar')) : null;
    const grupo = (titulo, arr, tom) => arr.length ? card({ title: `${titulo} · ${brl(soma(arr))}`, desc: `${arr.length} conta(s)` },
      h('div', { class: `form-stack cp-grupo ${tom || ''}`, style: { gap: 0 } }, arr.map((l) => linha(l)))) : null;
    area.replaceChildren(abas,
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Atrasadas', value: brl(soma(atrasadas)), hint: `${atrasadas.length} conta(s)`, tone: atrasadas.length ? 'expense' : 'sage' }),
        kpi({ label: 'Vence hoje', value: brl(soma(deHoje)), hint: `${deHoje.length} conta(s)`, tone: 'warning' }),
        kpi({ label: 'Próximos 7 dias', value: brl(soma(semana)), hint: `${semana.length} conta(s)` }),
        kpi({ label: 'Total em aberto', value: brl(soma(vis)), hint: `${vis.length} conta(s)` })),
      filtros, barra,
      vis.length ? h('div', { class: 'form-stack' }, grupo('Atrasadas', atrasadas, 'atrasada'), grupo('Vencem hoje', deHoje, 'hoje'), grupo('Próximos 7 dias', semana), grupo('Mais pra frente', depois))
        : h('div', { class: 'empty' }, 'Nenhuma conta em aberto. 🎉'));
  }

  function linha(l, paga = false) {
    const marcado = st.sel.has(l.id);
    const fornecedor = forn.get(l.fornecedor_id);
    return h('div', { class: 'item-line cp-linha' },
      paga ? null : h('input', { type: 'checkbox', checked: marcado, title: 'Selecionar para pagar junto', onChange: (e) => { e.target.checked ? st.sel.add(l.id) : st.sel.delete(l.id); desenhar(); } }),
      h('div', { class: 'cp-data' }, dataBR(paga ? l.pagamento : l.vencimento)),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, l.descricao),
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [fornecedor && fornecedor.toUpperCase() !== String(l.descricao).split(' NF')[0] ? fornecedor : null, lojaNome(l.loja), l.categoria,
          l.parcela && l.parcela !== '1/1' ? `parc. ${l.parcela}` : null, l.forma_pagamento, paga ? `venc. ${dataBR(l.vencimento)}` : null,
          l.status === 'PREVISTO' ? 'previsto' : null].filter(Boolean).join(' · '))),
      h('div', { class: 'cp-valor' }, brl(l.valor)),
      paga ? h('button', { class: 'btn ghost small', title: 'Voltar para em aberto', onClick: () => estornar(l) }, 'Desfazer')
        : h('button', { class: 'btn small', onClick: () => pagar([l]) }, 'Pagar'));
  }

  function pagar(itens) {
    const um = itens.length === 1 ? itens[0] : null;
    const data = input({ type: 'date', value: hojeISO() });
    const conta = select([{ value: '', label: 'Não informar' }, ...contas.map((c) => ({ value: String(c.id), label: c.nome }))]);
    const valor = um ? input({ inputMode: 'decimal', value: String(um.valor).replace('.', ',') }) : null;
    const btn = h('button', { class: 'btn' }, um ? 'Confirmar pagamento' : `Confirmar ${itens.length} pagamentos`);
    const fechar = drawer(um ? 'Pagar conta' : `Pagar ${itens.length} contas`, h('div', { class: 'form-stack' },
      um ? h('div', {}, h('b', {}, um.descricao), h('div', { class: 'muted' }, `Vencimento ${dataBR(um.vencimento)}`))
        : h('div', {}, itens.map((l) => h('div', { class: 'muted', style: { fontSize: '13px' } }, `${dataBR(l.vencimento)} · ${l.descricao} · ${brl(l.valor)}`)),
          h('b', {}, `Total ${brl(itens.reduce((s, l) => s + Number(l.valor), 0))}`)),
      field('Data do pagamento', data), field('Pago pela conta', conta),
      um ? field('Valor pago (com juros ou desconto, se tiver)', valor) : null, btn));
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        for (const l of itens) {
          const dados = { status: 'PAGO', pagamento: data.value || hojeISO(), conta_id: conta.value ? Number(conta.value) : null };
          if (um && parseNum(valor.value) > 0 && parseNum(valor.value) !== Number(l.valor)) dados.valor = parseNum(valor.value);
          ok(await sb.from('lancamentos').update(dados).eq('id', l.id));
        }
        clearMemo(); toast(itens.length > 1 ? `${itens.length} contas pagas.` : 'Pagamento registrado.', 'ok'); fechar(); carregar();
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
  }

  async function estornar(l) {
    if (!confirm(`Voltar "${l.descricao}" para em aberto?`)) return;
    try { ok(await sb.from('lancamentos').update({ status: 'PENDENTE', pagamento: null, conta_id: null }).eq('id', l.id)); clearMemo(); toast('Conta voltou para em aberto.', 'ok'); carregar(); } catch (e) { toast(e.message, 'error'); }
  }

  function nova() {
    const v = { descricao: '', loja: 'VILLA', categoria: cats[0]?.nome || 'FORNECEDOR', valor: '', vencimento: hojeISO(), parcelas: '1', forma: 'Boleto', fornecedor: '' };
    const fornList = [...forn.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const sel = (opts, k) => { const s = select(opts, { onChange: (e) => { v[k] = e.target.value; } }); s.value = v[k]; return s; };
    const inp = (k, extra = {}) => input({ value: v[k], ...extra, onInput: (e) => { v[k] = e.target.value; } });
    const btn = h('button', { class: 'btn' }, 'Salvar');
    const fechar = drawer('Nova conta a pagar', h('div', { class: 'form-stack' },
      field('Descrição *', inp('descricao', { placeholder: 'Ex.: Aluguel dezembro, boleto Dequech...' })),
      h('div', { class: 'form-row' }, field('Loja', sel(LOJAS.slice(1), 'loja')), field('Categoria', sel(cats.map((c) => c.nome), 'categoria'))),
      field('Fornecedor', sel([{ value: '', label: '—' }, ...fornList.map(([id, n]) => ({ value: String(id), label: n }))], 'fornecedor')),
      h('div', { class: 'form-row' }, field('Valor total (R$) *', inp('valor', { inputMode: 'decimal' })), field('1º vencimento *', inp('vencimento', { type: 'date' }))),
      h('div', { class: 'form-row' }, field('Parcelas (mensais)', inp('parcelas', { type: 'number', min: 1, max: 48 })), field('Forma', sel(['Boleto', 'PIX', 'Débito automático', 'Cartão', 'Dinheiro', 'Transferência'], 'forma'))),
      btn));
    btn.addEventListener('click', async () => {
      const total = parseNum(v.valor); const n = Math.max(1, Math.min(48, Number(v.parcelas) || 1));
      if (!v.descricao.trim() || !(total > 0) || !v.vencimento) return toast('Preencha descrição, valor e vencimento.', 'error');
      const base = Math.floor((total / n) * 100) / 100;
      const linhas = Array.from({ length: n }, (_, i) => {
        const d = new Date(`${v.vencimento}T12:00:00`); d.setMonth(d.getMonth() + i);
        const valor = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
        return { loja: v.loja, tipo: 'DESPESA', categoria: v.categoria, descricao: n > 1 ? `${v.descricao.trim()} (${i + 1}/${n})` : v.descricao.trim(),
          fornecedor_id: v.fornecedor ? Number(v.fornecedor) : null, valor, vencimento: d.toISOString().slice(0, 10), competencia: d.toISOString().slice(0, 10),
          status: 'PENDENTE', forma_pagamento: v.forma, parcela: `${i + 1}/${n}`, origem: 'sistema' };
      });
      btn.disabled = true;
      try { ok(await sb.from('lancamentos').insert(linhas)); clearMemo(); toast(n > 1 ? `${n} parcelas lançadas.` : 'Conta lançada.', 'ok'); fechar(); carregar(); }
      catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
  }

  carregar();
}
