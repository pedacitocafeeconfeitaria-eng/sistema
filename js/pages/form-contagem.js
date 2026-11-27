// Contagem de estoque: a equipe conta o que tem na loja; o sistema ajusta o saldo.
import { api } from '../api.js';
import { h, card, field, input, select, toast, num, alertBox, loading, icon } from '../ui.js';
import { publicLayout, successCard, LOJAS, lembrar, nomeSessao } from './_public.js';

export async function render(root) {
  const body = publicLayout(root, { title: 'Contagem de estoque', subtitle: 'Conte o que tem na loja e digite a quantidade de cada item.' });
  const mem = lembrar.get();
  const st = { nome: nomeSessao() || mem.nome || '', loja: mem.loja || '', q: '', cat: '', obs: '' };
  const contado = new Map();
  let itens = [];
  const content = h('div', { class: 'form-stack' });
  body.append(content);

  async function carregar() {
    if (!st.loja) return desenhar();
    content.replaceChildren(loading('Carregando itens da loja...'));
    try { itens = (await api.get(`/api/public/saldos?loja=${encodeURIComponent(st.loja)}`)).itens; } catch (e) { toast(e.message, 'error'); }
    desenhar();
  }

  function desenhar() {
    const nome = input({ value: st.nome, placeholder: 'Seu nome', readOnly: !!nomeSessao(), onInput: (e) => { st.nome = e.target.value; } });
    const loja = select([{ value: '', label: 'Selecione' }, ...LOJAS], { onChange: (e) => { st.loja = e.target.value; contado.clear(); carregar(); } });
    loja.value = st.loja;
    const cab = card({}, h('div', { class: 'form-row' }, field('Nome *', nome), field('Loja *', loja)));
    if (!st.loja) return content.replaceChildren(cab, h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Escolha a loja para ver os itens.'));
    const cats = [...new Set(itens.map((i) => i.categoria || 'Sem categoria'))].sort();
    const lista = h('div', { class: 'form-stack', style: { gap: '6px' } });
    const resumo = h('div', { class: 'muted', style: { fontSize: '13px' } });
    const atualizaResumo = () => { resumo.textContent = `${contado.size} de ${itens.length} itens contados`; };
    const desenharLista = () => {
      const q = st.q.toLowerCase();
      const vis = itens.filter((i) => (!q || i.nome.toLowerCase().includes(q)) && (!st.cat || (i.categoria || 'Sem categoria') === st.cat));
      lista.replaceChildren(...vis.map((i) => {
        const campo = input({ inputMode: 'decimal', value: contado.has(i.insumo_id) ? String(contado.get(i.insumo_id)).replace('.', ',') : '', placeholder: '—', style: { width: '96px', textAlign: 'right' },
          onInput: (e) => { const v = e.target.value.trim(); if (v === '') contado.delete(i.insumo_id); else contado.set(i.insumo_id, Number(v.replace(',', '.'))); atualizaResumo(); } });
        return h('div', { class: 'item-line', style: { padding: '8px 12px' } },
          h('div', { style: { flex: 1, minWidth: 0 } }, h('b', { style: { fontSize: '14px' } }, i.nome),
            h('div', { class: 'muted', style: { fontSize: '12px' } }, `${i.categoria || ''} · sistema: ${num(i.saldo)} ${i.unidade}`)),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, campo, h('span', { class: 'muted', style: { fontSize: '12px', width: '28px' } }, i.unidade)));
      }));
    };
    const busca = input({ value: st.q, placeholder: 'Buscar item…', onInput: (e) => { st.q = e.target.value; desenharLista(); } });
    const cat = select([{ value: '', label: 'Todas' }, ...cats], { onChange: (e) => { st.cat = e.target.value; desenharLista(); } }); cat.value = st.cat;
    const err = h('div');
    const btn = h('button', { class: 'btn coral block', onClick: async () => {
      err.replaceChildren();
      if (!st.nome.trim()) return err.append(alertBox('Informe seu nome.'));
      if (!contado.size) return err.append(alertBox('Digite a quantidade de pelo menos um item.'));
      btn.disabled = true; btn.textContent = 'Salvando...';
      try {
        const r = await api.post('/api/public/contagem', { loja: st.loja, nome: st.nome, obs: st.obs, itens: [...contado].map(([insumo_id, quantidade]) => ({ insumo_id, quantidade })) });
        lembrar.set({ nome: st.nome, loja: st.loja });
        content.replaceChildren(successCard('Contagem salva!', `${r.itens} item(ns) contado(s). ${r.ajustes} saldo(s) foram corrigidos no sistema.`, () => { contado.clear(); carregar(); }));
      } catch (e) { err.append(alertBox(e.message)); btn.disabled = false; btn.textContent = 'Salvar contagem'; }
    } }, icon('check'), 'Salvar contagem');
    content.replaceChildren(cab,
      card({}, h('div', { class: 'alert info', style: { marginBottom: '12px' } }, 'Conte o que está fisicamente na loja. Deixe em branco o que não contou — só os itens preenchidos são ajustados.'),
        h('div', { class: 'form-row' }, field('Buscar', busca), field('Categoria', cat)), h('div', { style: { margin: '10px 0' } }, resumo), lista),
      card({}, field('Observação', input({ value: st.obs, placeholder: 'Ex.: contagem parcial da geladeira', onInput: (e) => { st.obs = e.target.value; } })), err, h('div', { style: { marginTop: '12px' } }, btn)));
    desenharLista(); atualizaResumo();
  }
  carregar();
}
