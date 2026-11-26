// Fichas técnicas: receita de cada produto, custo automático, CMV e margem.
import { sb } from '../api.js';
import { h, kpi, field, input, select, table, toast, loading, alertBox, icon, brl, num, pct, combo } from '../ui.js';
import { pageHeader } from './_painel.js';
import { drawer, ok } from '../crud.js';

const META_CMV = 35; // meta imediata; ideal 25–32%
const corCmv = (v) => (v == null ? '' : v <= 32 ? 'ok' : v <= META_CMV ? 'warn' : 'danger');

export async function render(main) {
  pageHeader(main, { title: 'Fichas técnicas', sub: `Custo de cada produto e CMV · meta: até ${META_CMV}% (ideal 25–32%)` });
  const area = h('div', {}, loading('Calculando custos...'));
  main.append(area);
  const st = { q: '', tipo: '', faixa: '' };
  let fichas = [], insumos = [], produtos = [];

  async function carregar() {
    area.replaceChildren(loading('Calculando custos...'));
    try {
      [fichas, insumos, produtos] = await Promise.all([
        sb.from('fichas_custo').select('*').order('nome').then(ok),
        sb.from('insumos').select('id,nome,unidade,custo_unitario,categoria,uso').eq('ativo', true).order('nome').then(ok),
        sb.from('produtos').select('id,nome,tipo,preco').order('nome').then(ok),
      ]);
      desenhar();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    const vendaveis = fichas.filter((f) => f.tipo !== 'Preparo');
    const vis = fichas.filter((f) => (!st.q || f.nome.toLowerCase().includes(st.q)) && (!st.tipo || f.tipo === st.tipo)
      && (!st.faixa || (st.faixa === 'acima' ? Number(f.cmv_pct) > META_CMV : st.faixa === 'sempreco' ? !f.preco && f.tipo !== 'Preparo' : st.faixa === 'semcusto' ? f.itens_sem_custo > 0 : true)));
    const comCmv = vendaveis.filter((f) => f.cmv_pct != null);
    const media = comCmv.length ? comCmv.reduce((s, f) => s + Number(f.cmv_pct), 0) / comCmv.length : 0;
    const tipos = [...new Set(fichas.map((f) => f.tipo))].sort();
    const sel = (opts, key) => { const s = select(opts, { onChange: (e) => { st[key] = e.target.value; desenhar(); } }); s.value = st[key]; return s; };
    area.replaceChildren(
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Fichas cadastradas', value: num(fichas.length), tone: 'sage', hint: `${fichas.filter((f) => f.tipo === 'Preparo').length} são preparos (sub-receitas)` }),
        kpi({ label: 'CMV médio dos produtos', value: pct(media), tone: media > META_CMV ? 'expense' : 'revenue', hint: 'média simples entre produtos com preço' }),
        kpi({ label: `Acima de ${META_CMV}%`, value: num(comCmv.filter((f) => f.cmv_pct > META_CMV).length), tone: 'expense', hint: 'revisar preço ou receita' }),
        kpi({ label: 'Com insumo sem custo', value: num(fichas.filter((f) => f.itens_sem_custo > 0).length), tone: 'warning', hint: 'custo pode estar subestimado' })),
      h('div', { class: 'filters', style: { marginBottom: '14px' } },
        field('Busca', input({ value: st.q, placeholder: 'Nome do produto', onInput: (e) => { st.q = e.target.value.toLowerCase(); desenhar(); } })),
        field('Tipo', sel([{ value: '', label: 'Todos' }, ...tipos], 'tipo')),
        field('Mostrar', sel([{ value: '', label: 'Todas' }, { value: 'acima', label: `CMV acima de ${META_CMV}%` }, { value: 'sempreco', label: 'Sem preço de venda' }, { value: 'semcusto', label: 'Com insumo sem custo' }], 'faixa')),
        h('div', { style: { marginLeft: 'auto' } }, h('button', { class: 'btn', onClick: () => editar(null) }, icon('plus'), 'Nova ficha'))),
      h('div', { class: 'card', style: { padding: '6px 10px' } }, table([
        { label: 'Produto', render: (f) => h('div', {}, h('button', { class: 'link-btn', onClick: () => editar(f) }, h('b', {}, f.nome)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${f.tipo} · ${f.n_itens} insumo(s)`)) },
        { label: 'Rendimento', render: (f) => (f.tipo === 'Preparo' ? `${num(f.rendimento)} ${f.rendimento_unidade.toLowerCase()}` : num(f.rendimento)) },
        { label: 'Custo', render: (f) => (f.tipo === 'Preparo' ? h('span', {}, brl(f.custo_total), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${brl(f.custo_unidade * 1000)}/${f.rendimento_unidade === 'ML' ? 'L' : 'kg'}`)) : brl(f.custo_unidade)), right: true },
        { label: 'Preço', render: (f) => (f.preco ? brl(f.preco) : '—'), right: true },
        { label: 'Margem', render: (f) => (f.preco ? brl(f.preco - f.custo_unidade) : '—'), right: true },
        { label: 'CMV', render: (f) => (f.cmv_pct != null ? h('span', { class: `badge ${corCmv(Number(f.cmv_pct))}` }, pct(f.cmv_pct)) : '—'), right: true },
        { label: '', render: (f) => (f.itens_sem_custo > 0 ? h('span', { class: 'badge warn', title: 'Algum insumo está sem custo cadastrado' }, '⚠ custo') : '') },
      ], vis, { maxHeight: false, emptyText: 'Nenhuma ficha com esses filtros.' })));
  }

  async function editar(f) {
    const corpo = h('div', {}, loading('Abrindo ficha...'));
    const fechar = drawer(f ? f.nome : 'Nova ficha técnica', corpo);
    const ficha = f ? ok(await sb.from('fichas_tecnicas').select('*').eq('produto_id', f.produto_id).single()) : { rendimento: 1, rendimento_unidade: 'UN' };
    let itens = f ? ok(await sb.from('ficha_itens').select('*').eq('produto_id', f.produto_id)) : [];
    const insMap = new Map(insumos.map((i) => [i.id, i]));
    let produtoId = f?.produto_id || null;
    let preco = f?.preco ?? null;
    const totalEl = h('b'); const cmvEl = h('span');
    const recalcular = () => {
      const custo = itens.reduce((s, it) => s + (Number(it.quantidade) || 0) * (Number(insMap.get(it.insumo_id)?.custo_unitario) || 0), 0) / (Number(ficha.rendimento) || 1);
      totalEl.textContent = brl(custo);
      cmvEl.replaceChildren(preco ? h('span', { class: `badge ${corCmv((custo / preco) * 100)}` }, `CMV ${pct((custo / preco) * 100)} · margem ${brl(preco - custo)}`) : '');
    };
    function desenhar2() {
      const err = h('div');
      const linhas = itens.map((it) => {
        const ins = insMap.get(it.insumo_id) || {};
        const custoLinha = h('span', { class: 'muted', style: { fontSize: '12.5px' } });
        const atual = () => { custoLinha.textContent = brl((Number(it.quantidade) || 0) * (Number(ins.custo_unitario) || 0)); recalcular(); };
        const q = input({ inputMode: 'decimal', value: String(it.quantidade ?? '').replace('.', ','), style: { width: '100px' }, onInput: (e) => { it.quantidade = Number(e.target.value.replace(',', '.')) || 0; atual(); } });
        atual();
        return h('div', { class: 'item-line' },
          h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, ins.nome || '?'),
            h('div', { class: 'muted', style: { fontSize: '12px' } }, ins.custo_unitario ? `${brl(ins.custo_unitario)} por ${String(ins.unidade).toLowerCase()}` : h('span', { style: { color: 'var(--warning)' } }, 'sem custo cadastrado'))),
          field(`Qtd (${String(ins.unidade || '').toLowerCase()})`, q), h('div', { style: { width: '80px', textAlign: 'right' } }, custoLinha),
          h('button', { class: 'icon-btn', type: 'button', onClick: () => { itens = itens.filter((x) => x !== it); desenhar2(); } }, icon('trash')));
      });
      const add = combo({ options: insumos.map((i) => ({ value: i.id, label: i.nome, sub: `${i.unidade}${i.custo_unitario ? ' · ' + brl(i.custo_unitario) : ''}` })), placeholder: 'Adicionar insumo…',
        onSelect: (o) => { if (!o) return; itens.push({ insumo_id: o.value, quantidade: 0 }); desenhar2(); } });
      const prodSel = f ? null : combo({ options: produtos.filter((p) => !fichas.some((x) => x.produto_id === p.id)).map((p) => ({ value: p.id, label: p.nome, sub: p.tipo })), placeholder: 'Escolha o produto…',
        onSelect: (o) => { produtoId = o?.value || null; preco = produtos.find((p) => p.id === produtoId)?.preco ?? null; recalcular(); } });
      const rend = input({ inputMode: 'decimal', value: String(ficha.rendimento).replace('.', ','), onInput: (e) => { ficha.rendimento = Number(e.target.value.replace(',', '.')) || 1; recalcular(); } });
      const run = select([{ value: 'UN', label: 'unidades / porções' }, { value: 'G', label: 'gramas (preparo)' }, { value: 'ML', label: 'ml (preparo)' }], { onChange: (e) => { ficha.rendimento_unidade = e.target.value; } });
      run.value = ficha.rendimento_unidade;
      const precoIn = input({ inputMode: 'decimal', value: preco ? String(preco).replace('.', ',') : '', placeholder: '0,00', onInput: (e) => { preco = Number(e.target.value.replace(/\./g, '').replace(',', '.')) || null; recalcular(); } });
      const btn = h('button', { class: 'btn block' }, icon('check'), 'Salvar ficha');
      btn.onclick = async () => {
        err.replaceChildren();
        if (!produtoId) return err.append(alertBox('Escolha o produto.'));
        btn.disabled = true;
        try {
          ok(await sb.from('fichas_tecnicas').upsert({ produto_id: produtoId, rendimento: ficha.rendimento, rendimento_unidade: ficha.rendimento_unidade, modo_preparo: ficha.modo_preparo || null, atualizado_em: new Date().toISOString() }));
          ok(await sb.from('ficha_itens').delete().eq('produto_id', produtoId));
          const novos = itens.filter((i) => i.insumo_id && Number(i.quantidade) > 0).map((i) => ({ produto_id: produtoId, insumo_id: i.insumo_id, quantidade: Number(i.quantidade) }));
          if (novos.length) ok(await sb.from('ficha_itens').insert(novos));
          if (preco !== (f?.preco ?? null)) ok(await sb.from('produtos').update({ preco }).eq('id', produtoId));
          toast('Ficha salva.', 'ok'); fechar(); carregar();
        } catch (e) { err.append(alertBox(e.message)); btn.disabled = false; }
      };
      corpo.replaceChildren(h('div', { class: 'form-stack' },
        prodSel ? field('Produto *', prodSel) : null,
        h('div', { class: 'form-row' }, field('Rendimento', rend), field('Rende em', run)),
        field('Preço de venda (R$)', precoIn),
        h('div', { class: 'form-section-title' }, 'Insumos (quantidade por receita)'),
        ...linhas, add,
        h('div', { class: 'alert info', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } }, h('span', {}, 'Custo por unidade: ', totalEl), cmvEl),
        field('Modo de preparo / observações', h('textarea', { class: 'textarea', rows: 4, value: ficha.modo_preparo || '', onInput: (e) => { ficha.modo_preparo = e.target.value; } })),
        err, btn));
      recalcular();
    }
    desenhar2();
  }

  carregar();
}
