// Movimentação de estoque: entradas (com pagamento/boletos) e saídas (substitui movestoque.lovable.app).
import { api } from '../api.js';
import { h, card, field, input, select, textarea, combo, brl, hojeISO, diaSemana, parseNum, alertBox } from '../ui.js';
import { publicLayout, successCard, lembrar } from './_public.js';

const FORMAS = ['À vista', 'Boleto', 'Pix', 'Cartão', 'Dinheiro', 'Transferência'];
const soNumero = (v) => v.replace(/[^\d.,]/g, '');

export async function render(root) {
  const body = publicLayout(root, { title: 'Movimentação de Estoque', subtitle: 'Registre entradas e saídas de produtos do estoque.' });
  const mem = lembrar.get();
  const novo = () => ({ produto: '', unidade: '', quantidade: '', valorUnitario: '' });
  const st = { tipo: '', nome: mem.nome || '', data: hojeISO(), loja: mem.loja === 'Villa Schlosser' ? 'Villa' : mem.loja || '', observacao: '', itens: [novo()], forma: '', fornecedor: '', banco: '', obsBoleto: '', nParcelas: '1', parcelas: [] };
  let insumos = [];
  const content = h('div', { class: 'form-stack' });
  body.append(content);
  let bancos = [];
  api.get('/api/public/insumos').then((r) => { insumos = r.produtos; draw(); }).catch((e) => content.prepend(alertBox(`Falha ao carregar produtos: ${e.message}`)));
  api.get('/api/public/bancos').then((r) => { bancos = r.bancos || []; }).catch(() => {});

  const total = () => st.itens.reduce((s, i) => s + parseNum(i.quantidade) * parseNum(i.valorUnitario), 0);
  const isBoleto = () => st.tipo === 'ENTRADA' && st.forma === 'Boleto';
  const redesenhaParcelas = () => { if (isBoleto()) { recalcParcelas(); draw(); } };

  // Divide o total em parcelas; a diferença de centavos vai na primeira.
  function recalcParcelas() {
    if (!isBoleto()) { st.parcelas = []; return; }
    const n = Math.max(1, Math.min(60, parseInt(st.nParcelas, 10) || 1));
    const t = total();
    const base = Math.floor((t / n) * 100) / 100;
    const resto = Number((t - base * n).toFixed(2));
    st.parcelas = Array.from({ length: n }, (_, i) => ({ valor: (i === 0 ? base + resto : base).toFixed(2).replace('.', ','), vencimento: st.parcelas[i]?.vencimento || '' }));
  }

  function draw() {
    if (!st.tipo) {
      content.replaceChildren(card({}, h('div', { class: 'form-section-title' }, 'Tipo de movimentação'),
        h('div', { class: 'form-row' },
          h('button', { class: 'btn block', style: { background: 'var(--revenue-100)', color: 'var(--revenue)', border: '2px solid var(--revenue)', padding: '22px' }, onClick: () => { st.tipo = 'ENTRADA'; draw(); } }, 'Entrada'),
          h('button', { class: 'btn block', style: { background: 'var(--expense-100)', color: 'var(--expense)', border: '2px solid var(--expense)', padding: '22px' }, onClick: () => { st.tipo = 'SAÍDA'; draw(); } }, 'Saída'))));
      return;
    }
    const loja = select([{ value: '', label: 'Selecione' }, 'Villa', 'Souza Cruz'], { onChange: (e) => (st.loja = e.target.value) });
    loja.value = st.loja;
    const dia = input({ value: diaSemana(st.data), readOnly: true });
    const totalGeral = h('b', { class: 'tabular' }, brl(total()));

    content.replaceChildren(
      card({}, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('span', { class: `badge ${st.tipo === 'ENTRADA' ? 'ok' : 'danger'}`, style: { fontSize: '14px', padding: '6px 14px' } }, st.tipo),
        h('button', { class: 'link-btn', onClick: () => { st.tipo = ''; draw(); } }, 'Alterar'))),
      card({}, h('div', { class: 'form-section-title' }, 'Identificação'), h('div', { class: 'form-stack' },
        field('Nome *', input({ value: st.nome, placeholder: 'Seu nome', maxLength: 120, onInput: (e) => (st.nome = e.target.value) })),
        h('div', { class: 'form-row' },
          field('Data *', input({ type: 'date', value: st.data, onChange: (e) => { st.data = e.target.value; dia.value = diaSemana(st.data); } })),
          field('Dia da semana', dia)),
        field('Loja *', loja))),
      card({}, h('div', { class: 'form-section-title' }, 'Movimentação'),
        h('div', { class: 'form-stack' }, st.itens.map((it, i) => item(it, i, () => { totalGeral.textContent = brl(total()); }))),
        h('button', { class: 'link-btn', style: { marginTop: '14px' }, onClick: () => { st.itens.push(novo()); draw(); } }, '+ Adicionar outro produto')),
      st.tipo === 'ENTRADA' ? pagamento() : null,
      card({}, h('div', { class: 'form-section-title' }, 'Observação'),
        textarea({ rows: 3, maxLength: 500, value: st.observacao, placeholder: 'Alguma observação relevante...', onInput: (e) => (st.observacao = e.target.value) }),
        h('div', { class: 'alert info', style: { marginTop: '14px', justifyContent: 'space-between' } }, h('span', {}, 'Total geral'), totalGeral)),
      enviar());
  }

  function item(it, i, onTotal) {
    const unidade = input({ value: it.unidade, readOnly: true });
    const vu = input({ inputMode: 'decimal', placeholder: '0,00', value: st.tipo === 'ENTRADA' ? it.valorUnitario : brl(parseNum(it.valorUnitario)), readOnly: st.tipo !== 'ENTRADA',
      onInput: (e) => { e.target.value = soNumero(e.target.value); it.valorUnitario = e.target.value; upd(); }, onChange: redesenhaParcelas });
    const tot = input({ value: brl(parseNum(it.quantidade) * parseNum(it.valorUnitario)), readOnly: true });
    const upd = () => { tot.value = brl(parseNum(it.quantidade) * parseNum(it.valorUnitario)); onTotal(); };
    return h('div', { class: 'item-card' },
      h('div', { class: 'item-head' }, `Produto ${i + 1}`, st.itens.length > 1 ? h('button', { class: 'btn danger-text small', onClick: () => { st.itens.splice(i, 1); draw(); } }, 'Remover') : null),
      field('Produto *', combo({
        options: insumos.map((p) => ({ value: p.produto, label: p.produto, sub: `${p.unidade} · ${brl(p.valorUnidade)}`, p })),
        value: it.produto, placeholder: 'Selecione o produto',
        onSelect: (o) => {
          it.produto = o ? o.p.produto : '';
          it.unidade = o ? o.p.unidade : '';
          it.valorUnitario = o && st.tipo !== 'ENTRADA' ? String(o.p.valorUnidade) : st.tipo === 'ENTRADA' ? it.valorUnitario : '';
          unidade.value = it.unidade;
          vu.value = st.tipo === 'ENTRADA' ? it.valorUnitario : brl(parseNum(it.valorUnitario));
          upd();
        },
      })),
      h('div', { class: 'form-row' },
        field('Quantidade *', input({ inputMode: 'decimal', placeholder: '0', value: it.quantidade, onInput: (e) => { e.target.value = soNumero(e.target.value); it.quantidade = e.target.value; upd(); }, onChange: redesenhaParcelas })),
        field('Unidade', unidade)),
      h('div', { class: 'form-row' }, field(st.tipo === 'ENTRADA' ? 'Valor unitário (R$) *' : 'Valor unitário (R$)', vu), field('Valor total (R$)', tot)));
  }

  function pagamento() {
    const forma = select([{ value: '', label: 'Selecione' }, ...FORMAS], { onChange: (e) => { st.forma = e.target.value; recalcParcelas(); draw(); } });
    forma.value = st.forma;
    if (!isBoleto()) return card({}, h('div', { class: 'form-section-title' }, 'Pagamento da compra'), field('Forma de pagamento *', forma));
    if (!st.parcelas.length) recalcParcelas();
    const somaEl = h('b', { class: 'tabular' });
    const atualizaSoma = () => {
      const s = st.parcelas.reduce((a, p) => a + parseNum(p.valor), 0);
      somaEl.textContent = brl(s);
      somaEl.style.color = Math.abs(s - total()) > 0.01 ? 'var(--expense)' : '';
    };
    atualizaSoma();
    return card({}, h('div', { class: 'form-section-title' }, 'Pagamento da compra'), h('div', { class: 'form-stack' },
      field('Forma de pagamento *', forma),
      h('div', { class: 'form-row' },
        field('Fornecedor *', input({ value: st.fornecedor, placeholder: 'Nome do fornecedor', maxLength: 160, onInput: (e) => (st.fornecedor = e.target.value) })),
        field('Banco', bancos.length
          ? (() => { const s = select([{ value: '', label: 'Selecione' }, ...bancos], { onChange: (e) => (st.banco = e.target.value) }); s.value = st.banco; return s; })()
          : input({ value: st.banco, placeholder: 'Ex: SICOOB', maxLength: 80, onInput: (e) => (st.banco = e.target.value) }))),
      field('Observação do boleto', textarea({ rows: 2, value: st.obsBoleto, maxLength: 500, onInput: (e) => (st.obsBoleto = e.target.value) })),
      h('div', { class: 'alert info', style: { justifyContent: 'space-between' } }, h('span', {}, 'Valor total da compra'), h('b', {}, brl(total()))),
      field('Quantidade de parcelas *', input({ inputMode: 'numeric', value: st.nParcelas, onChange: (e) => { st.nParcelas = e.target.value.replace(/\D/g, '').slice(0, 2) || '1'; st.parcelas = st.parcelas.slice(0, Number(st.nParcelas)); recalcParcelas(); draw(); } })),
      ...st.parcelas.map((p, i) => h('div', { class: 'item-card' }, h('div', { class: 'item-head' }, `Parcela ${i + 1}/${st.parcelas.length}`),
        h('div', { class: 'form-row' },
          field('Valor (R$) *', input({ inputMode: 'decimal', value: p.valor, onInput: (e) => { e.target.value = soNumero(e.target.value); p.valor = e.target.value; atualizaSoma(); } })),
          field('Vencimento *', input({ type: 'date', value: p.vencimento, onChange: (e) => (p.vencimento = e.target.value) }))))),
      h('div', { class: 'alert info', style: { justifyContent: 'space-between' } }, h('span', {}, 'Soma das parcelas'), somaEl)));
  }

  function enviar() {
    const err = h('div');
    const btn = h('button', { class: 'btn coral block', onClick: async () => {
      err.replaceChildren();
      btn.disabled = true;
      btn.textContent = 'Registrando...';
      try {
        const r = await api.post('/api/public/movimentacao', {
          nome: st.nome, data: st.data, loja: st.loja, tipo: st.tipo, observacao: st.observacao,
          itens: st.itens.map((i) => ({ produto: i.produto, quantidade: i.quantidade, valorUnitario: i.valorUnitario })),
          pagamento: st.tipo === 'ENTRADA' ? { forma: st.forma, fornecedor: st.fornecedor, banco: st.banco, observacao: st.obsBoleto, parcelas: st.parcelas } : undefined,
        });
        lembrar.set({ nome: st.nome });
        content.replaceChildren(successCard('Movimentação registrada!', r.boletos ? `${r.boletos} boleto(s) lançado(s) no financeiro.` : 'O estoque foi atualizado.', () => {
          Object.assign(st, { tipo: '', itens: [novo()], observacao: '', forma: '', fornecedor: '', banco: '', obsBoleto: '', nParcelas: '1', parcelas: [] });
          draw();
        }, r.avisos?.length ? h('div', { class: 'alert warn' }, r.avisos.join(' ')) : null));
      } catch (e) {
        err.append(alertBox(e.message));
        btn.disabled = false;
        btn.textContent = 'Registrar movimentação';
      }
    } }, 'Registrar movimentação');
    return h('div', { class: 'form-stack' }, err, btn);
  }

  draw();
}
