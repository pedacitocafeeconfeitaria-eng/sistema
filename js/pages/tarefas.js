// Tarefas da equipe: o líder designa (única ou recorrente) e acompanha quem já fez.
import { sb } from '../api.js';
import { h, card, field, input, select, textarea, toast, loading, alertBox, kpi, icon, dataBR, hojeISO, diaSemana } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok, drawer, abas } from '../crud.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : 'As duas lojas');
const REC = { UNICA: 'Uma vez', DIARIA: 'Todo dia', SEMANAL: 'Toda semana', MENSAL: 'Todo mês' };
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PRIO = { NORMAL: '', ALTA: 'warn', URGENTE: 'danger' };
const sel = (opts, v, f) => { const s = select(opts, { onChange: (e) => f(e.target.value) }); s.value = v ?? ''; return s; };
const quando = (t) => t.recorrencia === 'UNICA' ? `Até ${dataBR(t.prazo || t.inicio)}` : t.recorrencia === 'SEMANAL'
  ? `Toda ${(t.dias_semana || []).map((d) => DIAS[d]).join(', ') || 'semana'}` : t.recorrencia === 'MENSAL' ? `Todo dia ${t.dia_mes || Number((t.inicio || '').slice(8))}` : 'Todo dia';

export async function render(main, { session }) {
  const st = { aba: 'hoje', data: hojeISO(), loja: '' };
  pageHeader(main, { title: 'Tarefas da equipe', sub: 'Designe tarefas para cada colaborador e acompanhe quem já fez',
    actions: [h('button', { class: 'btn', onClick: () => editar() }, icon('plus'), 'Nova tarefa')] });
  const tabsBox = h('div'); const area = h('div', {}, loading());
  main.append(tabsBox, area);
  let equipe = [];

  const trocar = () => { tabsBox.replaceChildren(abas([['hoje', 'Quadro do dia'], ['todas', 'Todas as tarefas']], st.aba, (v) => { st.aba = v; trocar(); })); carregar(); };

  async function carregar() {
    area.replaceChildren(loading());
    try {
      equipe = ok(await sb.from('funcionarios').select('id,nome,loja,cargo').eq('ativo', true).order('nome'));
      st.aba === 'hoje' ? await quadro() : await todas();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  async function quadro() {
    const lista = ok(await sb.rpc('tarefas_do_dia', { p_data: st.data, p_loja: st.loja || null }));
    const feitas = lista.filter((t) => t.feita).length; const atrasadas = lista.filter((t) => t.atrasada && !t.feita).length;
    const grupos = new Map();
    lista.forEach((t) => { const k = t.responsavel || `Equipe ${lojaNome(t.loja)}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(t); });
    area.replaceChildren(
      h('div', { class: 'filters' },
        field('Dia', input({ type: 'date', value: st.data, onChange: (e) => { st.data = e.target.value || hojeISO(); carregar(); } })),
        field('Loja', sel([{ value: '', label: 'As duas lojas' }, ...LOJAS], st.loja, (v) => { st.loja = v; carregar(); }))),
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: `Tarefas · ${diaSemana(st.data)}`, value: String(lista.length) }),
        kpi({ label: 'Feitas', value: String(feitas), tone: 'revenue', hint: lista.length ? `${Math.round((feitas / lista.length) * 100)}% concluído` : '' }),
        kpi({ label: 'Pendentes', value: String(lista.length - feitas), tone: 'warning' }),
        kpi({ label: 'Atrasadas', value: String(atrasadas), tone: atrasadas ? 'expense' : 'sage' })),
      lista.length ? h('div', { class: 'grid g2' }, [...grupos].map(([pessoa, ts]) => card({ title: pessoa, desc: `${ts.filter((t) => t.feita).length} de ${ts.length} feitas` },
        ts.map((t) => h('div', { class: `item-line tarefa-linha${t.feita ? ' feita' : ''}` },
          h('span', { class: `tarefa-bolinha${t.feita ? ' ok' : t.atrasada ? ' atrasada' : ''}` }, t.feita ? icon('check') : null),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('b', {}, t.titulo),
            h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [t.hora && `até ${t.hora}`, t.setor, REC[t.recorrencia],
              t.feita ? `feita por ${t.feita_por || '—'} às ${new Date(t.feita_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : t.atrasada ? `atrasada desde ${dataBR(t.data_ref)}` : 'pendente'].filter(Boolean).join(' · ')),
            t.observacao ? h('div', { style: { fontSize: '12.5px', color: 'var(--sage-700)' } }, `“${t.observacao}”`) : null),
          t.prioridade !== 'NORMAL' ? h('span', { class: `badge ${PRIO[t.prioridade]}` }, t.prioridade === 'URGENTE' ? 'Urgente' : 'Alta') : null)))))
        : h('div', { class: 'empty' }, 'Nenhuma tarefa para este dia. Clique em "Nova tarefa" para designar.'));
  }

  async function todas() {
    const lista = ok(await sb.from('tarefas').select('*').order('ativa', { ascending: false }).order('criado_em', { ascending: false }));
    const nomeF = new Map(equipe.map((f) => [f.id, f.nome]));
    const vis = lista.filter((t) => !st.loja || !t.loja || t.loja === st.loja);
    area.replaceChildren(
      h('div', { class: 'filters' }, field('Loja', sel([{ value: '', label: 'As duas lojas' }, ...LOJAS], st.loja, (v) => { st.loja = v; carregar(); }))),
      vis.length ? card({}, h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Tarefa', 'Para quem', 'Loja', 'Quando', 'Prioridade', 'Criada por', ''].map((c) => h('th', {}, c)))),
        h('tbody', {}, vis.map((t) => h('tr', { style: { opacity: t.ativa ? 1 : 0.5, cursor: 'pointer' }, onClick: () => editar(t) },
          h('td', {}, h('b', {}, t.titulo), t.descricao ? h('div', { class: 'muted', style: { fontSize: '12px' } }, t.descricao.slice(0, 80)) : null),
          h('td', {}, nomeF.get(t.funcionario_id) || t.setor || 'Qualquer um da loja'), h('td', {}, lojaNome(t.loja)), h('td', {}, quando(t)),
          h('td', {}, t.prioridade === 'NORMAL' ? 'Normal' : h('span', { class: `badge ${PRIO[t.prioridade]}` }, t.prioridade === 'URGENTE' ? 'Urgente' : 'Alta')),
          h('td', { class: 'muted' }, t.criado_por_nome || '—'), h('td', {}, t.ativa ? '' : h('span', { class: 'badge' }, 'Encerrada'))))))))
        : h('div', { class: 'empty' }, 'Nenhuma tarefa cadastrada ainda.'));
  }

  function editar(t = null) {
    const v = t ? { ...t, dias_semana: [...(t.dias_semana || [])] } : { titulo: '', descricao: '', loja: st.loja || 'VILLA', funcionario_id: null, setor: '', recorrencia: 'UNICA', dias_semana: [], inicio: hojeISO(), prazo: hojeISO(), hora: '', prioridade: 'NORMAL', ativa: true };
    const pessoaBox = h('div'); const quandoBox = h('div', { class: 'form-stack' });
    const desenharPessoa = () => {
      const opcoes = equipe.filter((f) => !v.loja || f.loja === v.loja).map((f) => ({ value: String(f.id), label: `${f.nome}${f.cargo ? ` · ${f.cargo}` : ''}` }));
      pessoaBox.replaceChildren(field('Para quem', sel([{ value: '', label: 'Qualquer um da loja' }, ...opcoes], v.funcionario_id ? String(v.funcionario_id) : '', (x) => { v.funcionario_id = x ? Number(x) : null; })));
    };
    const desenharQuando = () => {
      const blocos = [field('Repetição', sel(Object.entries(REC).map(([value, label]) => ({ value, label })), v.recorrencia, (x) => { v.recorrencia = x; desenharQuando(); }))];
      if (v.recorrencia === 'UNICA') blocos.push(field('Fazer até o dia', input({ type: 'date', value: v.prazo || hojeISO(), onChange: (e) => { v.prazo = e.target.value; } })));
      else blocos.push(field('Começa em', input({ type: 'date', value: v.inicio || hojeISO(), onChange: (e) => { v.inicio = e.target.value; } })));
      if (v.recorrencia === 'SEMANAL') blocos.push(field('Dias da semana', h('div', { class: 'dias-semana' }, DIAS.map((d, i) => h('button', { type: 'button', class: v.dias_semana.includes(i) ? 'on' : '',
        onClick: (e) => { v.dias_semana = v.dias_semana.includes(i) ? v.dias_semana.filter((x) => x !== i) : [...v.dias_semana, i].sort(); e.target.classList.toggle('on'); } }, d)))));
      if (v.recorrencia === 'MENSAL') blocos.push(field('Dia do mês', input({ type: 'number', min: 1, max: 28, value: v.dia_mes || '', onInput: (e) => { v.dia_mes = Number(e.target.value) || null; } })));
      quandoBox.replaceChildren(...blocos);
    };
    desenharPessoa(); desenharQuando();
    const salvar = h('button', { class: 'btn' }, t ? 'Salvar' : 'Designar tarefa');
    const corpo = h('div', { class: 'form-stack' },
      field('Tarefa *', input({ value: v.titulo, placeholder: 'Ex.: Limpar a vitrine de doces', onInput: (e) => { v.titulo = e.target.value; } })),
      field('Como fazer / detalhes', textarea({ rows: 3, value: v.descricao || '', placeholder: 'Passo a passo, padrão esperado...', onInput: (e) => { v.descricao = e.target.value; } })),
      h('div', { class: 'form-row' }, field('Loja', sel(LOJAS, v.loja, (x) => { v.loja = x; v.funcionario_id = null; desenharPessoa(); })), pessoaBox),
      h('div', { class: 'form-row' }, field('Setor (opcional)', input({ value: v.setor || '', placeholder: 'Cozinha, Balcão, Limpeza...', onInput: (e) => { v.setor = e.target.value; } })),
        field('Prioridade', sel([{ value: 'NORMAL', label: 'Normal' }, { value: 'ALTA', label: 'Alta' }, { value: 'URGENTE', label: 'Urgente' }], v.prioridade, (x) => { v.prioridade = x; }))),
      quandoBox,
      field('Até que horas (opcional)', input({ type: 'time', value: v.hora || '', onInput: (e) => { v.hora = e.target.value; } })),
      t ? h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: !v.ativa, onChange: (e) => { v.ativa = !e.target.checked; } }), 'Encerrar esta tarefa (não aparece mais)') : null,
      salvar,
      t ? h('button', { class: 'btn ghost danger', onClick: async () => { if (!confirm('Excluir a tarefa e o histórico dela?')) return; try { ok(await sb.from('tarefas').delete().eq('id', t.id)); toast('Tarefa excluída.', 'ok'); fechar(); carregar(); } catch (e) { toast(e.message, 'error'); } } }, icon('trash'), 'Excluir') : null);
    const fechar = drawer(t ? 'Editar tarefa' : 'Nova tarefa', corpo);
    salvar.addEventListener('click', async () => {
      if (!v.titulo.trim()) return toast('Escreva a tarefa.', 'error');
      if (v.recorrencia === 'SEMANAL' && !v.dias_semana.length) return toast('Escolha os dias da semana.', 'error');
      const dados = { titulo: v.titulo.trim(), descricao: v.descricao || null, loja: v.loja || null, funcionario_id: v.funcionario_id, setor: v.setor || null,
        recorrencia: v.recorrencia, dias_semana: v.dias_semana, dia_mes: v.dia_mes || null, inicio: v.recorrencia === 'UNICA' ? (t?.inicio || hojeISO()) : v.inicio,
        prazo: v.recorrencia === 'UNICA' ? v.prazo : null, hora: v.hora || null, prioridade: v.prioridade, ativa: v.ativa };
      if (dados.recorrencia === 'UNICA' && dados.prazo < dados.inicio) dados.inicio = dados.prazo;
      salvar.disabled = true;
      try {
        ok(t ? await sb.from('tarefas').update(dados).eq('id', t.id) : await sb.from('tarefas').insert(dados));
        toast(t ? 'Tarefa atualizada.' : 'Tarefa designada!', 'ok'); fechar(); carregar();
      } catch (e) { toast(e.message, 'error'); salvar.disabled = false; }
    });
  }

  trocar();
}
