// Peças comuns às telas da gestão.
import { h, icon, toast } from '../ui.js';
import { api, clearMemo } from '../api.js';

export function pageHeader(main, { title, sub, onRefresh, actions = [] }) {
  const btn = onRefresh ? h('button', { class: 'btn ghost small', onClick: async () => {
    btn.disabled = true;
    try { await api.post('/api/refresh'); clearMemo(); await onRefresh(); toast('Dados atualizados.', 'ok'); } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  } }, icon('refresh'), 'Atualizar') : null;
  main.append(h('div', { class: 'topbar' },
    h('div', {}, h('h1', { class: 'page-title' }, title), sub ? h('div', { class: 'page-sub' }, sub) : null),
    h('div', { class: 'topbar-actions' }, ...actions, btn)));
}

export const atualizadoEm = (ts) => (ts ? `Atualizado às ${new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Indicadores de saúde financeira (% sobre a receita bruta) — mesmas metas do painel Lovable.
const METAS = {
  cmv: { label: 'CMV (Fornecedores)', hint: 'Fornecedores ÷ Receita bruta', green: 30, yellow: 35 },
  proLabore: { label: 'Pró-labore', hint: 'Pró-labore ÷ Receita bruta', green: 8, yellow: 12 },
  emprestimos: { label: 'Empréstimos', hint: 'Parcelas pagas no período ÷ Receita bruta', green: 5, yellow: 10 },
  desperdicio: { label: 'Desperdício', hint: 'Valor desperdiçado ÷ Receita bruta', green: 2, yellow: 5 },
  folha: { label: 'Folha de pagamento', hint: 'Custo de funcionários ÷ Receita bruta', green: 25, yellow: 30 },
  lucro: { label: 'Lucro líquido', hint: 'Lucro ÷ Receita bruta', green: 10, yellow: 20, maior: true },
};

export function avaliar(key, pctVal, valor) {
  const m = METAS[key];
  let status;
  if (m.maior) status = pctVal >= m.yellow ? 'excelente' : pctVal >= m.green ? 'atencao' : 'critico';
  else status = pctVal <= m.green ? 'excelente' : pctVal <= m.yellow ? 'atencao' : 'critico';
  return { key, ...m, pct: pctVal, valor, status };
}

export function saudeGeral(metricas) {
  const fora = metricas.filter((m) => m.status === 'critico').length;
  return fora >= 2 ? { label: 'Crítico', cor: 'var(--expense)', badge: 'danger' } : fora === 1 ? { label: 'Atenção', cor: 'var(--warning)', badge: 'warn' } : { label: 'Excelente', cor: 'var(--revenue)', badge: 'ok' };
}

export const STATUS_UI = { excelente: { label: 'Excelente', badge: 'ok', cor: 'var(--revenue)' }, atencao: { label: 'Atenção', badge: 'warn', cor: 'var(--warning)' }, critico: { label: 'Crítico', badge: 'danger', cor: 'var(--expense)' } };

export const ehCmv = (m) => /fornecedor|insumo|materia/.test(norm(m.categoria));
export const ehProLabore = (m) => /pro.?labore|socio/.test(norm(m.categoria));
export const ehEmprestimo = (m) => /emprestimo/.test(norm(m.categoria));

// Agrupa por dia ou por mês conforme o tamanho do período.
export function serieTemporal(datas) {
  const ds = datas.filter(Boolean).sort();
  if (!ds.length) return { chave: (d) => d, label: (k) => k };
  const dias = (new Date(ds[ds.length - 1]) - new Date(ds[0])) / 864e5;
  if (dias > 62) return { chave: (d) => d.slice(0, 7), label: (k) => { const [y, m] = k.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1]}/${y.slice(2)}`; } };
  return { chave: (d) => d, label: (k) => k.slice(8, 10) + '/' + k.slice(5, 7) };
}
