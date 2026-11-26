// Contratos: todos os contratos das empresas, com o arquivo anexado e alerta de vencimento.
import { h, kpi, brl, num, hojeISO } from '../ui.js';
import { pageHeader } from './_painel.js';
import { paginaLista } from '../crud.js';

const TIPOS = ['Fornecedor', 'Cliente', 'Funcionário', 'Aluguel', 'Empréstimo / Financiamento', 'Serviço', 'Sociedade', 'Seguro', 'Outro'];
const EMPRESAS = ['Pedacito Villa Schlosser', 'Pedacito Souza Cruz', 'Grupo (ambas)'];

function situacao(c) {
  if (c.status === 'Rascunho' || c.status === 'Encerrado') return c.status;
  if (!c.data_fim) return 'Vigente';
  const hoje = hojeISO();
  if (c.data_fim < hoje) return c.renovacao_auto ? 'Renovado auto.' : 'Vencido';
  const dias = (new Date(c.data_fim) - new Date(hoje)) / 864e5;
  return dias <= (c.aviso_dias || 30) ? 'A vencer' : 'Vigente';
}
const COR = { Vigente: 'ok', 'A vencer': 'warn', Vencido: 'danger', 'Renovado auto.': 'info', Encerrado: '', Rascunho: '' };

export async function render(main) {
  pageHeader(main, { title: 'Contratos', sub: 'Todos os contratos das empresas, com o documento anexado' });
  const area = h('div');
  main.append(area);
  await paginaLista(area, {
    tabela: 'contratos', titulo: 'contrato', novoLabel: 'Novo contrato', ordem: ['data_fim', true],
    transformar: (c) => ({ ...c, situacao: situacao(c) }),
    busca: ['titulo', 'parte', 'numero', 'tipo', 'observacao'],
    filtros: [{ key: 'tipo', label: 'Tipo', opcoes: TIPOS }, { key: 'situacao', label: 'Situação', opcoes: ['Vigente', 'A vencer', 'Vencido', 'Renovado auto.', 'Encerrado', 'Rascunho'] }, { key: 'empresa', label: 'Empresa', opcoes: EMPRESAS }],
    resumo: (v) => h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
      kpi({ label: 'Contratos', value: num(v.length), tone: 'sage' }),
      kpi({ label: 'A vencer', value: num(v.filter((c) => c.situacao === 'A vencer').length), tone: 'warning', hint: 'dentro do prazo de aviso' }),
      kpi({ label: 'Vencidos', value: num(v.filter((c) => c.situacao === 'Vencido').length), tone: 'expense' }),
      kpi({ label: 'Valor mensal vigente', value: brl(v.filter((c) => /Vigente|A vencer|Renovado/.test(c.situacao) && c.periodicidade === 'Mensal').reduce((s, c) => s + (Number(c.valor) || 0), 0)), tone: 'info' })),
    colunas: [
      { label: 'Contrato', render: (c) => h('div', {}, h('b', {}, c.titulo), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, [c.tipo, c.parte].filter(Boolean).join(' · '))) },
      { label: 'Empresa', key: 'empresa' },
      { label: 'Início', key: 'data_inicio', tipo: 'date' },
      { label: 'Fim', key: 'data_fim', tipo: 'date' },
      { label: 'Valor', render: (c) => (c.valor ? `${brl(c.valor)}${c.periodicidade && c.periodicidade !== 'Único' ? ` /${c.periodicidade.toLowerCase().replace('mensal', 'mês').replace('anual', 'ano')}` : ''}` : '—'), right: true },
      { label: 'Situação', render: (c) => h('span', { class: `badge ${COR[c.situacao] || ''}` }, c.situacao) },
    ],
    arquivo: { bucket: 'contratos', campoPath: 'arquivo_path', campoNome: 'arquivo_nome', pasta: 'contratos', label: 'Contrato assinado (PDF ou foto)' },
    campos: [
      { key: 'titulo', label: 'Título', obrigatorio: true, placeholder: 'Ex.: Aluguel loja Villa, Contrato Hortifruti Águas Claras' },
      { key: 'tipo', label: 'Tipo', tipo: 'select', opcoes: TIPOS, obrigatorio: true, largura: 'meia' },
      { key: 'empresa', label: 'Empresa da Pedacito', tipo: 'select', opcoes: EMPRESAS, largura: 'meia' },
      { key: 'parte', label: 'Outra parte (empresa/pessoa)', largura: 'meia' },
      { key: 'numero', label: 'Número / referência', largura: 'meia' },
      { key: 'data_assinatura', label: 'Assinatura', tipo: 'date', largura: 'meia' },
      { key: 'data_inicio', label: 'Início da vigência', tipo: 'date', largura: 'meia' },
      { key: 'data_fim', label: 'Fim da vigência', tipo: 'date', largura: 'meia', dica: 'Deixe em branco se for por prazo indeterminado.' },
      { key: 'aviso_dias', label: 'Avisar quantos dias antes', tipo: 'number', largura: 'meia' },
      { key: 'valor', label: 'Valor (R$)', tipo: 'money', largura: 'meia' },
      { key: 'periodicidade', label: 'Periodicidade', tipo: 'select', opcoes: ['Único', 'Mensal', 'Trimestral', 'Semestral', 'Anual'], largura: 'meia' },
      { key: 'renovacao_auto', label: 'Renovação automática', tipo: 'bool', texto: 'Renova sozinho ao vencer', largura: 'meia' },
      { key: 'status', label: 'Status', tipo: 'select', opcoes: ['Vigente', 'Rascunho', 'Encerrado'], largura: 'meia' },
      { key: 'observacao', label: 'Observações (cláusulas importantes, multas, reajuste…)', tipo: 'textarea' },
    ],
  });
}
