// Compras: pedidos (do rascunho ao recebimento), fornecedores, cotações e sugestão de compra.
import { sb } from '../api.js';
import { h, card, kpi, field, input, select, table, toast, loading, alertBox, icon, brl, num, dataBR, hojeISO, combo } from '../ui.js';
import { pageHeader } from './_painel.js';
import { paginaLista, drawer, ok, abas } from '../crud.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : '—');
const STATUS = { RASCUNHO: ['Rascunho', ''], ENVIADO: ['Enviado', 'info'], RECEBIDO_PARCIAL: ['Recebido parcial', 'warn'], RECEBIDO: ['Recebido', 'ok'], CANCELADO: ['Cancelado', 'danger'] };
const FORMAS = ['Boleto', 'Pix', 'Dinheiro', 'Cartão', 'Débito', 'Transferência', 'À vista'];

export async function render(main, { match }) {
  const aba = match[1] || 'pedidos';
  pageHeader(main, { title: 'Compras', sub: 'Pedidos, recebimento, fornecedores e cotações' });
  main.append(abas([['pedidos', 'Pedidos'], ['sugestao', 'Sugestão de compra'], ['fornecedores', 'Fornecedores'], ['cotacoes', 'Cotações e preços']], aba, (id) => { location.hash = `/gestao/compras/${id}`; }));
  const area = h('div', { style: { marginTop: '16px' } }, loading('Carregando...'));
  main.append(area);
  const cad = await cadastrosBase();
  if (aba === 'pedidos') return pedidos(area, cad);
  if (aba === 'sugestao') return sugestao(area, cad);
  if (aba === 'fornecedores') return fornecedores(area);
  if (aba === 'cotacoes') return cotacoes(area, cad);
}

async function cadastrosBase() {
  const [forn, ins, contas] = await Promise.all([
    sb.from('fornecedores').select('id,nome,whatsapp,telefone,prazo_pagto,forma_pagto').eq('ativo', true).order('nome').then(ok),
    sb.from('insumos').select('id,nome,unidade,custo_unitario,categoria,estoque_minimo,fornecedor_pref').eq('ativo', true).order('nome').then(ok),
    sb.from('contas_bancarias').select('id,nome').eq('ativo', true).order('nome').then(ok),
  ]);
  return { forn, ins, contas, fornNome: new Map(forn.map((f) => [f.id, f.nome])), insMap: new Map(ins.map((i) => [i.id, i])) };
}

// ---------------------------------------------------------------- PEDIDOS
async function pedidos(area, cad) {
  let filtro = 'abertos';
  async function carregar() {
    area.replaceChildren(loading('Carregando pedidos...'));
    try {
      const lista = ok(await sb.from('pedidos_compra').select('*, pedido_compra_itens(*)').order('id', { ascending: false }).limit(500));
      desenhar(lista);
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }
  function desenhar(lista) {
    const abertos = lista.filter((p) => ['RASCUNHO', 'ENVIADO', 'RECEBIDO_PARCIAL'].includes(p.status));
    const vis = filtro === 'abertos' ? abertos : filtro === 'todos' ? lista : lista.filter((p) => p.status === filtro);
    const total = (p) => p.pedido_compra_itens.reduce((s, i) => s + Number(i.quantidade) * (Number(i.preco_previsto) || 0), 0);
    const mes = hojeISO().slice(0, 7);
    area.replaceChildren(
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Pedidos em aberto', value: num(abertos.length), tone: 'info' }),
        kpi({ label: 'Aguardando entrega', value: brl(abertos.filter((p) => p.status === 'ENVIADO').reduce((s, p) => s + total(p), 0)), tone: 'warning' }),
        kpi({ label: 'Recebidos no mês', value: num(lista.filter((p) => (p.recebido_em || '').startsWith(mes)).length), tone: 'revenue' }),
        kpi({ label: 'Emergenciais no mês', value: num(lista.filter((p) => p.emergencial && p.data_pedido.startsWith(mes)).length), tone: 'expense', hint: 'meta: zero' })),
      h('div', { class: 'filters', style: { marginBottom: '14px' } },
        field('Mostrar', (() => { const s = select([{ value: 'abertos', label: 'Em aberto' }, { value: 'todos', label: 'Todos' }, ...Object.entries(STATUS).map(([v, [l]]) => ({ value: v, label: l }))], { onChange: (e) => { filtro = e.target.value; desenhar(lista); } }); s.value = filtro; return s; })()),
        h('div', { style: { marginLeft: 'auto' } }, h('button', { class: 'btn', onClick: () => editarPedido(cad, null, carregar) }, icon('plus'), 'Novo pedido'))),
      h('div', { class: 'card', style: { padding: '6px 10px' } }, table([
        { label: 'Pedido', render: (p) => h('div', {}, h('b', {}, p.numero || `#${p.id}`), p.emergencial ? h('span', { class: 'badge danger', style: { marginLeft: '6px' } }, 'Emergencial') : '') },
        { label: 'Fornecedor', render: (p) => cad.fornNome.get(p.fornecedor_id) || '—' },
        { label: 'Loja', render: (p) => lojaNome(p.loja) },
        { label: 'Data', render: (p) => dataBR(p.data_pedido) },
        { label: 'Entrega', render: (p) => dataBR(p.previsao) },
        { label: 'Itens', render: (p) => num(p.pedido_compra_itens.length), right: true },
        { label: 'Previsto', render: (p) => brl(total(p)), right: true },
        { label: 'Status', render: (p) => h('span', { class: `badge ${STATUS[p.status][1]}` }, STATUS[p.status][0]) },
        { label: '', render: (p) => h('div', { class: 'row-actions' },
          p.status === 'RASCUNHO' || p.status === 'ENVIADO' ? h('button', { class: 'btn ghost small', onClick: () => editarPedido(cad, p, carregar) }, 'Abrir') : null,
          p.status !== 'RASCUNHO' && p.status !== 'CANCELADO' && p.status !== 'RECEBIDO' ? h('button', { class: 'btn small', onClick: () => receber(cad, p, carregar) }, 'Receber') : null,
          h('button', { class: 'btn ghost small', title: 'Mensagem para WhatsApp', onClick: () => whatsapp(cad, p) }, 'WhatsApp')) },
      ], vis, { maxHeight: false, emptyText: 'Nenhum pedido aqui.' })));
  }
  await carregar();
}

function editarPedido(cad, ped, recarregar) {
  const p = ped ? { ...ped, itens: ped.pedido_compra_itens.map((i) => ({ ...i })) } : { loja: 'VILLA', data_pedido: hojeISO(), status: 'RASCUNHO', emergencial: false, itens: [] };
  const corpo = h('div', { class: 'form-stack' });
  let fechar;
  function linhaItem(it) {
    const ins = cad.insMap.get(it.insumo_id);
    const qtd = input({ inputMode: 'decimal', value: it.quantidade ?? '', style: { width: '90px' }, onInput: (e) => { it.quantidade = Number(e.target.value.replace(',', '.')) || null; tot(); } });
    const preco = input({ inputMode: 'decimal', value: it.preco_previsto ?? '', style: { width: '100px' }, onInput: (e) => { it.preco_previsto = Number(e.target.value.replace(',', '.')) || null; tot(); } });
    return h('div', { class: 'item-line' },
      h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, ins?.nome || '?'), h('div', { class: 'muted', style: { fontSize: '12px' } }, `Último custo: ${ins?.custo_unitario ? brl(ins.custo_unitario) : '—'} / ${ins?.unidade || ''}`)),
      field('Qtd', qtd), field('Preço un.', preco),
      h('button', { class: 'icon-btn', type: 'button', onClick: () => { p.itens = p.itens.filter((x) => x !== it); desenhar(); } }, icon('trash')));
  }
  const totalEl = h('b');
  const tot = () => { totalEl.textContent = brl(p.itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco_previsto) || 0), 0)); };
  function desenhar() {
    const forn = select([{ value: '', label: 'Selecione' }, ...cad.forn.map((f) => ({ value: f.id, label: f.nome }))], { onChange: (e) => { p.fornecedor_id = Number(e.target.value) || null; } });
    forn.value = p.fornecedor_id || '';
    const loja = select(LOJAS, { onChange: (e) => { p.loja = e.target.value; } }); loja.value = p.loja;
    const add = combo({ options: cad.ins.filter((i) => !p.itens.some((x) => x.insumo_id === i.id)).map((i) => ({ value: i.id, label: i.nome, sub: `${i.categoria || ''} · ${i.unidade}` })), placeholder: 'Adicionar insumo…',
      onSelect: (o) => { if (!o) return; const i = cad.insMap.get(o.value); p.itens.push({ insumo_id: i.id, quantidade: null, preco_previsto: i.custo_unitario ? Number(i.custo_unitario) : null }); desenhar(); } });
    const err = h('div');
    const salvar = async (status) => {
      err.replaceChildren();
      if (!p.fornecedor_id) return err.append(alertBox('Escolha o fornecedor.'));
      if (!p.itens.length || p.itens.some((i) => !(i.quantidade > 0))) return err.append(alertBox('Adicione itens com quantidade.'));
      try {
        const cab = { loja: p.loja, fornecedor_id: p.fornecedor_id, data_pedido: p.data_pedido, previsao: p.previsao || null, emergencial: !!p.emergencial, observacao: p.observacao || null, status,
          valor_previsto: p.itens.reduce((s, i) => s + i.quantidade * (i.preco_previsto || 0), 0) };
        let id = p.id;
        if (id) ok(await sb.from('pedidos_compra').update(cab).eq('id', id));
        else { const r = ok(await sb.from('pedidos_compra').insert(cab).select('id').single()); id = r.id; ok(await sb.from('pedidos_compra').update({ numero: `PC-${String(id).padStart(4, '0')}` }).eq('id', id)); }
        ok(await sb.from('pedido_compra_itens').delete().eq('pedido_id', id));
        ok(await sb.from('pedido_compra_itens').insert(p.itens.map((i) => ({ pedido_id: id, insumo_id: i.insumo_id, quantidade: i.quantidade, preco_previsto: i.preco_previsto }))));
        toast(status === 'ENVIADO' ? 'Pedido marcado como enviado.' : 'Pedido salvo.', 'ok');
        fechar(); recarregar();
        if (status === 'ENVIADO') whatsapp(cad, { ...p, id, numero: p.numero || `PC-${String(id).padStart(4, '0')}`, pedido_compra_itens: p.itens });
      } catch (e) { err.append(alertBox(e.message)); }
    };
    corpo.replaceChildren(
      h('div', { class: 'form-row' }, field('Fornecedor *', forn), field('Loja *', loja)),
      h('div', { class: 'form-row' },
        field('Data do pedido', input({ type: 'date', value: p.data_pedido, onInput: (e) => { p.data_pedido = e.target.value; } })),
        field('Entrega prevista', input({ type: 'date', value: p.previsao || '', onInput: (e) => { p.previsao = e.target.value; } }))),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: p.emergencial, onChange: (e) => { p.emergencial = e.target.checked; } }), 'Compra emergencial (fora da programação)'),
      h('div', { class: 'form-section-title' }, 'Itens'),
      ...p.itens.map(linhaItem), add,
      h('div', { class: 'alert info', style: { justifyContent: 'space-between' } }, h('span', {}, 'Total previsto'), totalEl),
      field('Observação', input({ value: p.observacao || '', onInput: (e) => { p.observacao = e.target.value; } })),
      err,
      h('div', { class: 'form-row' },
        h('button', { class: 'btn ghost', type: 'button', onClick: () => salvar('RASCUNHO') }, 'Salvar rascunho'),
        h('button', { class: 'btn', type: 'button', onClick: () => salvar('ENVIADO') }, 'Enviar ao fornecedor')),
      p.id ? h('button', { class: 'btn ghost small danger-text', type: 'button', onClick: async () => { ok(await sb.from('pedidos_compra').update({ status: 'CANCELADO' }).eq('id', p.id)); toast('Pedido cancelado.', 'ok'); fechar(); recarregar(); } }, 'Cancelar pedido') : null);
    tot();
  }
  desenhar();
  fechar = drawer(ped ? `Pedido ${ped.numero || '#' + ped.id}` : 'Novo pedido de compra', corpo);
}

function whatsapp(cad, p) {
  const f = cad.forn.find((x) => x.id === p.fornecedor_id) || {};
  const itens = (p.pedido_compra_itens || p.itens || []).map((i) => { const ins = cad.insMap.get(i.insumo_id); return `• ${num(i.quantidade)} ${ins?.unidade || ''} – ${ins?.nome || ''}`; }).join('\n');
  const txt = `Olá${f.nome ? ', ' + f.nome : ''}! Pedido ${p.numero || ''} da Pedacito ${lojaNome(p.loja)}:\n\n${itens}\n\n${p.previsao ? `Entrega: ${dataBR(p.previsao)}\n` : ''}Obrigado!`;
  const fone = String(f.whatsapp || f.telefone || '').replace(/\D/g, '');
  const area = h('textarea', { class: 'textarea', rows: 10, value: txt });
  drawer('Mensagem do pedido', h('div', { class: 'form-stack' }, area,
    h('div', { class: 'form-row' },
      h('button', { class: 'btn ghost', onClick: async () => { await navigator.clipboard.writeText(area.value); toast('Mensagem copiada.', 'ok'); } }, icon('copy'), 'Copiar'),
      h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: `https://wa.me/${fone ? (fone.startsWith('55') ? fone : '55' + fone) : ''}?text=${encodeURIComponent(txt)}` }, 'Abrir no WhatsApp')),
    fone ? null : h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Cadastre o WhatsApp do fornecedor para abrir direto na conversa.')));
}

function receber(cad, p, recarregar) {
  const itens = p.pedido_compra_itens.map((i) => ({ item_id: i.id, insumo_id: i.insumo_id, qtd: Number(i.quantidade) - (Number(i.qtd_recebida) || 0), preco: Number(i.preco_previsto) || 0 }));
  const f = cad.forn.find((x) => x.id === p.fornecedor_id) || {};
  const st = { nf: '', forma: f.forma_pagto || 'Boleto', conta: '', nParc: 1, parcelas: [] };
  const corpo = h('div', { class: 'form-stack' });
  let fechar;
  const total = () => itens.reduce((s, i) => s + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0);
  function gerarParcelas() {
    const t = total(); const n = Math.max(1, st.nParc); const base = Math.floor((t / n) * 100) / 100;
    st.parcelas = Array.from({ length: n }, (_, k) => { const d = new Date(); d.setDate(d.getDate() + 28 * (k + 1)); return { valor: k === n - 1 ? Math.round((t - base * (n - 1)) * 100) / 100 : base, vencimento: d.toISOString().slice(0, 10), pago: st.forma !== 'Boleto' && n === 1 }; });
  }
  gerarParcelas();
  function desenhar() {
    const err = h('div');
    const forma = select(FORMAS, { onChange: (e) => { st.forma = e.target.value; gerarParcelas(); desenhar(); } }); forma.value = st.forma;
    const conta = select([{ value: '', label: '—' }, ...cad.contas.map((c) => ({ value: c.id, label: c.nome }))], { onChange: (e) => { st.conta = e.target.value; } }); conta.value = st.conta;
    const btn = h('button', { class: 'btn block', onClick: async () => {
      btn.disabled = true;
      try {
        const r = ok(await sb.rpc('receber_pedido', { p_pedido: p.id, p_itens: itens.map(({ item_id, qtd, preco }) => ({ item_id, qtd, preco })), p_nf: st.nf, p_parcelas: st.parcelas,
          p_forma: st.forma, p_conta: Number(st.conta) || null, p_responsavel: null }));
        toast(`Recebido: ${brl(r.total)} no estoque e ${r.parcelas} conta(s) a pagar lançada(s).`, 'ok'); fechar(); recarregar();
      } catch (e) { err.append(alertBox(e.message)); btn.disabled = false; }
    } }, icon('check'), 'Confirmar recebimento');
    corpo.replaceChildren(
      h('p', { class: 'muted', style: { margin: 0 } }, 'Confira o que chegou. Isso dá entrada no estoque, atualiza o custo dos insumos e lança as contas a pagar no financeiro.'),
      ...itens.map((it) => h('div', { class: 'item-line' },
        h('div', { style: { flex: 1 } }, h('b', {}, cad.insMap.get(it.insumo_id)?.nome || '?')),
        field('Qtd recebida', input({ inputMode: 'decimal', value: it.qtd, style: { width: '90px' }, onInput: (e) => { it.qtd = Number(e.target.value.replace(',', '.')) || 0; } })),
        field('Preço un. real', input({ inputMode: 'decimal', value: it.preco, style: { width: '100px' }, onInput: (e) => { it.preco = Number(e.target.value.replace(',', '.')) || 0; } })))),
      h('button', { class: 'btn ghost small', type: 'button', onClick: () => { gerarParcelas(); desenhar(); } }, 'Recalcular total e parcelas'),
      h('div', { class: 'alert info', style: { justifyContent: 'space-between' } }, h('span', {}, 'Total recebido'), h('b', {}, brl(total()))),
      field('Número da nota fiscal', input({ value: st.nf, placeholder: 'opcional', onInput: (e) => { st.nf = e.target.value; } })),
      h('div', { class: 'form-row' }, field('Forma de pagamento', forma), field('Conta / banco', conta)),
      field('Parcelas', (() => { const s = select(['1', '2', '3', '4', '5', '6'], { onChange: (e) => { st.nParc = Number(e.target.value); gerarParcelas(); desenhar(); } }); s.value = String(st.nParc); return s; })()),
      ...st.parcelas.map((pc, k) => h('div', { class: 'form-row' },
        field(`Parcela ${k + 1} – valor`, input({ inputMode: 'decimal', value: String(pc.valor).replace('.', ','), onInput: (e) => { pc.valor = Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0; } })),
        field('Vencimento', input({ type: 'date', value: pc.vencimento, onInput: (e) => { pc.vencimento = e.target.value; } })))),
      h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: st.parcelas.every((x) => x.pago), onChange: (e) => st.parcelas.forEach((x) => { x.pago = e.target.checked; }) }), 'Já foi pago'),
      err, btn);
  }
  desenhar();
  fechar = drawer(`Receber ${p.numero || '#' + p.id}`, corpo);
}

// ---------------------------------------------------------------- SUGESTÃO
async function sugestao(area, cad) {
  area.replaceChildren(loading('Calculando...'));
  const saldos = ok(await sb.from('estoque_saldo').select('*'));
  let loja = 'VILLA';
  function desenhar() {
    const lista = saldos.filter((s) => s.loja === loja && Number(s.estoque_minimo) > 0 && Number(s.saldo) <= Number(s.estoque_minimo) * 1.2)
      .map((s) => ({ ...s, sugerido: Math.max(Number(s.estoque_minimo) * 1.2, Number(s.estoque_minimo) + 1) - Number(s.saldo) }))
      .sort((a, b) => a.saldo / (a.estoque_minimo || 1) - b.saldo / (b.estoque_minimo || 1));
    const ls = select(LOJAS, { onChange: (e) => { loja = e.target.value; desenhar(); } }); ls.value = loja;
    area.replaceChildren(
      h('div', { class: 'filters', style: { marginBottom: '14px' } }, field('Loja', ls),
        h('div', { class: 'muted', style: { fontSize: '13px', alignSelf: 'center' } }, 'Insumos abaixo ou perto do estoque mínimo. A sugestão leva o estoque a 20% acima do mínimo.')),
      card({ title: `${lista.length} insumo(s) para repor` }, table([
        { label: 'Insumo', key: 'nome' }, { label: 'Categoria', key: 'categoria' },
        { label: 'Saldo', render: (s) => `${num(s.saldo)} ${s.unidade}`, right: true },
        { label: 'Mínimo', render: (s) => `${num(s.estoque_minimo)} ${s.unidade}`, right: true },
        { label: 'Comprar', render: (s) => h('b', {}, `${num(Math.ceil(s.sugerido))} ${s.unidade}`), right: true },
        { label: 'Custo est.', render: (s) => brl(Math.ceil(s.sugerido) * (Number(s.custo_unitario) || 0)), right: true },
        { label: 'Situação', render: (s) => h('span', { class: `badge ${s.status === 'ZERADO' ? 'danger' : s.status === 'CRITICO' ? 'warn' : ''}` }, s.status === 'ZERADO' ? 'Zerado' : s.status === 'CRITICO' ? 'Crítico' : 'Perto do mínimo') },
      ], lista, { maxHeight: false, emptyText: 'Tudo acima do mínimo. 🎉' })),
      h('p', { class: 'muted', style: { fontSize: '13px' } }, 'O saldo depende das entradas, saídas e contagens registradas. Para ficar preciso, faça contagens de estoque periódicas e cadastre o estoque mínimo dos insumos.'));
  }
  desenhar();
}

// ---------------------------------------------------------------- FORNECEDORES
async function fornecedores(area) {
  await paginaLista(area, {
    tabela: 'fornecedores', titulo: 'fornecedor', novoLabel: 'Novo fornecedor', ordem: ['nome', true],
    busca: ['nome', 'cnpj', 'contato', 'categoria'],
    filtros: [{ key: 'categoria', label: 'Categoria', opcoes: ['Hortifruti', 'Laticínios', 'Carnes e frios', 'Mercearia', 'Embalagens', 'Bebidas', 'Limpeza', 'Congelados', 'Serviços', 'Outros'] }],
    colunas: [
      { label: 'Fornecedor', render: (f) => h('div', {}, h('b', {}, f.nome), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [f.categoria, f.cnpj].filter(Boolean).join(' · '))) },
      { label: 'Contato', render: (f) => [f.contato, f.whatsapp || f.telefone].filter(Boolean).join(' · ') || '—' },
      { label: 'Entrega', key: 'dias_entrega' }, { label: 'Pagamento', render: (f) => [f.forma_pagto, f.prazo_pagto].filter(Boolean).join(' · ') || '—' },
      { label: 'Avaliação', render: (f) => (f.avaliacao ? '★'.repeat(f.avaliacao) : '—') },
      { label: 'Ativo', key: 'ativo', tipo: 'bool' },
    ],
    campos: [
      { key: 'nome', label: 'Nome', obrigatorio: true },
      { key: 'cnpj', label: 'CNPJ', largura: 'meia' },
      { key: 'categoria', label: 'Categoria', tipo: 'select', opcoes: ['Hortifruti', 'Laticínios', 'Carnes e frios', 'Mercearia', 'Embalagens', 'Bebidas', 'Limpeza', 'Congelados', 'Serviços', 'Outros'], largura: 'meia' },
      { key: 'contato', label: 'Pessoa de contato', largura: 'meia' },
      { key: 'whatsapp', label: 'WhatsApp', tipo: 'tel', largura: 'meia' },
      { key: 'telefone', label: 'Telefone', tipo: 'tel', largura: 'meia' },
      { key: 'email', label: 'E-mail', tipo: 'email', largura: 'meia' },
      { key: 'dias_entrega', label: 'Dias de entrega', placeholder: 'Ex.: seg, qua, sex', largura: 'meia' },
      { key: 'pedido_minimo', label: 'Pedido mínimo (R$)', tipo: 'money', largura: 'meia' },
      { key: 'forma_pagto', label: 'Forma de pagamento', tipo: 'select', opcoes: FORMAS, largura: 'meia' },
      { key: 'prazo_pagto', label: 'Prazo', placeholder: 'Ex.: 28 dias, semanal', largura: 'meia' },
      { key: 'pix', label: 'Chave PIX', largura: 'meia' },
      { key: 'avaliacao', label: 'Avaliação', tipo: 'stars', largura: 'meia' },
      { key: 'ativo', label: 'Situação', tipo: 'bool', texto: 'Fornecedor ativo' },
      { key: 'observacao', label: 'Observações', tipo: 'textarea' },
    ],
  });
}

// ---------------------------------------------------------------- COTAÇÕES
async function cotacoes(area, cad) {
  area.replaceChildren(loading('Carregando preços...'));
  const [cots, hist] = await Promise.all([
    sb.from('cotacoes').select('*').order('data', { ascending: false }).limit(3000).then(ok),
    sb.from('precos_historico').select('*').order('data', { ascending: false }).limit(5000).then(ok),
  ]);
  let insSel = null;
  const corpo = h('div');
  const escolher = combo({ options: cad.ins.map((i) => ({ value: i.id, label: i.nome, sub: i.categoria })), placeholder: 'Escolha um insumo para comparar preços…', onSelect: (o) => { insSel = o ? o.value : null; desenhar(); } });
  area.replaceChildren(h('div', { class: 'filters', style: { marginBottom: '14px' } }, h('div', { style: { minWidth: '320px' } }, field('Insumo', escolher)),
    h('div', { style: { marginLeft: 'auto' } }, h('button', { class: 'btn', onClick: () => novaCotacao() }, icon('plus'), 'Registrar cotação'))), corpo);

  function desenhar() {
    if (!insSel) {
      const ultimas = cots.slice(0, 50);
      corpo.replaceChildren(card({ title: 'Últimas cotações registradas' }, table([
        { label: 'Data', render: (c) => dataBR(c.data) }, { label: 'Insumo', render: (c) => cad.insMap.get(c.insumo_id)?.nome || '—' },
        { label: 'Fornecedor', render: (c) => cad.fornNome.get(c.fornecedor_id) || '—' }, { label: 'Preço', render: (c) => brl(c.preco), right: true }, { label: 'Obs.', key: 'observacao' },
      ], ultimas, { maxHeight: false, emptyText: 'Nenhuma cotação ainda. Registre os preços que os fornecedores passarem para comparar.' })));
      return;
    }
    const ins = cad.insMap.get(insSel);
    const minhas = cots.filter((c) => c.insumo_id === insSel);
    const porForn = new Map(); for (const c of minhas) if (!porForn.has(c.fornecedor_id)) porForn.set(c.fornecedor_id, c);
    const ranking = [...porForn.values()].sort((a, b) => a.preco - b.preco);
    const compras = hist.filter((x) => x.insumo_id === insSel && x.origem === 'compra').slice(0, 12);
    corpo.replaceChildren(h('div', { class: 'grid g2' },
      card({ title: `Melhor preço por fornecedor – ${ins.nome}`, desc: 'Última cotação de cada um' }, table([
        { label: '#', render: (c) => String(ranking.indexOf(c) + 1) }, { label: 'Fornecedor', render: (c) => cad.fornNome.get(c.fornecedor_id) },
        { label: 'Preço', render: (c) => h('b', { style: { color: ranking[0] === c ? 'var(--revenue)' : '' } }, brl(c.preco)), right: true },
        { label: 'Data', render: (c) => dataBR(c.data) }, { label: 'Validade', render: (c) => dataBR(c.validade) },
      ], ranking, { maxHeight: false, emptyText: 'Sem cotações para este insumo.' })),
      card({ title: 'Preços pagos nas compras', desc: `Custo atual de referência: ${ins.custo_unitario ? brl(ins.custo_unitario) : '—'} / ${ins.unidade}` }, table([
        { label: 'Data', render: (c) => dataBR(c.data) }, { label: 'Preço pago', render: (c) => brl(c.preco), right: true },
      ], compras, { maxHeight: false, emptyText: 'Sem compras registradas deste insumo.' }))));
  }
  function novaCotacao() {
    const c = { insumo_id: insSel, fornecedor_id: null, preco: null, data: hojeISO(), validade: null, observacao: '' };
    const err = h('div');
    const sI = select([{ value: '', label: 'Selecione' }, ...cad.ins.map((i) => ({ value: i.id, label: i.nome }))], { onChange: (e) => { c.insumo_id = Number(e.target.value); } }); sI.value = c.insumo_id || '';
    const sF = select([{ value: '', label: 'Selecione' }, ...cad.forn.map((f) => ({ value: f.id, label: f.nome }))], { onChange: (e) => { c.fornecedor_id = Number(e.target.value); } });
    let fechar;
    const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
      e.preventDefault(); err.replaceChildren();
      if (!c.insumo_id || !c.fornecedor_id || !(c.preco > 0)) return err.append(alertBox('Preencha insumo, fornecedor e preço.'));
      try { const novo = ok(await sb.from('cotacoes').insert(c).select().single()); cots.unshift(novo); toast('Cotação registrada.', 'ok'); fechar(); insSel = c.insumo_id; desenhar(); } catch (ex) { err.append(alertBox(ex.message)); }
    } }, field('Insumo *', sI), field('Fornecedor *', sF),
    h('div', { class: 'form-row' },
      field('Preço por unidade (R$) *', input({ inputMode: 'decimal', onInput: (e) => { c.preco = Number(e.target.value.replace(/\./g, '').replace(',', '.')) || null; } })),
      field('Data', input({ type: 'date', value: c.data, onInput: (e) => { c.data = e.target.value; } }))),
    field('Válida até', input({ type: 'date', onInput: (e) => { c.validade = e.target.value || null; } })),
    field('Observação', input({ placeholder: 'Ex.: caixa com 12, frete grátis acima de R$ 300', onInput: (e) => { c.observacao = e.target.value; } })),
    err, h('button', { class: 'btn block', type: 'submit' }, 'Salvar cotação'));
    fechar = drawer('Registrar cotação', form);
  }
  desenhar();
}
