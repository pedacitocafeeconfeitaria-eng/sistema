// Lista de compras compartilhada (substitui listacomprapedacito.lovable.app).
import { api } from '../api.js';
import { h, card, field, input, select, textarea, toast, icon, alertBox, empty, loading } from '../ui.js';
import { publicLayout } from './_public.js';

export async function render(root) {
  const body = publicLayout(root, { title: 'Lista de Compras', subtitle: 'Cozinha · sincronizada entre as lojas' });
  const st = { produto: '', quantidade: '', observacao: '', loja: 'Villa' };
  let itens = [];
  let origem = '';
  const lista = h('div', {}, loading('Carregando lista...'));

  async function carregar() {
    try {
      const r = await api.get('/api/public/lista');
      itens = r.itens || [];
      origem = r.origem;
      drawLista();
    } catch (e) {
      lista.replaceChildren(alertBox(e.message));
    }
  }

  const prod = input({ placeholder: 'Ex.: Arroz, Óleo, Detergente...' });
  const qtd = input({ placeholder: 'Ex.: 2 kg' });
  const obs = textarea({ rows: 2, placeholder: 'Marca, tamanho, detalhes...' });
  const loja = select(['Villa', 'Souza Cruz']);
  const add = h('button', { class: 'btn coral block', type: 'submit' }, icon('plus'), 'Adicionar item');

  body.append(
    card({}, h('div', { class: 'form-section-title' }, 'Adicionar item'),
      h('form', { class: 'form-stack', onSubmit: async (e) => {
        e.preventDefault();
        if (!prod.value.trim()) return toast('Informe o produto', 'error');
        add.disabled = true;
        try {
          await api.post('/api/public/lista', { produto: prod.value, quantidade: qtd.value, observacao: obs.value, loja: loja.value });
          prod.value = ''; qtd.value = ''; obs.value = '';
          await carregar();
          prod.focus();
        } catch (ex) { toast(ex.message, 'error'); }
        add.disabled = false;
      } },
      field('Produto *', prod), h('div', { class: 'form-row' }, field('Quantidade', qtd), field('Loja', loja)), field('Observação', obs), add)),
    card({ title: 'Lista de compras', actions: h('div', { id: 'lista-acoes' }) }, lista));

  function drawLista() {
    const comprados = itens.filter((i) => i.comprado).length;
    const acoes = document.getElementById('lista-acoes');
    acoes.replaceChildren(comprados ? h('button', { class: 'btn ghost small', onClick: async () => {
      if (!confirm(`Remover ${comprados} item(ns) já comprado(s) da lista?`)) return;
      try { await api.del('/api/public/lista/comprados'); await carregar(); } catch (e) { toast(e.message, 'error'); }
    } }, `Limpar comprados (${comprados})`) : '');
    const ordenados = [...itens].sort((a, b) => (a.comprado !== b.comprado ? (a.comprado ? 1 : -1) : String(b.created_at).localeCompare(String(a.created_at))));
    lista.replaceChildren(
      origem === 'lovable' ? h('div', { class: 'alert info', style: { marginBottom: '12px', fontSize: '12.5px' } }, 'Usando a lista antiga (Lovable) até o Apps Script do sistema ser configurado.') : '',
      ordenados.length ? h('div', { class: 'form-stack', style: { gap: '8px' } }, ordenados.map((it) => h('div', { class: `check-item${it.comprado ? ' done' : ''}` },
        h('input', { type: 'checkbox', checked: it.comprado, onChange: async () => {
          it.comprado = !it.comprado; drawLista();
          try { await api.patch(`/api/public/lista/${encodeURIComponent(it.id)}`, { comprado: it.comprado }); } catch (e) { toast(e.message, 'error'); carregar(); }
        } }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', {}, h('span', { class: 'ci-name' }, it.produto), it.quantidade ? h('span', { class: 'muted', style: { marginLeft: '8px' } }, it.quantidade) : ''),
          it.observacao ? h('div', { class: 'muted', style: { fontSize: '13.5px', marginTop: '2px' } }, it.observacao) : '',
          h('div', { style: { marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px' } },
            h('span', { class: 'badge' }, it.loja || '—'),
            it.created_at ? h('span', { class: 'muted' }, new Date(it.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '')),
        h('button', { class: 'btn danger-text', title: 'Excluir item', onClick: async () => {
          try { await api.del(`/api/public/lista/${encodeURIComponent(it.id)}`); itens = itens.filter((x) => x !== it); drawLista(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('trash'))))) : empty('Nenhum item na lista.'));
  }

  await carregar();
  // Atualiza sozinha a cada 15 s enquanto a tela estiver aberta.
  const timer = setInterval(() => { if (!document.body.contains(lista)) return clearInterval(timer); if (!document.hidden) carregar(); }, 15000);
}
