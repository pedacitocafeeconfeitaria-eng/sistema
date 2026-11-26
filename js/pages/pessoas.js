// Gestão de pessoas: colaboradores, ocorrências, férias e documentos.
import { sb } from '../api.js';
import { h, kpi, card, brl, num, dataBR, hojeISO, loading, alertBox, table, icon } from '../ui.js';
import { pageHeader } from './_painel.js';
import { paginaLista, abas, ok, formulario, abrirArquivo, drawer } from '../crud.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : '—');
const CARGOS = ['Balconista', 'Atendente', 'Barista', 'Caixa', 'Confeiteiro(a)', 'Auxiliar de cozinha', 'Cozinheiro(a)', 'Padeiro(a)', 'Auxiliar de limpeza', 'Líder', 'Gerente', 'Administrativo', 'Entregador', 'Outro'];
const VINCULOS = ['CLT', 'Experiência', 'Estágio', 'Jovem Aprendiz', 'PJ', 'Diarista / Freelancer', 'Sócio'];
const OCORRENCIAS = ['Falta', 'Atraso', 'Atestado', 'Advertência', 'Suspensão', 'Elogio', 'Feedback', 'Treinamento', 'Outro'];
const COR_OC = { Falta: 'danger', Atraso: 'warn', Atestado: 'info', Advertência: 'danger', Suspensão: 'danger', Elogio: 'ok', Feedback: '', Treinamento: 'info', Outro: '' };
const DOCS = ['Contrato de trabalho', 'RG / CPF', 'Carteira de trabalho', 'ASO (exame)', 'Certificado / curso', 'Termo assinado', 'Comprovante de endereço', 'Outro'];

export async function render(main, { match }) {
  const aba = match[1] || 'equipe';
  pageHeader(main, { title: 'Gestão de pessoas', sub: 'Equipe, ocorrências, férias e documentos' });
  main.append(abas([['equipe', 'Equipe'], ['ocorrencias', 'Ocorrências'], ['ferias', 'Férias'], ['documentos', 'Documentos']], aba, (id) => { location.hash = `/gestao/pessoas/${id}`; }));
  const area = h('div', { style: { marginTop: '16px' } }, loading('Carregando...'));
  main.append(area);
  const func = ok(await sb.from('funcionarios').select('id,nome,loja,cargo,ativo').order('nome'));
  const opFunc = func.filter((f) => f.ativo).map((f) => ({ value: String(f.id), label: `${f.nome} (${lojaNome(f.loja)})` }));
  const nomeF = new Map(func.map((f) => [f.id, f.nome]));
  const campoFunc = { key: 'funcionario_id', label: 'Colaborador', tipo: 'select', opcoes: opFunc, obrigatorio: true };
  const colFunc = { label: 'Colaborador', render: (r) => nomeF.get(r.funcionario_id) || '—' };
  const filtroFunc = { key: 'funcionario_id', label: 'Colaborador', opcoes: opFunc, teste: (r, v) => String(r.funcionario_id) === v };

  if (aba === 'equipe') return equipe(area);
  if (aba === 'ocorrencias') return paginaLista(area, {
    tabela: 'ocorrencias', titulo: 'ocorrência', novoLabel: 'Registrar ocorrência', ordem: ['data', false],
    busca: ['descricao', 'tipo'], filtros: [filtroFunc, { key: 'tipo', label: 'Tipo', opcoes: OCORRENCIAS }],
    resumo: (v) => { const mes = hojeISO().slice(0, 7); const m = v.filter((o) => o.data.startsWith(mes));
      return h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Faltas no mês', value: num(m.filter((o) => o.tipo === 'Falta').length), tone: 'expense' }),
        kpi({ label: 'Atrasos no mês', value: num(m.filter((o) => o.tipo === 'Atraso').length), tone: 'warning' }),
        kpi({ label: 'Atestados no mês', value: num(m.filter((o) => o.tipo === 'Atestado').length), tone: 'info' }),
        kpi({ label: 'Elogios no mês', value: num(m.filter((o) => o.tipo === 'Elogio').length), tone: 'revenue' })); },
    colunas: [{ label: 'Data', key: 'data', tipo: 'date' }, colFunc, { label: 'Tipo', render: (o) => h('span', { class: `badge ${COR_OC[o.tipo] || ''}` }, o.tipo) },
      { label: 'Dias', key: 'dias', tipo: 'number' }, { label: 'Descrição', key: 'descricao' }, { label: 'Registrado por', key: 'registrado_por' }],
    arquivo: { bucket: 'pessoas', campoPath: 'arquivo_path', campoNome: 'arquivo_nome', pasta: 'ocorrencias', label: 'Anexo (atestado, advertência assinada…)' },
    campos: [campoFunc, { key: 'data', label: 'Data', tipo: 'date', obrigatorio: true, largura: 'meia' }, { key: 'tipo', label: 'Tipo', tipo: 'select', opcoes: OCORRENCIAS, obrigatorio: true, largura: 'meia' },
      { key: 'dias', label: 'Dias (faltas/atestado)', tipo: 'number', largura: 'meia' }, { key: 'registrado_por', label: 'Registrado por', largura: 'meia' },
      { key: 'descricao', label: 'Descrição', tipo: 'textarea' }],
    transformar: (o) => ({ ...o, funcionario_id: o.funcionario_id }),
  });
  if (aba === 'ferias') return paginaLista(area, {
    tabela: 'ferias', titulo: 'período de férias', novoLabel: 'Programar férias', ordem: ['inicio', false],
    busca: ['observacao'], filtros: [filtroFunc, { key: 'status', label: 'Status', opcoes: ['Programada', 'Em andamento', 'Concluída', 'Cancelada'] }],
    colunas: [colFunc, { label: 'Início', key: 'inicio', tipo: 'date' }, { label: 'Fim', key: 'fim', tipo: 'date' },
      { label: 'Dias', render: (f) => num((new Date(f.fim) - new Date(f.inicio)) / 864e5 + 1) }, { label: 'Período aquisitivo', key: 'periodo_aquisitivo' },
      { label: 'Status', render: (f) => h('span', { class: `badge ${f.status === 'Programada' ? 'info' : f.status === 'Em andamento' ? 'warn' : f.status === 'Concluída' ? 'ok' : ''}` }, f.status) }],
    campos: [campoFunc, { key: 'inicio', label: 'Início', tipo: 'date', obrigatorio: true, largura: 'meia' }, { key: 'fim', label: 'Fim', tipo: 'date', obrigatorio: true, largura: 'meia' },
      { key: 'periodo_aquisitivo', label: 'Período aquisitivo', placeholder: 'Ex.: 2025/2026', largura: 'meia' }, { key: 'status', label: 'Status', tipo: 'select', opcoes: ['Programada', 'Em andamento', 'Concluída', 'Cancelada'], largura: 'meia' },
      { key: 'observacao', label: 'Observação', tipo: 'textarea' }],
  });
  if (aba === 'documentos') return paginaLista(area, {
    tabela: 'documentos_pessoas', titulo: 'documento', novoLabel: 'Anexar documento', ordem: ['criado_em', false],
    busca: ['titulo', 'tipo', 'arquivo_nome'], filtros: [filtroFunc, { key: 'tipo', label: 'Tipo', opcoes: DOCS }],
    colunas: [colFunc, { label: 'Tipo', key: 'tipo' }, { label: 'Título', key: 'titulo' },
      { label: 'Validade', render: (d) => (d.validade ? h('span', { class: `badge ${d.validade < hojeISO() ? 'danger' : ''}` }, dataBR(d.validade)) : '—') },
      { label: 'Enviado em', render: (d) => dataBR(d.criado_em) }],
    arquivo: { bucket: 'pessoas', campoPath: 'arquivo_path', campoNome: 'arquivo_nome', pasta: 'documentos', label: 'Arquivo *' },
    campos: [campoFunc, { key: 'tipo', label: 'Tipo', tipo: 'select', opcoes: DOCS, obrigatorio: true, largura: 'meia' }, { key: 'validade', label: 'Validade', tipo: 'date', largura: 'meia' },
      { key: 'titulo', label: 'Título / descrição' }],
  });
}

async function equipe(area) {
  await paginaLista(area, {
    tabela: 'funcionarios', titulo: 'colaborador', novoLabel: 'Novo colaborador', ordem: ['nome', true],
    busca: ['nome', 'cargo', 'telefone'],
    filtros: [{ key: 'loja', label: 'Loja', opcoes: LOJAS }, { key: 'cargo', label: 'Cargo', opcoes: CARGOS, teste: (r, v) => (r.cargo || '').toLowerCase() === v.toLowerCase() },
      { key: 'ativo', label: 'Situação', opcoes: [{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Desligados' }] }],
    resumo: (v) => { const at = v.filter((f) => f.ativo); const custo = (f) => (Number(f.custo_mensal) || Number(f.salario) || 0) + (Number(f.vale_transporte) || 0) + (Number(f.outros_beneficios) || 0);
      return h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Colaboradores ativos', value: num(at.length), tone: 'sage', hint: `Villa ${at.filter((f) => f.loja === 'VILLA').length} · Souza Cruz ${at.filter((f) => f.loja === 'SOUZA_CRUZ').length}` }),
        kpi({ label: 'Custo mensal da equipe', value: brl(at.reduce((s, f) => s + custo(f), 0)), tone: 'expense', hint: 'salário/custo + benefícios cadastrados' }),
        kpi({ label: 'Em experiência', value: num(at.filter((f) => f.tipo === 'Experiência').length), tone: 'warning' }),
        kpi({ label: 'Aniversariantes do mês', value: num(at.filter((f) => (f.data_nascimento || '').slice(5, 7) === hojeISO().slice(5, 7)).length), tone: 'coral' })); },
    colunas: [
      { label: 'Nome', render: (f) => h('div', {}, h('button', { class: 'link-btn', onClick: () => ficha(f) }, h('b', {}, f.nome)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [f.cargo, f.tipo].filter(Boolean).join(' · '))) },
      { label: 'Loja', render: (f) => lojaNome(f.loja) }, { label: 'Turno', key: 'turno' },
      { label: 'Admissão', key: 'data_admissao', tipo: 'date' }, { label: 'Salário', key: 'salario', tipo: 'money', right: true },
      { label: 'Situação', render: (f) => h('span', { class: `badge ${f.ativo ? 'ok' : ''}` }, f.ativo ? 'Ativo' : 'Desligado') },
    ],
    campos: [
      { key: 'nome', label: 'Nome completo', obrigatorio: true },
      { key: 'loja', label: 'Loja', tipo: 'select', opcoes: LOJAS, obrigatorio: true, largura: 'meia' }, { key: 'cargo', label: 'Cargo', tipo: 'select', opcoes: CARGOS, largura: 'meia' },
      { key: 'tipo', label: 'Vínculo', tipo: 'select', opcoes: VINCULOS, largura: 'meia' }, { key: 'turno', label: 'Turno', tipo: 'select', opcoes: ['Manhã', 'Tarde', 'Integral', 'Noite', 'Escala'], largura: 'meia' },
      { key: 'carga_horaria', label: 'Carga horária', placeholder: 'Ex.: 44h semanais, 6x1', largura: 'meia' }, { key: 'data_admissao', label: 'Admissão', tipo: 'date', largura: 'meia' },
      { key: 'telefone', label: 'Telefone / WhatsApp', tipo: 'tel', largura: 'meia' }, { key: 'email', label: 'E-mail', tipo: 'email', largura: 'meia' },
      { key: 'data_nascimento', label: 'Aniversário', tipo: 'date', largura: 'meia' }, { key: 'salario', label: 'Salário (R$)', tipo: 'money', largura: 'meia' },
      { key: 'custo_mensal', label: 'Custo mensal total (R$)', tipo: 'money', largura: 'meia', dica: 'Salário + encargos. Se vazio, usa o salário.' },
      { key: 'vale_transporte', label: 'Vale-transporte (R$/mês)', tipo: 'money', largura: 'meia' }, { key: 'outros_beneficios', label: 'Outros benefícios (R$/mês)', tipo: 'money', largura: 'meia' },
      { key: 'ativo', label: 'Situação', tipo: 'bool', texto: 'Colaborador ativo', largura: 'meia' }, { key: 'data_demissao', label: 'Data de desligamento', tipo: 'date', largura: 'meia' },
      { key: 'observacao', label: 'Observações', tipo: 'textarea' },
    ],
    transformar: (f) => ({ ...f, ativo: f.ativo }),
  });
}

// Ficha do colaborador: tudo de uma pessoa em um lugar
async function ficha(f) {
  const corpo = h('div', {}, loading('Carregando ficha...'));
  const fecharFicha = drawer(f.nome, corpo);
  try {
    const [oc, fe, docs] = await Promise.all([
      sb.from('ocorrencias').select('*').eq('funcionario_id', f.id).order('data', { ascending: false }).then(ok),
      sb.from('ferias').select('*').eq('funcionario_id', f.id).order('inicio', { ascending: false }).then(ok),
      sb.from('documentos_pessoas').select('*').eq('funcionario_id', f.id).order('criado_em', { ascending: false }).then(ok),
    ]);
    const tempo = f.data_admissao ? (() => { const m = Math.floor((new Date() - new Date(f.data_admissao)) / (864e5 * 30.44)); return m >= 12 ? `${Math.floor(m / 12)} ano(s) e ${m % 12} mês(es)` : `${m} mês(es)`; })() : '—';
    const linha = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v || '—'));
    corpo.replaceChildren(
      h('div', { class: 'kv-list' }, linha('Loja', lojaNome(f.loja)), linha('Cargo', f.cargo), linha('Vínculo', f.tipo), linha('Turno', f.turno), linha('Admissão', dataBR(f.data_admissao)),
        linha('Tempo de casa', tempo), linha('Telefone', f.telefone), linha('Salário', f.salario ? brl(f.salario) : '')),
      h('div', { class: 'form-section-title', style: { marginTop: '18px' } }, `Ocorrências (${oc.length})`),
      table([{ label: 'Data', render: (o) => dataBR(o.data) }, { label: 'Tipo', render: (o) => h('span', { class: `badge ${COR_OC[o.tipo] || ''}` }, o.tipo) }, { label: 'Descrição', key: 'descricao' }], oc, { maxHeight: false, emptyText: 'Nenhuma ocorrência.' }),
      h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onClick: async () => { if (await formulario({ titulo: 'Nova ocorrência', tabela: 'ocorrencias', valores: {}, campos: [
        { key: 'data', label: 'Data', tipo: 'date', obrigatorio: true }, { key: 'tipo', label: 'Tipo', tipo: 'select', opcoes: OCORRENCIAS, obrigatorio: true }, { key: 'descricao', label: 'Descrição', tipo: 'textarea' }],
        aoSalvar: async (lin) => ok(await sb.from('ocorrencias').insert({ ...lin, funcionario_id: f.id })) })) { fecharFicha(); ficha(f); } } }, icon('plus'), 'Ocorrência'),
      h('div', { class: 'form-section-title', style: { marginTop: '18px' } }, 'Férias'),
      table([{ label: 'Início', render: (x) => dataBR(x.inicio) }, { label: 'Fim', render: (x) => dataBR(x.fim) }, { label: 'Status', key: 'status' }], fe, { maxHeight: false, emptyText: 'Nenhum período registrado.' }),
      h('div', { class: 'form-section-title', style: { marginTop: '18px' } }, 'Documentos'),
      table([{ label: 'Tipo', key: 'tipo' }, { label: 'Título', key: 'titulo' }, { label: '', render: (d) => h('button', { class: 'link-btn', onClick: () => abrirArquivo('pessoas', d.arquivo_path) }, 'Abrir') }], docs, { maxHeight: false, emptyText: 'Nenhum documento anexado.' }));
  } catch (e) { corpo.replaceChildren(alertBox(e.message)); }
}
