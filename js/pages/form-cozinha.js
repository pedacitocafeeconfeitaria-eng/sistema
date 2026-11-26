// Cozinha: registro de produção e de desperdício (substitui cozinhapedacito.lovable.app).
import { api } from '../api.js';
import { h, card, field, input, select, seg, combo, toast, brl, hojeISO, diaSemana, parseNum, icon, alertBox } from '../ui.js';
import { publicLayout, successCard, LOJAS, TURNOS, lembrar } from './_public.js';

const CATEGORIAS = ['Doce', 'Salgado', 'Bolo Inteiro', 'Cuca Inteira'];

export async function render(root) {
  const body = publicLayout(root, { title: 'Produção e Desperdício', subtitle: 'Selecione o tipo de registro e preencha os dados.' });
  const mem = lembrar.get();
  const st = { tipo: '', nome: mem.nome || '', data: hojeISO(), loja: mem.loja || '', turno: '', itens: [] };
  let produtos = [];
  let carregando = false;

  const novoItem = () => (st.tipo === 'producao' ? { categoria: '', produto: '', valorUnitario: 0, quantidade: '', observacao: '' } : { produto: '', quantidade: '', valor: '', motivo: '' });

  async function carregarProdutos(force = false) {
    carregando = true;
    draw();
    try {
      const r = await api.get(`/api/public/produtos-venda${force ? '?force=1' : ''}`);
      produtos = r.produtos;
      if (force) toast(`${produtos.length} produtos carregados.`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    carregando = false;
    draw();
  }

  const content = h('div', { class: 'form-stack' });
  body.append(content);

  function draw() {
    content.replaceChildren(
      card({}, h('div', { class: 'form-section-title' }, 'Tipo de registro'),
        seg([{ value: 'producao', label: 'Produção' }, { value: 'desperdicio', label: 'Desperdício' }], st.tipo, (v) => {
          st.tipo = v;
          st.itens = [novoItem()];
          if (v === 'producao' && !produtos.length) carregarProdutos();
          draw();
        })),
      st.tipo ? identificacao() : h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Selecione o tipo de registro para continuar.'),
      st.tipo ? itensCard() : null,
      st.tipo ? enviar() : null);
  }

  function identificacao() {
    const loja = select([{ value: '', label: 'Selecione a loja' }, ...LOJAS], { onChange: (e) => (st.loja = e.target.value) });
    loja.value = st.loja;
    const turno = select([{ value: '', label: 'Selecione o turno' }, ...TURNOS], { onChange: (e) => (st.turno = e.target.value) });
    turno.value = st.turno;
    const dia = input({ value: diaSemana(st.data), readOnly: true });
    return card({}, h('div', { class: 'form-section-title' }, 'Identificação'),
      h('div', { class: 'form-stack' },
        field('Nome', input({ value: st.nome, placeholder: 'Seu nome', autocomplete: 'name', onInput: (e) => (st.nome = e.target.value) })),
        h('div', { class: 'form-row' },
          field('Data', input({ type: 'date', value: st.data, onChange: (e) => { st.data = e.target.value; dia.value = diaSemana(st.data); } })),
          field('Dia da semana', dia)),
        h('div', { class: 'form-row' }, field('Loja', loja), field('Turno', turno))));
  }

  function itensCard() {
    const titulo = st.tipo === 'producao' ? 'Produção' : 'Desperdício';
    return card({},
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' } },
        h('div', { class: 'form-section-title', style: { margin: 0 } }, titulo),
        st.tipo === 'producao' ? h('button', { class: 'link-btn', type: 'button', disabled: carregando, onClick: () => carregarProdutos(true) }, carregando ? 'Carregando produtos...' : '↻ Atualizar produtos') : null),
      h('div', { class: 'form-stack' }, st.itens.map((it, i) => (st.tipo === 'producao' ? itemProducao(it, i) : itemDesperdicio(it, i)))),
      h('button', { class: 'btn ghost block', type: 'button', style: { marginTop: '14px', borderStyle: 'dashed' }, onClick: () => { st.itens.push(novoItem()); draw(); } }, icon('plus'), 'Adicionar produto'));
  }

  function cabecalhoItem(i) {
    return h('div', { class: 'item-head' }, `Produto #${i + 1}`,
      st.itens.length > 1 ? h('button', { class: 'btn danger-text small', type: 'button', onClick: () => { st.itens.splice(i, 1); draw(); } }, 'Remover') : null);
  }

  function itemProducao(it, i) {
    const valor = input({ value: it.valorUnitario && it.quantidade ? brl(it.valorUnitario * parseNum(it.quantidade)) : '', readOnly: true, placeholder: 'Automático' });
    const atualizaValor = () => { valor.value = it.valorUnitario && parseNum(it.quantidade) ? brl(it.valorUnitario * parseNum(it.quantidade)) : ''; };
    const lista = () => produtos.filter((p) => p.tipo === it.categoria).map((p) => ({ value: p.produto, label: p.produto, sub: brl(p.valor), valor: p.valor }));
    const cb = combo({
      options: lista(), value: it.produto, disabled: !it.categoria,
      placeholder: it.categoria ? (lista().length ? 'Pesquisar produto...' : 'Nenhum produto encontrado') : 'Selecione a categoria primeiro',
      onSelect: (o) => { it.produto = o ? o.value : ''; it.valorUnitario = o ? o.valor : 0; atualizaValor(); },
    });
    const cat = select([{ value: '', label: 'Selecione a categoria' }, ...CATEGORIAS], { onChange: (e) => { it.categoria = e.target.value; it.produto = ''; it.valorUnitario = 0; draw(); } });
    cat.value = it.categoria;
    return h('div', { class: 'item-card' }, cabecalhoItem(i),
      field('Categoria', cat), field('Produto', cb),
      h('div', { class: 'form-row' },
        field('Quantidade', input({ type: 'number', inputMode: 'decimal', min: '0', step: '0.01', value: it.quantidade, placeholder: '0', onInput: (e) => { it.quantidade = e.target.value; atualizaValor(); } })),
        field('Valor (R$)', valor)),
      field('Observação (opcional)', input({ value: it.observacao, placeholder: 'Algum detalhe relevante', onInput: (e) => (it.observacao = e.target.value) })));
  }

  function itemDesperdicio(it, i) {
    return h('div', { class: 'item-card' }, cabecalhoItem(i),
      field('Produto', input({ value: it.produto, placeholder: 'Ex: Massa pão francês, Recheio bolo', onInput: (e) => (it.produto = e.target.value) })),
      h('div', { class: 'form-row' },
        field('Quantidade', input({ type: 'number', inputMode: 'decimal', min: '0', step: '0.01', value: it.quantidade, placeholder: '0', onInput: (e) => (it.quantidade = e.target.value) })),
        field('Valor (R$) — opcional', input({ type: 'number', inputMode: 'decimal', min: '0', step: '0.01', value: it.valor, placeholder: '0,00', onInput: (e) => (it.valor = e.target.value) }))),
      field('Motivo', input({ value: it.motivo, placeholder: 'Ex: Queimou, erro de preparo, sobra', onInput: (e) => (it.motivo = e.target.value) })));
  }

  function enviar() {
    const err = h('div');
    const btn = h('button', { class: 'btn coral block', type: 'button', onClick: async () => {
      err.replaceChildren();
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const url = st.tipo === 'producao' ? '/api/public/producao' : '/api/public/desperdicio-cozinha';
        await api.post(url, { nome: st.nome, data: st.data, loja: st.loja, turno: st.turno, produtos: st.itens });
        lembrar.set({ nome: st.nome, loja: st.loja });
        content.replaceChildren(successCard(st.tipo === 'producao' ? 'Produção registrada!' : 'Desperdício registrado!', 'Os dados foram salvos no sistema.', () => { st.itens = [novoItem()]; draw(); }));
      } catch (e) {
        err.append(alertBox(e.message));
        btn.disabled = false;
        btn.textContent = 'Enviar';
      }
    } }, 'Enviar');
    return h('div', { class: 'form-stack' }, err, btn);
  }

  draw();
}
