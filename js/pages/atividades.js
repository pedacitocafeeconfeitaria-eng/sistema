// Atividades: tudo o que a equipe lança, em ordem, com filtros e aviso no aparelho.
import { sb } from '../api.js';
import { h, card, field, select, toast, loading, alertBox, icon, dataBR, diaSemana } from '../ui.js';
import { pageHeader } from './_painel.js';
import { ok } from '../crud.js';
import { MODULOS, marcarLidas, ultimaLeitura } from '../notificacoes.js';

const NIVEL = { alerta: { label: 'Alerta', cls: 'danger' }, atencao: { label: 'Atenção', cls: 'warn' }, info: { label: '', cls: '' } };

export async function render(main) {
  const st = { modulo: '', loja: '', nivel: '', dias: 7 };
  const lidoAntes = ultimaLeitura();
  const permissao = 'Notification' in window ? Notification.permission : 'indisponivel';
  const btnAviso = permissao === 'default' ? h('button', { class: 'btn ghost', onClick: async () => {
    const r = await Notification.requestPermission();
    toast(r === 'granted' ? 'Pronto! Este aparelho vai avisar das novidades.' : 'Os avisos do aparelho ficaram desligados.', r === 'granted' ? 'ok' : '');
    btnAviso.remove();
  } }, icon('bell'), 'Avisar neste aparelho') : null;
  pageHeader(main, { title: 'Atividades', sub: 'O que cada pessoa lançou no sistema, em tempo real', actions: [btnAviso] });
  const area = h('div', {}, loading());
  main.append(area);

  async function carregar() {
    area.replaceChildren(loading());
    try {
      const desde = new Date(Date.now() - st.dias * 864e5).toISOString();
      let q = sb.from('atividades').select('*').gte('criado_em', desde).order('criado_em', { ascending: false }).limit(500);
      if (st.modulo) q = q.eq('modulo', st.modulo);
      if (st.loja) q = q.eq('loja', st.loja);
      if (st.nivel) q = q.eq('nivel', st.nivel);
      const lista = ok(await q);
      desenhar(lista);
      marcarLidas();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar(lista) {
    const sel = (opts, v, f) => { const s = select(opts, { onChange: (e) => { f(e.target.value); carregar(); } }); s.value = v; return s; };
    const porDia = new Map();
    lista.forEach((a) => { const d = a.criado_em.slice(0, 10); if (!porDia.has(d)) porDia.set(d, []); porDia.get(d).push(a); });
    area.replaceChildren(
      h('div', { class: 'filters' },
        field('Área', sel([{ value: '', label: 'Todas' }, ...Object.entries(MODULOS).map(([value, label]) => ({ value, label }))], st.modulo, (v) => { st.modulo = v; })),
        field('Loja', sel([{ value: '', label: 'As duas' }, { value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }], st.loja, (v) => { st.loja = v; })),
        field('Importância', sel([{ value: '', label: 'Todas' }, { value: 'alerta', label: 'Só alertas' }, { value: 'atencao', label: 'Atenção' }], st.nivel, (v) => { st.nivel = v; })),
        field('Período', sel([{ value: '1', label: 'Últimas 24 horas' }, { value: '7', label: 'Últimos 7 dias' }, { value: '30', label: 'Últimos 30 dias' }], String(st.dias), (v) => { st.dias = Number(v); }))),
      lista.length ? h('div', { class: 'form-stack' }, [...porDia].map(([dia, itens]) => card({ title: `${diaSemana(dia)}, ${dataBR(dia)}`, desc: `${itens.length} registro(s)` },
        h('div', { class: 'atv-lista' }, itens.map((a) => {
          const novo = lidoAntes && a.criado_em > lidoAntes;
          const n = NIVEL[a.nivel] || NIVEL.info;
          return h('a', { class: `atv${novo ? ' novo' : ''} ${n.cls}`, href: a.link || '/gestao/atividades', 'data-link': true },
            h('div', { class: 'atv-hora' }, new Date(a.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { class: 'atv-mod' }, `${MODULOS[a.modulo] || a.modulo}${a.loja ? ` · ${a.loja === 'VILLA' ? 'Villa' : 'Souza Cruz'}` : ''}${a.autor ? ` · ${a.autor}` : ''}`),
              h('b', {}, a.titulo), a.detalhe ? h('div', { class: 'atv-det' }, a.detalhe) : null),
            n.label ? h('span', { class: `badge ${n.cls}` }, n.label) : null, novo ? h('span', { class: 'badge info' }, 'Novo') : null);
        })))))
        : h('div', { class: 'empty' }, 'Nenhuma atividade no período. Assim que a equipe lançar produção, desperdício, notas ou encomendas, aparece aqui.'));
  }

  carregar();
}
