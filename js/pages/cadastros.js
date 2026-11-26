// Cadastros: produtos de venda (BASE_PRODUTOS) e insumos do estoque (BASE_ESTOQUE).
import { api } from '../api.js';
import { h, card, field, input, select, combo, table, toast, brl, num, parseNum, loading, alertBox, icon } from '../ui.js';
import { pageHeader } from './_painel.js';

const CONF = {
  produtos: {
    titulo: 'Cadastro de produtos', sub: 'Produtos vendidos pela confeitaria', url: '/api/cad/produtos',
    vazio: () => ({ rowIndex: null, produto: '', tipo: '', valor: '', status: 'Ativo Ambos' }),
  },
  insumos: {
    titulo: 'Cadastro de insumos', sub: 'Insumos controlados no estoque', url: '/api/cad/insumos',
    vazio: () => ({ rowIndex: null, produto: '', categoria: '', unidade: '', estoqueMinimo: '', valorUnidade: '', status: 'ATIVO' }),
  },
};
const TIPOS = ['Doce', 'Salgado', 'Bebida', 'Bolo Inteiro', 'Cuca Inteira'];
const STATUS = ['Ativo Villa', 'Ativo Souza Cruz', 'Ativo Ambos', 'Inativo'];
const UNIDADES = ['KG', 'G', 'L', 'ML', 'UN', 'CX', 'PCT'];
const CATEGORIAS = ['Insumo', 'Embalagem', 'Bebida', 'Limpeza', 'Produção', 'Refrigerado'];

export async function render(main, { match, session }) {
  const tipo = match[1];
  const C = CONF[tipo];
  pageHeader(main, { title: C.titulo, sub: C.sub, onRefresh: () => carregar() });
  const area = h('div', {}, loading());
  main.append(area);
  let lista = [];
  let form = C.vazio();
  let busca = '';

  async function carregar() {
    area.replaceChildren(loading());
    try {
      lista = (await api.get(C.url)).produtos;
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.message));
    }
  }

  function desenhar() {
    const editando = !!form.rowIndex;
    const err = h('div');
    const salvar = h('button', { class: 'btn block', type: 'submit', style: { marginTop: '6px', background: 'var(--revenue)' } }, icon('check'), editando ? 'Salvar alterações' : tipo === 'produtos' ? 'Salvar produto' : 'Cadastrar produto');
    const campos = tipo === 'produtos' ? [
      field('Produto *', input({ value: form.produto, placeholder: 'Ex: Brigadeiro, Torta de Limão, Café Expresso...', onInput: (e) => (form.produto = e.target.value) })),
      h('div', { class: 'form-row' },
        field('Tipo *', sel([{ value: '', label: 'Selecione' }, ...TIPOS], form.tipo, (v) => (form.tipo = v))),
        field('Valor (R$) *', input({ inputMode: 'decimal', value: form.valor === '' ? '' : String(form.valor).replace('.', ','), placeholder: '0,00', onInput: (e) => (form.valor = e.target.value) }))),
      field('Status *', sel(STATUS, form.status, (v) => (form.status = v))),
    ] : [
      field('Produto *', input({ value: form.produto, placeholder: 'Ex: Farinha de trigo', onInput: (e) => (form.produto = e.target.value) })),
      h('div', { class: 'form-row' },
        field('Categoria *', h('div', {}, input({ list: 'cat-list', value: form.categoria, placeholder: 'Selecione ou digite', onInput: (e) => (form.categoria = e.target.value) }), h('datalist', { id: 'cat-list' }, CATEGORIAS.map((c) => h('option', { value: c }))))),
        field('Unidade *', sel([{ value: '', label: 'Selecione' }, ...UNIDADES], form.unidade, (v) => (form.unidade = v)))),
      h('div', { class: 'form-row' },
        field('Estoque mínimo', input({ inputMode: 'decimal', value: form.estoqueMinimo === '' ? '' : String(form.estoqueMinimo).replace('.', ','), placeholder: '0', onInput: (e) => (form.estoqueMinimo = e.target.value) })),
        field('Valor unidade (R$)', input({ inputMode: 'decimal', value: form.valorUnidade === '' ? '' : String(form.valorUnidade).replace('.', ','), placeholder: '0,00', onInput: (e) => (form.valorUnidade = e.target.value) }))),
      field('Status', sel([{ value: 'ATIVO', label: 'Ativo' }, { value: 'INATIVO', label: 'Inativo' }], form.status, (v) => (form.status = v))),
    ];

    const filtrados = lista.filter((p) => !busca || p.produto.toLowerCase().includes(busca.toLowerCase()));
    area.replaceChildren(h('div', { class: 'grid g2' },
      h('div', { class: 'form-stack' },
        card({ title: 'Editar produto existente' }, h('div', { style: { display: 'flex', gap: '8px' } },
          h('div', { style: { flex: 1 } }, combo({
            options: lista.map((p) => ({ value: p.rowIndex, label: p.produto, sub: tipo === 'produtos' ? `${p.tipo} · ${p.status}` : `${p.categoria} · ${p.status}`, p })),
            placeholder: 'Buscar produto cadastrado...',
            onSelect: (o) => { if (o) { form = { ...o.p }; desenhar(); } },
          })),
          editando ? h('button', { class: 'btn ghost', onClick: () => { form = C.vazio(); desenhar(); } }, icon('plus'), 'Novo') : null)),
        card({ title: editando ? `Atualizar produto` : 'Dados do produto' },
          h('form', { class: 'form-stack', onSubmit: async (e) => {
            e.preventDefault();
            err.replaceChildren();
            salvar.disabled = true;
            try {
              const body = tipo === 'produtos' ? { ...form, valor: parseNum(form.valor) } : { ...form, estoqueMinimo: parseNum(form.estoqueMinimo), valorUnidade: parseNum(form.valorUnidade) };
              await api.post(C.url, body);
              toast(editando ? 'Produto atualizado com sucesso' : 'Produto cadastrado com sucesso', 'ok');
              form = C.vazio();
              await carregar();
            } catch (ex) {
              err.append(alertBox(ex.message));
              salvar.disabled = false;
            }
          } }, ...campos, err, salvar))),
      card({ title: `Produtos cadastrados (${lista.length})`, actions: input({ placeholder: 'Filtrar...', value: busca, style: { maxWidth: '200px', padding: '7px 10px' }, onInput: (e) => { busca = e.target.value; desenhar(); setTimeout(() => { const i = area.querySelector('input[placeholder="Filtrar..."]'); i.focus(); i.setSelectionRange(busca.length, busca.length); }); } }) },
        table(tipo === 'produtos' ? [
          { label: 'Produto', key: 'produto' }, { label: 'Tipo', key: 'tipo' },
          { label: 'Valor', right: true, render: (p) => brl(p.valor) },
          { label: 'Status', render: (p) => h('span', { class: `badge ${p.status === 'Inativo' ? 'danger' : 'ok'}` }, p.status) },
          { label: '', render: (p) => h('button', { class: 'link-btn', onClick: () => { form = { ...p }; desenhar(); window.scrollTo(0, 0); } }, 'Editar') },
        ] : [
          { label: 'Produto', key: 'produto' }, { label: 'Categoria', key: 'categoria' }, { label: 'Un.', key: 'unidade' },
          { label: 'Mínimo', right: true, render: (p) => num(p.estoqueMinimo) },
          { label: 'Valor', right: true, render: (p) => (p.valorUnidade ? brl(p.valorUnidade) : '—') },
          { label: 'Status', render: (p) => h('span', { class: `badge ${p.status === 'INATIVO' ? '' : 'ok'}` }, p.status) },
          { label: '', render: (p) => h('button', { class: 'link-btn', onClick: () => { form = { ...p }; desenhar(); window.scrollTo(0, 0); } }, 'Editar') },
        ], filtrados))));
  }

  await carregar();
}

function sel(options, value, onChange) {
  const s = select(options, { onChange: (e) => onChange(e.target.value) });
  s.value = value || '';
  return s;
}
