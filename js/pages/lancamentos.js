// Lançamentos financeiros: o que antes era digitado na aba MOVIMENTAÇÕES da planilha.
import { sb, clearMemo } from '../api.js';
import { h, kpi, field, input, select, table, toast, loading, alertBox, icon, brl, num, dataBR, hojeISO } from '../ui.js';
import { pageHeader } from './_painel.js';
import { drawer, ok } from '../crud.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }, { value: '', label: 'Grupo (ambas)' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : 'Grupo');
const FORMAS = ['Pix', 'Boleto', 'Dinheiro', 'Débito', 'Crédito', 'Cartão', 'Transferência', 'Cheque'];
const STATUS = { PAGO: ['Pago', 'ok'], PENDENTE: ['Pendente', 'warn'], PREVISTO: ['Previsto', 'info'], CANCELADO: ['Cancelado', ''] };

export async function render(main) {
  pageHeader(main, { title: 'Lançamentos', sub: 'Receitas, despesas, contas a pagar e a receber' });
  const area = h('div', {}, loading('Carregando...'));
  main.append(area);
  const hoje = hojeISO();
  const st = { mes: hoje.slice(0, 7), loja: '*', tipo: '', status: '', q: '', vencidas: false };
  let cats = [], contas = [], lista = [];

  async function carregar() {
    area.replaceChildren(loading('Carregando...'));
    try {
      [cats, contas] = await Promise.all([sb.from('categorias_financeiras').select('*').eq('ativo', true).order('nome').then(ok), sb.from('contas_bancarias').select('*').order('nome').then(ok)]);
      let q = sb.from('lancamentos').select('*').order('vencimento').limit(5000);
      if (st.vencidas) q = q.eq('status', 'PENDENTE').lt('vencimento', hoje);
      else { const [y, m] = st.mes.split('-').map(Number); const fim = new Date(y, m, 0).getDate(); q = q.gte('vencimento', `${st.mes}-01`).lte('vencimento', `${st.mes}-${fim}`); }
      lista = ok(await q);
      desenhar();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    const conta = new Map(contas.map((c) => [c.id, c.nome]));
    const vis = lista.filter((l) => (st.loja === '*' || (l.loja || '') === st.loja) && (!st.tipo || l.tipo === st.tipo) && (!st.status || l.status === st.status)
      && (!st.q || `${l.descricao} ${l.categoria} ${l.subcategoria || ''}`.toLowerCase().includes(st.q)));
    const soma = (f) => vis.filter(f).reduce((s, l) => s + Number(l.valor), 0);
    const sel = (opts, key, cb) => { const s = select(opts, { onChange: (e) => { st[key] = e.target.value; cb ? cb() : desenhar(); } }); s.value = st[key]; return s; };
    area.replaceChildren(
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Receitas', value: brl(soma((l) => l.tipo === 'RECEITA' && l.status !== 'CANCELADO')), tone: 'revenue' }),
        kpi({ label: 'Despesas pagas', value: brl(soma((l) => l.tipo === 'DESPESA' && l.status === 'PAGO')), tone: 'expense' }),
        kpi({ label: 'A pagar', value: brl(soma((l) => l.tipo === 'DESPESA' && l.status === 'PENDENTE')), tone: 'warning', hint: `${num(vis.filter((l) => l.tipo === 'DESPESA' && l.status === 'PENDENTE').length)} conta(s)` }),
        kpi({ label: 'Vencidas', value: brl(soma((l) => l.status === 'PENDENTE' && l.vencimento < hoje)), tone: 'coral', hint: 'pendentes com vencimento passado' })),
      h('div', { class: 'filters', style: { marginBottom: '14px' } },
        st.vencidas ? h('div', { class: 'badge danger', style: { alignSelf: 'center' } }, 'Mostrando todas as vencidas') : field('Mês', input({ type: 'month', value: st.mes, onChange: (e) => { st.mes = e.target.value; carregar(); } })),
        field('Loja', sel([{ value: '*', label: 'Todas' }, ...LOJAS], 'loja')),
        field('Tipo', sel([{ value: '', label: 'Todos' }, { value: 'RECEITA', label: 'Receitas' }, { value: 'DESPESA', label: 'Despesas' }], 'tipo')),
        field('Status', sel([{ value: '', label: 'Todos' }, ...Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))], 'status')),
        field('Busca', input({ value: st.q, placeholder: 'Descrição ou categoria', onInput: (e) => { st.q = e.target.value.toLowerCase(); desenhar(); } })),
        h('button', { class: `btn ${st.vencidas ? '' : 'ghost'} small`, style: { alignSelf: 'end' }, onClick: () => { st.vencidas = !st.vencidas; carregar(); } }, st.vencidas ? 'Voltar ao mês' : 'Ver vencidas'),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } },
          h('button', { class: 'btn ghost', onClick: () => editar({ tipo: 'RECEITA' }) }, icon('plus'), 'Receita'),
          h('button', { class: 'btn', onClick: () => editar({ tipo: 'DESPESA' }) }, icon('plus'), 'Despesa'))),
      h('div', { class: 'card', style: { padding: '6px 10px' } }, table([
        { label: 'Vencimento', render: (l) => h('span', { style: { color: l.status === 'PENDENTE' && l.vencimento < hoje ? 'var(--expense)' : '' } }, dataBR(l.vencimento)) },
        { label: 'Descrição', render: (l) => h('div', {}, h('b', {}, l.descricao), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [l.categoria, l.subcategoria, l.parcela ? `parc. ${l.parcela}` : ''].filter(Boolean).join(' · '))) },
        { label: 'Loja', render: (l) => lojaNome(l.loja) },
        { label: 'Forma', render: (l) => [l.forma_pagamento, conta.get(l.conta_id)].filter(Boolean).join(' · ') || '—' },
        { label: 'Valor', render: (l) => h('b', { style: { color: l.tipo === 'RECEITA' ? 'var(--revenue)' : 'var(--expense)' } }, `${l.tipo === 'RECEITA' ? '+' : '−'} ${brl(l.valor)}`), right: true },
        { label: 'Status', render: (l) => h('span', { class: `badge ${STATUS[l.status][1]}` }, STATUS[l.status][0]) },
        { label: '', render: (l) => h('div', { class: 'row-actions' },
          l.status === 'PENDENTE' ? h('button', { class: 'btn small', onClick: () => pagar(l) }, 'Dar baixa') : null,
          h('button', { class: 'btn ghost small', onClick: () => editar(l) }, 'Editar')) },
      ], vis, { maxHeight: false, emptyText: 'Nenhum lançamento com esses filtros.' })),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } }, `${vis.length} lançamento(s)`));
  }

  async function pagar(l) {
    try { ok(await sb.from('lancamentos').update({ status: 'PAGO', pagamento: hojeISO() }).eq('id', l.id)); clearMemo(); toast('Baixa registrada.', 'ok'); carregar(); } catch (e) { toast(e.message, 'error'); }
  }

  function editar(orig) {
    const l = { loja: 'VILLA', status: orig.id ? orig.status : 'PENDENTE', vencimento: hojeISO(), ...orig };
    const novo = !orig.id;
    let nParc = 1;
    const corpo = h('div', { class: 'form-stack' });
    let fechar;
    function desenhar2() {
      const catsTipo = cats.filter((c) => c.tipo === l.tipo);
      const subs = catsTipo.find((c) => c.nome === l.categoria)?.subcategorias || [];
      const subDl = h('datalist', { id: 'dl-sub' }, subs.map((x) => h('option', { value: x })));
      const err = h('div');
      const s = (opts, key, onCh) => { const el = select(opts, { onChange: (e) => { l[key] = e.target.value || null; onCh?.(); } }); el.value = l[key] ?? ''; return el; };
      const btn = h('button', { class: 'btn block', type: 'submit' }, icon('check'), 'Salvar');
      const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
        e.preventDefault(); err.replaceChildren();
        if (!l.descricao || !l.categoria || !(Number(l.valor) > 0) || !l.vencimento) return err.append(alertBox('Preencha descrição, categoria, valor e vencimento.'));
        btn.disabled = true;
        try {
          const base = { loja: l.loja || null, tipo: l.tipo, categoria: l.categoria, subcategoria: l.subcategoria || null, descricao: l.descricao.trim(), valor: Number(l.valor),
            vencimento: l.vencimento, competencia: l.competencia || l.vencimento, status: l.status, pagamento: l.status === 'PAGO' ? (l.pagamento || l.vencimento) : null,
            forma_pagamento: l.forma_pagamento || null, conta_id: Number(l.conta_id) || null, observacao: l.observacao || null };
          if (!novo) ok(await sb.from('lancamentos').update(base).eq('id', l.id));
          else if (nParc === 1) ok(await sb.from('lancamentos').insert({ ...base, origem: 'sistema' }));
          else {
            const valorP = Math.floor((base.valor / nParc) * 100) / 100;
            const linhas = Array.from({ length: nParc }, (_, k) => { const d = new Date(base.vencimento + 'T12:00'); d.setMonth(d.getMonth() + k);
              return { ...base, origem: 'sistema', descricao: `${base.descricao} (${k + 1}/${nParc})`, parcela: `${k + 1}/${nParc}`, vencimento: d.toISOString().slice(0, 10),
                valor: k === nParc - 1 ? Math.round((base.valor - valorP * (nParc - 1)) * 100) / 100 : valorP, status: k === 0 ? base.status : 'PENDENTE', pagamento: k === 0 ? base.pagamento : null }; });
            ok(await sb.from('lancamentos').insert(linhas));
          }
          if (l.categoria && !catsTipo.some((c) => c.nome === l.categoria)) await sb.from('categorias_financeiras').insert({ tipo: l.tipo, nome: l.categoria });
          clearMemo(); toast('Lançamento salvo.', 'ok'); fechar(); carregar();
        } catch (ex) { err.append(alertBox(ex.message)); btn.disabled = false; }
      } },
      h('div', { class: 'seg', style: { marginBottom: '4px' } },
        ...['RECEITA', 'DESPESA'].map((t) => h('button', { type: 'button', class: l.tipo === t ? 'on' : '', onClick: () => { l.tipo = t; l.categoria = null; desenhar2(); } }, t === 'RECEITA' ? 'Receita' : 'Despesa'))),
      field('Descrição *', input({ value: l.descricao || '', placeholder: 'Ex.: Energia elétrica – Celesc', onInput: (e) => { l.descricao = e.target.value; } })),
      h('div', { class: 'form-row' },
        field('Categoria *', h('div', {}, input({ list: 'dl-cat', value: l.categoria || '', placeholder: 'Escolha ou digite', onInput: (e) => {
            l.categoria = e.target.value.toUpperCase();
            const novas = catsTipo.find((c) => c.nome === l.categoria)?.subcategorias || [];
            subDl.replaceChildren(...novas.map((x) => h('option', { value: x })));
          } }),
          h('datalist', { id: 'dl-cat' }, catsTipo.map((c) => h('option', { value: c.nome }))))),
        field('Subcategoria', h('div', {}, input({ list: 'dl-sub', value: l.subcategoria || '', onInput: (e) => { l.subcategoria = e.target.value.toUpperCase(); } }), subDl))),
      h('div', { class: 'form-row' },
        field('Valor total (R$) *', input({ inputMode: 'decimal', value: l.valor ? String(l.valor).replace('.', ',') : '', onInput: (e) => { l.valor = Number(e.target.value.replace(/\./g, '').replace(',', '.')) || null; } })),
        field('Loja', s(LOJAS, 'loja'))),
      h('div', { class: 'form-row' },
        field(novo ? 'Vencimento (1ª parcela) *' : 'Vencimento *', input({ type: 'date', value: l.vencimento, onInput: (e) => { l.vencimento = e.target.value; } })),
        novo ? field('Parcelas', (() => { const p = select(['1', '2', '3', '4', '5', '6', '8', '10', '12', '18', '24'], { onChange: (e) => { nParc = Number(e.target.value); } }); p.value = String(nParc); return p; })()) : field('Competência', input({ type: 'date', value: l.competencia || '', onInput: (e) => { l.competencia = e.target.value; } }))),
      h('div', { class: 'form-row' },
        field('Forma de pagamento', s([{ value: '', label: '—' }, ...FORMAS], 'forma_pagamento')),
        field('Conta / banco', s([{ value: '', label: '—' }, ...contas.map((c) => ({ value: String(c.id), label: c.nome }))], 'conta_id'))),
      field('Status', s(Object.entries(STATUS).map(([v, [lb]]) => ({ value: v, label: lb })), 'status', () => desenhar2())),
      l.status === 'PAGO' ? field('Data do pagamento', input({ type: 'date', value: l.pagamento || l.vencimento, onInput: (e) => { l.pagamento = e.target.value; } })) : null,
      field('Observação', input({ value: l.observacao || '', onInput: (e) => { l.observacao = e.target.value; } })),
      err, btn,
      !novo ? h('button', { type: 'button', class: 'btn ghost small danger-text', onClick: async () => {
        if (!confirm2(l.id)) return;
        try { ok(await sb.from('lancamentos').delete().eq('id', l.id)); clearMemo(); toast('Lançamento apagado.', 'ok'); fechar(); carregar(); } catch (ex) { toast(ex.message, 'error'); }
      } }, icon('trash'), 'Apagar lançamento') : null);
      if (l.conta_id != null) l.conta_id = String(l.conta_id);
      corpo.replaceChildren(form);
    }
    desenhar2();
    fechar = drawer(novo ? (l.tipo === 'RECEITA' ? 'Nova receita' : 'Nova despesa') : 'Editar lançamento', corpo);
  }
  let pend = null;
  function confirm2(id) { if (pend === id) return true; pend = id; toast('Clique de novo para confirmar.', 'warn'); setTimeout(() => { pend = null; }, 5000); return false; }

  carregar();
}
