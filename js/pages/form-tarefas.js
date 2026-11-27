// Minhas tarefas: o colaborador escolhe o nome e marca o que já fez hoje.
import { api } from '../api.js';
import { h, card, field, select, toast, loading, icon, dataBR, hojeISO } from '../ui.js';
import { publicLayout, LOJAS, lembrar } from './_public.js';

const PRIO = { URGENTE: { label: 'Urgente', cls: 'danger' }, ALTA: { label: 'Alta', cls: 'warn' } };

export async function render(root) {
  const body = publicLayout(root, { title: 'Minhas tarefas', subtitle: 'O que o líder passou para você hoje.' });
  const mem = lembrar.get();
  const st = { loja: mem.loja || '', func: mem.funcionario_id ? String(mem.funcionario_id) : '', nome: mem.nome || '' };
  const topo = h('div', { class: 'form-stack' }); const lista = h('div', { class: 'form-stack' });
  body.append(topo, lista);
  let equipe = [];

  async function carregarEquipe() {
    equipe = [];
    if (st.loja) { try { equipe = await api.get(`/api/public/equipe?loja=${encodeURIComponent(st.loja)}`); } catch (e) { toast(e.message, 'error'); } }
    if (!equipe.some((p) => String(p.id) === st.func)) st.func = '';
    desenharTopo(); carregarTarefas();
  }

  function desenharTopo() {
    const loja = select([{ value: '', label: 'Selecione' }, ...LOJAS], { onChange: (e) => { st.loja = e.target.value; lembrar.set({ loja: st.loja }); carregarEquipe(); } });
    loja.value = st.loja;
    const pessoa = select([{ value: '', label: st.loja ? 'Escolha seu nome' : 'Escolha a loja primeiro' }, ...equipe.map((p) => ({ value: String(p.id), label: p.nome }))], {
      onChange: (e) => { st.func = e.target.value; const p = equipe.find((x) => String(x.id) === st.func); st.nome = p?.nome || ''; lembrar.set({ funcionario_id: st.func, nome: st.nome }); carregarTarefas(); } });
    pessoa.value = st.func;
    topo.replaceChildren(card({}, h('div', { class: 'form-row' }, field('Loja', loja), field('Seu nome', pessoa))));
  }

  async function carregarTarefas() {
    if (!st.loja || !st.func) { lista.replaceChildren(h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Escolha a loja e o seu nome para ver suas tarefas.')); return; }
    lista.replaceChildren(loading('Buscando suas tarefas...'));
    let tarefas = [];
    try { tarefas = await api.get(`/api/public/minhas-tarefas?loja=${encodeURIComponent(st.loja)}&f=${st.func}`); } catch (e) { toast(e.message, 'error'); }
    const feitas = tarefas.filter((t) => t.feita).length;
    lista.replaceChildren(
      h('div', { class: 'tarefas-resumo' }, h('b', {}, `${feitas} de ${tarefas.length}`), ' tarefas feitas hoje', h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${tarefas.length ? (feitas / tarefas.length) * 100 : 0}%`, '--bar': 'var(--revenue)' } }))),
      !tarefas.length ? card({}, h('div', { class: 'empty' }, 'Nenhuma tarefa para você hoje. 🎉')) : null,
      ...tarefas.map((t) => {
        const obs = h('input', { class: 'input', placeholder: 'Observação (opcional)', style: { marginTop: '8px', display: 'none' } });
        const marcar = async (desfazer) => {
          try {
            await api.post('/api/public/tarefa', { id: t.id, data: t.data_ref || hojeISO(), nome: st.nome, obs: obs.value, desfazer });
            toast(desfazer ? 'Tarefa reaberta.' : 'Tarefa concluída!', 'ok'); carregarTarefas();
          } catch (e) { toast(e.message, 'error'); }
        };
        const p = PRIO[t.prioridade];
        return h('div', { class: `card tarefa${t.feita ? ' feita' : ''}${t.atrasada ? ' atrasada' : ''}` },
          h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
            h('button', { class: 'tarefa-check', 'aria-label': t.feita ? 'Desfazer' : 'Marcar como feita', onClick: () => marcar(t.feita) }, t.feita ? icon('check') : null),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', { class: 'tarefa-titulo' }, t.titulo),
                p ? h('span', { class: `badge ${p.cls}` }, p.label) : null, t.atrasada && !t.feita ? h('span', { class: 'badge danger' }, `Atrasada · ${dataBR(t.data_ref)}`) : null),
              t.descricao ? h('div', { class: 'muted', style: { fontSize: '13.5px', whiteSpace: 'pre-wrap', marginTop: '2px' } }, t.descricao) : null,
              h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
                [t.hora && `até ${t.hora}`, t.setor, !t.responsavel && 'para a equipe da loja', t.feita && t.feita_por && `feita por ${t.feita_por}`].filter(Boolean).join(' · ')),
              !t.feita ? h('button', { class: 'link-btn muted', style: { fontSize: '12.5px', marginTop: '4px' }, onClick: () => { obs.style.display = obs.style.display ? '' : 'none'; } }, '+ observação') : null,
              obs)));
      }));
  }

  desenharTopo();
  await carregarEquipe();
}
