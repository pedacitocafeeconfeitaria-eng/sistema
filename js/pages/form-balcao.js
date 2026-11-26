// Balcão: relatório diário (substitui registros-pedacito.lovable.app).
import { api } from '../api.js';
import { h, card, field, input, select, textarea, radios, combo, brl, hojeISO, diaSemana, parseNum, icon, alertBox } from '../ui.js';
import { publicLayout, successCard, LOJAS, TURNOS, TIPOS, lembrar } from './_public.js';

// Produto disponível na loja? (status: Ativo Villa / Ativo Souza Cruz / Ativo Ambos)
const ativoNaLoja = (status, loja) => {
  const s = (status || '').toLowerCase();
  if (s.includes('ambos')) return true;
  if (loja.toLowerCase().includes('villa')) return s.includes('villa');
  return s.includes('souza');
};

export async function render(root) {
  const body = publicLayout(root, { title: 'Relatório Diário', subtitle: 'Confeitaria — controle do balcão' });
  const mem = lembrar.get();
  const novo = () => ({ tipo: '', produto: '', quantidade: '', motivo: '', valor: 0 });
  const st = { nome: mem.nome || '', data: hojeISO(), loja: mem.loja || '', turno: '', teveProblema: '', problemas: [novo()], observacoes: '', teveFalta: '', produtosFalta: '' };
  let produtos = [];
  const content = h('div', { class: 'form-stack' });
  body.append(content);
  api.get('/api/public/produtos-venda').then((r) => { produtos = r.produtos; draw(); }).catch((e) => content.prepend(alertBox(e.message)));

  function draw() {
    const loja = select([{ value: '', label: 'Selecione' }, ...LOJAS], { onChange: (e) => { st.loja = e.target.value; draw(); } });
    loja.value = st.loja;
    const turno = select([{ value: '', label: 'Selecione' }, ...TURNOS], { onChange: (e) => (st.turno = e.target.value) });
    turno.value = st.turno;
    const dia = input({ value: diaSemana(st.data), readOnly: true });

    content.replaceChildren(
      card({}, h('div', { class: 'form-section-title' }, 'Identificação'), h('div', { class: 'form-stack' },
        field('Nome *', input({ value: st.nome, placeholder: 'Seu nome', onInput: (e) => (st.nome = e.target.value) })),
        h('div', { class: 'form-row' },
          field('Data *', input({ type: 'date', value: st.data, onChange: (e) => { st.data = e.target.value; dia.value = diaSemana(st.data); } })),
          field('Dia da semana', dia)),
        h('div', { class: 'form-row' }, field('Loja *', loja), field('Turno *', turno)))),

      card({}, h('div', { class: 'form-section-title' }, 'Problemas com produtos'), h('div', { class: 'form-stack' },
        field('Teve problema com produto? *', radios('prob', [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }], st.teveProblema, (v) => { st.teveProblema = v; if (v === 'nao') st.problemas = [novo()]; draw(); })),
        st.teveProblema === 'sim' ? [
          !st.loja ? h('div', { class: 'alert info' }, 'Selecione a loja para ver os produtos.') : null,
          ...st.problemas.map((p, i) => problema(p, i)),
          h('button', { class: 'btn ghost block', type: 'button', style: { borderStyle: 'dashed' }, onClick: () => { st.problemas.push(novo()); draw(); } }, icon('plus'), 'Adicionar outro produto'),
        ] : null)),

      card({}, h('div', { class: 'form-section-title' }, 'Observações do dia'),
        textarea({ rows: 3, value: st.observacoes, placeholder: 'Alguma observação relevante sobre o dia? (opcional)', onInput: (e) => (st.observacoes = e.target.value) })),

      card({}, h('div', { class: 'form-section-title' }, 'Falta de estoque'), h('div', { class: 'form-stack' },
        field('Teve produtos em falta? *', radios('falta', [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }], st.teveFalta, (v) => { st.teveFalta = v; if (v === 'nao') st.produtosFalta = ''; draw(); })),
        st.teveFalta === 'sim' ? field('Quais produtos tiveram falta?', textarea({ rows: 3, value: st.produtosFalta, placeholder: 'Liste os produtos que faltaram...', onInput: (e) => (st.produtosFalta = e.target.value) })) : null)),
      enviar());
  }

  function problema(p, i) {
    const lista = () => (p.tipo && st.loja ? produtos.filter((x) => x.tipo === p.tipo && ativoNaLoja(x.status, st.loja)) : []).map((x) => ({ value: x.produto, label: x.produto, sub: brl(x.valor), valor: x.valor }));
    const valor = input({ value: p.valor && parseNum(p.quantidade) ? brl(p.valor * parseNum(p.quantidade)) : '', readOnly: true, placeholder: '0,00' });
    const atualiza = () => { valor.value = p.valor && parseNum(p.quantidade) ? brl(p.valor * parseNum(p.quantidade)) : ''; };
    const tipo = select([{ value: '', label: 'Selecione o tipo' }, ...TIPOS], { onChange: (e) => { p.tipo = e.target.value; p.produto = ''; p.valor = 0; draw(); } });
    tipo.value = p.tipo;
    return h('div', { class: 'item-card' },
      h('div', { class: 'item-head' }, `Produto ${i + 1}`, st.problemas.length > 1 ? h('button', { class: 'btn danger-text small', type: 'button', onClick: () => { st.problemas.splice(i, 1); draw(); } }, 'Remover') : null),
      field('Tipo *', tipo),
      field('Produto *', combo({ options: lista(), value: p.produto, disabled: !p.tipo || !st.loja, placeholder: 'Buscar produto...', onSelect: (o) => { p.produto = o ? o.value : ''; p.valor = o ? o.valor : 0; atualiza(); } })),
      h('div', { class: 'form-row' },
        field('Quantidade *', input({ type: 'number', min: '0', value: p.quantidade, placeholder: '0', onInput: (e) => { p.quantidade = e.target.value; atualiza(); } })),
        field('Valor (R$)', valor)),
      field('Motivo *', textarea({ rows: 2, value: p.motivo, placeholder: 'Descreva o motivo do problema...', onInput: (e) => (p.motivo = e.target.value) })));
  }

  function enviar() {
    const err = h('div');
    const btn = h('button', { class: 'btn coral block', type: 'button', onClick: async () => {
      err.replaceChildren();
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        await api.post('/api/public/registro', st);
        lembrar.set({ nome: st.nome, loja: st.loja });
        content.replaceChildren(successCard('Relatório enviado com sucesso!', 'Os dados foram registrados.', () => {
          Object.assign(st, { turno: '', teveProblema: '', problemas: [novo()], observacoes: '', teveFalta: '', produtosFalta: '', data: hojeISO() });
          draw();
        }));
      } catch (e) {
        err.append(alertBox(e.message));
        btn.disabled = false;
        btn.textContent = 'Enviar relatório';
      }
    } }, 'Enviar relatório');
    return h('div', { class: 'form-stack' }, err, btn);
  }

  draw();
}
