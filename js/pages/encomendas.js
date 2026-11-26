// Gestão de encomendas: agenda, valores a receber, status, comprovante e WhatsApp do cliente.
import { sb } from '../api.js';
import { h, card, field, input, select, textarea, toast, loading, alertBox, kpi, icon, brl, dataBR, diaSemana, hojeISO, parseNum } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok, drawer } from '../crud.js';
import { rotaQuery } from '../app.js';
import { STATUS, TIPO, comprovante, relatorioCozinha, linkWhats, textoCliente } from './_encomenda.js';

const LOJAS = [{ value: '', label: 'As duas lojas' }, { value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const TONS = { ORCAMENTO: 'info', CONFIRMADO: '', EM_PRODUCAO: 'warn', PRONTO: 'ok', ENTREGUE: 'ok', CANCELADO: 'danger' };
const addDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function render(main) {
  const st = { periodo: 'proximas', loja: '', status: '', tipo: '', q: '' };
  pageHeader(main, { title: 'Encomendas', sub: 'Bolos decorados e eventos das duas lojas',
    actions: [h('a', { class: 'btn', href: '/encomenda', 'data-link': true }, icon('plus'), 'Nova encomenda')] });
  const area = h('div', {}, loading());
  main.append(area);
  let lista = []; let abriuLink = false;

  async function carregar() {
    area.replaceChildren(loading());
    try {
      let q = sb.from('encomendas').select('*, itens:encomenda_itens(id,descricao,quantidade,preco_unit,produto_id)').order('data_entrega').order('hora_entrega', { nullsFirst: false });
      if (st.periodo === 'proximas') q = q.gte('data_entrega', hojeISO());
      if (st.periodo === 'semana') q = q.gte('data_entrega', hojeISO()).lte('data_entrega', addDias(7));
      if (st.periodo === 'passadas') q = q.lt('data_entrega', hojeISO()).gte('data_entrega', addDias(-120));
      lista = ok(await q.limit(1000));
      desenhar();
      const id = abriuLink ? null : rotaQuery().get('id'); abriuLink = true; const alvo = id && lista.find((e) => String(e.id) === id);
      if (alvo) abrir(alvo); else if (id) { const [e] = ok(await sb.from('encomendas').select('*, itens:encomenda_itens(*)').eq('id', id)); if (e) abrir(e); }
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    const q = st.q.toLowerCase();
    const vis = lista.filter((e) => (!st.loja || e.loja === st.loja) && (!st.status || e.status === st.status) && (!st.tipo || e.tipo === st.tipo)
      && (!q || `${e.numero} ${e.cliente_nome} ${e.cliente_fone || ''}`.toLowerCase().includes(q)));
    const ativas = vis.filter((e) => !['CANCELADO', 'ORCAMENTO'].includes(e.status));
    const aReceber = ativas.filter((e) => e.status !== 'ENTREGUE' || !e.pago_total).reduce((s, e) => s + Math.max(Number(e.total) - Number(e.sinal), 0) * (e.pago_total ? 0 : 1), 0);
    const filtros = h('div', { class: 'filters', style: { marginBottom: '14px' } },
      field('Período', sel([{ value: 'proximas', label: 'Próximas' }, { value: 'semana', label: 'Próximos 7 dias' }, { value: 'passadas', label: 'Últimos 4 meses' }, { value: 'todas', label: 'Todas' }], st.periodo, (v) => { st.periodo = v; carregar(); })),
      field('Loja', sel(LOJAS, st.loja, (v) => { st.loja = v; desenhar(); })),
      field('Status', sel([{ value: '', label: 'Todos' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))], st.status, (v) => { st.status = v; desenhar(); })),
      field('Tipo', sel([{ value: '', label: 'Todos' }, ...Object.entries(TIPO).map(([value, label]) => ({ value, label }))], st.tipo, (v) => { st.tipo = v; desenhar(); })),
      field('Buscar', input({ value: st.q, placeholder: 'Cliente, número...', onInput: (e) => { st.q = e.target.value; clearTimeout(desenhar.t); desenhar.t = setTimeout(desenhar, 250); } })),
      h('button', { class: 'btn ghost', style: { alignSelf: 'flex-end' }, onClick: () => relatorioCozinha(ativas.filter((e) => e.status !== 'ENTREGUE'), 'Encomendas para produzir') }, icon('file'), 'Relatório da cozinha'));
    const porDia = new Map(); vis.forEach((e) => { if (!porDia.has(e.data_entrega)) porDia.set(e.data_entrega, []); porDia.get(e.data_entrega).push(e); });
    area.replaceChildren(filtros,
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Encomendas', value: String(ativas.length), hint: `${vis.filter((e) => e.status === 'ORCAMENTO').length} orçamento(s)` }),
        kpi({ label: 'Valor total', value: brl(ativas.reduce((s, e) => s + Number(e.total), 0)), tone: 'revenue' }),
        kpi({ label: 'Sinais recebidos', value: brl(ativas.reduce((s, e) => s + Number(e.sinal), 0)) }),
        kpi({ label: 'A receber', value: brl(aReceber), tone: 'warning' })),
      vis.length ? h('div', { class: 'form-stack' }, [...porDia].map(([dia, encs]) => card({ title: `${diaSemana(dia)}, ${dataBR(dia)}`, desc: `${encs.length} encomenda(s)` },
        encs.map((e) => h('button', { class: 'item-line enc-linha', onClick: () => abrir(e) },
          h('div', { class: 'enc-hora' }, e.hora_entrega || '--:--'),
          h('div', { style: { flex: 1, minWidth: 0, textAlign: 'left' } },
            h('b', {}, `${e.numero} · ${e.cliente_nome}`),
            h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${TIPO[e.tipo]} · ${e.loja === 'VILLA' ? 'Villa' : 'Souza Cruz'} · ${e.entrega_tipo === 'ENTREGA' ? 'entrega' : 'retirada'} · ${(e.itens || []).map((i) => `${String(Number(i.quantidade)).replace('.', ',')}x ${i.descricao}`).join(', ')}`)),
          h('div', { style: { textAlign: 'right' } }, h('span', { class: `badge ${TONS[e.status]}` }, STATUS[e.status]),
            h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '3px' } }, Number(e.total) ? brl(e.total) : '')))))))
        : h('div', { class: 'empty' }, 'Nenhuma encomenda com esses filtros.'));
  }

  function abrir(e) {
    const v = { ...e, detalhes: { ...(e.detalhes || {}) } };
    const linhas = (e.itens || []).map((i) => ({ ...i }));
    const salvarBtn = h('button', { class: 'btn' }, 'Salvar alterações');
    const totalItens = () => linhas.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unit), 0);
    const itensBox = h('div', { class: 'form-stack', style: { gap: '6px' } });
    const desenharItens = () => itensBox.replaceChildren(...linhas.map((i, idx) => h('div', { class: 'item-line', style: { padding: '6px 8px', gap: '6px' } },
      h('input', { class: 'input', value: i.descricao, style: { flex: 2 }, onInput: (ev) => { i.descricao = ev.target.value; } }),
      h('input', { class: 'input', value: String(i.quantidade).replace('.', ','), style: { width: '70px' }, onInput: (ev) => { i.quantidade = parseNum(ev.target.value); } }),
      h('input', { class: 'input', value: String(i.preco_unit).replace('.', ','), style: { width: '90px' }, onInput: (ev) => { i.preco_unit = parseNum(ev.target.value); } }),
      h('button', { class: 'icon-btn', onClick: () => { linhas.splice(idx, 1); desenharItens(); } }, icon('x')))));
    desenharItens();
    const campo = (k, el) => { el.addEventListener('input', (ev) => { v[k] = ev.target.value; }); el.addEventListener('change', (ev) => { v[k] = ev.target.value; }); return el; };
    const statusSel = sel(Object.entries(STATUS).map(([value, label]) => ({ value, label })), v.status, (x) => { v.status = x; });
    const corpo = h('div', { class: 'form-stack' },
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn ghost small', onClick: () => comprovante({ ...v, itens: linhas }) }, icon('file'), 'Comprovante'),
        v.cliente_fone ? h('a', { class: 'btn ghost small', href: linkWhats(v.cliente_fone, textoCliente({ ...v, itens: linhas })), target: '_blank', rel: 'noopener' }, 'WhatsApp do cliente') : null,
        h('button', { class: 'btn ghost small', onClick: () => relatorioCozinha([{ ...v, itens: linhas }], `Encomenda ${v.numero}`) }, 'Ficha da cozinha')),
      h('div', { class: 'form-row' }, field('Status', statusSel), field('Tipo', sel(Object.entries(TIPO).map(([value, label]) => ({ value, label })), v.tipo, (x) => { v.tipo = x; }))),
      h('div', { class: 'form-row' }, field('Cliente', campo('cliente_nome', input({ value: v.cliente_nome }))), field('Telefone', campo('cliente_fone', input({ value: v.cliente_fone || '' })))),
      h('div', { class: 'form-row' }, field('Data', campo('data_entrega', input({ type: 'date', value: v.data_entrega }))), field('Horário', campo('hora_entrega', input({ type: 'time', value: v.hora_entrega || '' })))),
      h('div', { class: 'form-row' }, field('Loja', sel(LOJAS.slice(1), v.loja, (x) => { v.loja = x; })), field('Recebe', sel([{ value: 'RETIRADA', label: 'Retirada' }, { value: 'ENTREGA', label: 'Entrega' }], v.entrega_tipo, (x) => { v.entrega_tipo = x; }))),
      field('Endereço', campo('endereco', input({ value: v.endereco || '' }))),
      Object.keys(v.detalhes).length ? card({ title: 'Detalhes do bolo' }, ...Object.keys(v.detalhes).map((k) => field(k.charAt(0).toUpperCase() + k.slice(1), input({ value: v.detalhes[k], onInput: (ev) => { v.detalhes[k] = ev.target.value; } })))) : null,
      card({ title: 'Itens', desc: 'Descrição · quantidade · preço unitário' }, itensBox,
        h('button', { class: 'btn ghost small', style: { marginTop: '6px' }, onClick: () => { linhas.push({ descricao: '', quantidade: 1, preco_unit: 0 }); desenharItens(); } }, '+ Item')),
      h('div', { class: 'form-row' }, field('Sinal (R$)', input({ value: String(v.sinal).replace('.', ','), onInput: (ev) => { v.sinal = parseNum(ev.target.value); } })),
        field('Pagamento', h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: !!v.pago_total, onChange: (ev) => { v.pago_total = ev.target.checked; } }), 'Pago integralmente'))),
      field('Observações', campo('observacao', textarea({ rows: 2, value: v.observacao || '' }))),
      h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `Atendido por ${v.atendente || '—'} · criado em ${new Date(v.criado_em).toLocaleString('pt-BR')}`),
      salvarBtn);
    const fechar = drawer(`Encomenda ${e.numero}`, corpo);
    salvarBtn.addEventListener('click', async () => {
      salvarBtn.disabled = true;
      try {
        const total = totalItens();
        ok(await sb.from('encomendas').update({ status: v.status, tipo: v.tipo, cliente_nome: v.cliente_nome, cliente_fone: v.cliente_fone || null, data_entrega: v.data_entrega,
          hora_entrega: v.hora_entrega || null, loja: v.loja, entrega_tipo: v.entrega_tipo, endereco: v.endereco || null, detalhes: v.detalhes, sinal: v.sinal,
          pago_total: !!v.pago_total, observacao: v.observacao || null, total, atualizado_em: new Date().toISOString() }).eq('id', e.id));
        const antigos = (e.itens || []).map((i) => i.id);
        if (antigos.length) ok(await sb.from('encomenda_itens').delete().in('id', antigos));
        const novos = linhas.filter((i) => i.descricao && Number(i.quantidade) > 0).map((i) => ({ encomenda_id: e.id, produto_id: i.produto_id || null, descricao: i.descricao, quantidade: i.quantidade, preco_unit: i.preco_unit || 0 }));
        if (novos.length) ok(await sb.from('encomenda_itens').insert(novos));
        toast('Encomenda atualizada.', 'ok'); fechar(); carregar();
      } catch (er) { toast(er.message, 'error'); salvarBtn.disabled = false; }
    });
  }

  carregar();
}

function sel(opts, valor, onChange) { const s = select(opts, { onChange: (e) => onChange(e.target.value) }); s.value = valor ?? ''; return s; }
