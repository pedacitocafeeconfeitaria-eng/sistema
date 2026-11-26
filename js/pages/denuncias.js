// Denúncias recebidas (somente administrador). Ficam numa planilha privada, separada da de gestão.
import { api } from '../api.js';
import { h, card, kpi, table, field, select, input, textarea, toast, loading, alertBox, num } from '../ui.js';
import { pageHeader } from './_painel.js';

const STATUS = ['Aberto', 'Em análise', 'Concluído', 'Arquivado'];
const badge = (s) => h('span', { class: `badge ${s === 'Aberto' ? 'danger' : s === 'Em análise' ? 'warn' : s === 'Concluído' ? 'ok' : ''}` }, s);

export async function render(main) {
  pageHeader(main, { title: 'Denúncias', sub: 'Canal confidencial · visível somente para administradores', onRefresh: () => carregar() });
  const area = h('div', {}, loading());
  main.append(area);
  let lista = [];
  let aberta = null;

  async function carregar() {
    area.replaceChildren(loading());
    try {
      lista = (await api.get('/api/data/denuncias')).denuncias;
      desenhar();
    } catch (e) {
      area.replaceChildren(alertBox(e.status === 503 ? 'As denúncias ficam numa planilha privada que só o Apps Script do sistema acessa. Configure-o em Configurações para vê-las aqui. (Enquanto isso, novas denúncias continuam indo para a planilha antiga do Lovable.)' : e.message, e.status === 503 ? 'warn' : 'error'));
    }
  }

  function desenhar() {
    area.replaceChildren(
      h('div', { class: 'grid g4' },
        kpi({ label: 'Total', value: num(lista.length), tone: 'sage' }),
        kpi({ label: 'Abertas', value: num(lista.filter((d) => d.status === 'Aberto').length), tone: 'expense' }),
        kpi({ label: 'Em análise', value: num(lista.filter((d) => d.status === 'Em análise').length), tone: 'warning' }),
        kpi({ label: 'Gravidade alta', value: num(lista.filter((d) => d.gravidade === 'Alta').length), tone: 'coral' })),
      h('div', { class: 'grid g2', style: { marginTop: '16px' } },
        card({ title: 'Recebidas', desc: 'Mais recentes primeiro' }, table([
          { label: 'Protocolo', render: (d) => h('button', { class: 'link-btn', onClick: () => { aberta = d; desenhar(); } }, d.id) },
          { label: 'Recebida', render: (d) => (d.data ? new Date(d.data).toLocaleDateString('pt-BR') : '—') },
          { label: 'Categoria', key: 'categoria' },
          { label: 'Gravidade', render: (d) => h('span', { class: `badge ${d.gravidade === 'Alta' ? 'danger' : 'warn'}` }, d.gravidade) },
          { label: 'Status', render: (d) => badge(d.status) },
        ], lista, { emptyText: 'Nenhuma denúncia registrada.' })),
        aberta ? detalhe(aberta) : card({}, h('div', { class: 'empty' }, 'Selecione um protocolo para ver os detalhes.'))));
  }

  function detalhe(d) {
    const status = select(STATUS, {});
    status.value = d.status;
    const resp = input({ value: d.responsavel, placeholder: 'Quem está tratando' });
    const obs = textarea({ rows: 4, value: d.observacoes, placeholder: 'Anotações internas do tratamento' });
    const btn = h('button', { class: 'btn', onClick: async () => {
      btn.disabled = true;
      try {
        await api.put(`/api/data/denuncias/${d.rowIndex}`, { status: status.value, responsavel: resp.value, observacoes: obs.value });
        toast('Denúncia atualizada.', 'ok');
        await carregar();
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    } }, 'Salvar tratamento');
    const linha = (k, v) => h('div', { style: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px', padding: '6px 0', borderBottom: '1px solid #efeadf', fontSize: '14px' } }, h('span', { class: 'muted' }, k), h('span', {}, v || '—'));
    return card({ title: `Protocolo ${d.id}`, desc: `Gravidade ${d.gravidade}` },
      linha('Tipo', d.tipo), linha('Categoria', d.categoria), linha('Data do ocorrido', d.dataOcorrido ? d.dataOcorrido.split('-').reverse().join('/') : ''),
      linha('Envolvidos', d.envolvidos), linha('Identificação', d.anonimo === 'Sim' ? 'Anônima' : `${d.nome} · ${d.contato}`),
      h('div', { style: { margin: '14px 0', whiteSpace: 'pre-wrap', background: 'var(--sage-50)', padding: '14px', borderRadius: '12px', fontSize: '14px' } }, d.descricao),
      h('div', { class: 'form-stack' }, h('div', { class: 'form-row' }, field('Status', status), field('Responsável', resp)), field('Observações', obs), btn));
  }

  await carregar();
}
