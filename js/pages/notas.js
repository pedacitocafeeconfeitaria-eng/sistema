// Notas fiscais: importar XML, conferir itens, vincular aos insumos (o sistema aprende) e acompanhar.
import { sb, clearMemo } from '../api.js';
import { h, kpi, field, input, select, table, toast, loading, alertBox, icon, brl, num, dataBR, combo } from '../ui.js';
import { pageHeader } from './_painel.js';
import { drawer, ok } from '../crud.js';
import { lerNFe } from '../nfe.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : '—');
const ORIGEM = { xml: 'XML', email: 'E-mail', foto: 'Foto', manual: 'Manual', pedido: 'Pedido' };

export async function render(main) {
  pageHeader(main, { title: 'Notas fiscais', sub: 'Entrada de mercadorias: estoque e contas a pagar de uma vez' });
  const area = h('div', {}, loading('Carregando notas...'));
  main.append(area);
  const st = { status: '', loja: '', q: '' };
  let notas = [], forn = new Map(), insumos = [];

  async function carregar() {
    area.replaceChildren(loading('Carregando notas...'));
    try {
      const [n, f, i] = await Promise.all([
        sb.from('notas_fiscais').select('*, nota_itens(id, insumo_id, estoque_lancado)').order('data_emissao', { ascending: false }).limit(1000).then(ok),
        sb.from('fornecedores').select('id,nome').then(ok),
        sb.from('insumos').select('id,nome,unidade,custo_unitario,categoria,uso').eq('ativo', true).neq('uso', 'receita').order('nome').then(ok),
      ]);
      notas = n; forn = new Map(f.map((x) => [x.id, x.nome])); insumos = i;
      desenhar();
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function desenhar() {
    const pend = (n) => n.nota_itens.filter((i) => !i.insumo_id && !i.estoque_lancado).length;
    const vis = notas.filter((n) => (!st.status || (st.status === 'pend' ? pend(n) > 0 : pend(n) === 0)) && (!st.loja || n.loja === st.loja)
      && (!st.q || `${n.numero} ${forn.get(n.fornecedor_id) || ''}`.toLowerCase().includes(st.q)));
    const mes = new Date().toISOString().slice(0, 7);
    const doMes = notas.filter((n) => (n.data_emissao || n.data_entrada || '').startsWith(mes));
    const arquivo = h('input', { type: 'file', accept: '.xml,text/xml', multiple: true, class: 'hidden', onChange: (e) => importarXML([...e.target.files]) });
    const sel = (opts, key) => { const s = select(opts, { onChange: (e) => { st[key] = e.target.value; desenhar(); } }); s.value = st[key]; return s; };
    area.replaceChildren(
      h('div', { class: 'grid g4', style: { marginBottom: '14px' } },
        kpi({ label: 'Notas no mês', value: num(doMes.length), tone: 'sage' }),
        kpi({ label: 'Comprado no mês', value: brl(doMes.reduce((s, n) => s + Number(n.valor_total), 0)), tone: 'expense' }),
        kpi({ label: 'Com itens para vincular', value: num(notas.filter((n) => pend(n) > 0).length), tone: 'warning', hint: 'esses itens ainda não entraram no estoque' }),
        kpi({ label: 'Não lançadas no Raffinato', value: num(notas.filter((n) => !n.lancada_raffinato).length), tone: 'info' })),
      h('div', { class: 'filters', style: { marginBottom: '14px' } },
        field('Busca', input({ value: st.q, placeholder: 'Número ou fornecedor', onInput: (e) => { st.q = e.target.value.toLowerCase(); desenhar(); } })),
        field('Loja', sel([{ value: '', label: 'Todas' }, ...LOJAS], 'loja')),
        field('Situação', sel([{ value: '', label: 'Todas' }, { value: 'pend', label: 'Com itens para vincular' }, { value: 'ok', label: 'Completas' }], 'status')),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } }, arquivo,
          h('button', { class: 'btn', onClick: () => arquivo.click() }, icon('plus'), 'Importar XML'))),
      h('div', { class: 'card', style: { padding: '6px 10px' } }, table([
        { label: 'Emissão', render: (n) => dataBR(n.data_emissao || n.data_entrada) },
        { label: 'Nota', render: (n) => h('button', { class: 'link-btn', onClick: () => abrir(n) }, h('b', {}, `${n.tipo_doc === 'NF-e' ? 'NF' : n.tipo_doc} ${n.numero || '—'}`)) },
        { label: 'Fornecedor', render: (n) => forn.get(n.fornecedor_id) || '—' },
        { label: 'Loja', render: (n) => lojaNome(n.loja) },
        { label: 'Itens', render: (n) => num(n.nota_itens.length), right: true },
        { label: 'Valor', render: (n) => brl(n.valor_total), right: true },
        { label: 'Situação', render: (n) => { const p = pend(n); return h('span', { class: `badge ${p ? 'warn' : 'ok'}` }, p ? `${p} p/ vincular` : 'Completa'); } },
        { label: 'Raffinato', render: (n) => h('span', { class: `badge ${n.lancada_raffinato ? 'ok' : ''}` }, n.lancada_raffinato ? 'Lançada' : 'Pendente') },
        { label: 'Origem', render: (n) => ORIGEM[n.origem] || n.origem || '—' },
      ], vis, { maxHeight: false, emptyText: 'Nenhuma nota ainda. Importe o XML que o fornecedor manda por e-mail, ou mande a foto da nota para o Claude.' })));
  }

  async function importarXML(arquivos) {
    let okN = 0, dup = 0; const erros = [];
    for (const f of arquivos) {
      try {
        const dados = lerNFe(await f.text());
        let r = ok(await sb.rpc('registrar_nota', { p: dados }));
        if (r.duplicada) { dup++; continue; }
        okN++;
      } catch (e) {
        if (/Informe a loja/.test(e.message)) {
          const loja = await perguntarLoja(f.name);
          if (!loja) { erros.push(`${f.name}: sem loja`); continue; }
          try { const dados = lerNFe(await f.text()); dados.loja = loja; ok(await sb.rpc('registrar_nota', { p: dados })); okN++; } catch (e2) { erros.push(`${f.name}: ${e2.message}`); }
        } else erros.push(`${f.name}: ${e.message}`);
      }
    }
    clearMemo();
    toast([okN && `${okN} nota(s) importada(s)`, dup && `${dup} já estavam lançadas`, erros.length && `${erros.length} com erro`].filter(Boolean).join(' · ') || 'Nada importado.', erros.length ? 'error' : 'ok');
    if (erros.length) console.warn(erros);
    carregar();
  }

  function perguntarLoja(nome) {
    return new Promise((resolve) => {
      let fechar;
      const corpo = h('div', { class: 'form-stack' },
        h('p', { style: { margin: 0 } }, `Para qual loja é a nota "${nome}"? O sistema vai lembrar pelo CNPJ nas próximas.`),
        ...LOJAS.map((l) => h('button', { class: 'btn block', onClick: () => { fechar(); resolve(l.value); } }, l.label)));
      fechar = drawer('Qual loja?', corpo, { onClose: () => resolve(null) });
    });
  }

  async function abrir(n) {
    const corpo = h('div', {}, loading('Abrindo nota...'));
    const fechar = drawer(`${n.tipo_doc === 'NF-e' ? 'NF' : n.tipo_doc} ${n.numero || ''} · ${forn.get(n.fornecedor_id) || ''}`, corpo);
    const desenharNota = async () => {
      const [itens, parcelas] = await Promise.all([
        sb.from('nota_itens').select('*').eq('nota_id', n.id).order('id').then(ok),
        sb.from('lancamentos').select('*').eq('nota_id', n.id).order('vencimento').then(ok),
      ]);
      const insMap = new Map(insumos.map((i) => [i.id, i]));
      const linhas = itens.map((it) => {
        const ins = insMap.get(it.insumo_id);
        if (it.insumo_id || it.estoque_lancado) {
          return h('div', { class: 'item-line' }, h('div', { style: { flex: 1 } }, h('b', {}, it.descricao),
            h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${num(it.quantidade)} ${it.unidade || ''} · ${brl(it.valor_total)}`)),
            h('div', { style: { textAlign: 'right', fontSize: '13px' } }, ins ? h('span', { class: 'badge ok' }, `→ ${ins.nome}${Number(it.fator) !== 1 ? ` (×${num(it.fator)})` : ''}`) : h('span', { class: 'badge' }, 'Fora do estoque')));
        }
        let escolhido = null;
        const fator = input({ inputMode: 'decimal', value: '1', style: { width: '80px' } });
        const dica = h('div', { class: 'muted', style: { fontSize: '12px' } });
        const atualizaDica = () => { const i = insMap.get(escolhido); const f = Number(fator.value.replace(',', '.')) || 1;
          dica.textContent = i ? `Entra ${num(it.quantidade * f)} ${i.unidade} no estoque · custo ${brl(it.valor_total / (it.quantidade * f))}/${i.unidade}` : ''; };
        fator.addEventListener('input', atualizaDica);
        const c = combo({ options: insumos.map((i) => ({ value: i.id, label: i.nome, sub: i.unidade })), placeholder: 'Qual insumo é este?', onSelect: (o) => { escolhido = o?.value || null; atualizaDica(); } });
        return h('div', { class: 'item-line', style: { flexDirection: 'column', alignItems: 'stretch', borderColor: 'var(--warning)' } },
          h('div', {}, h('b', {}, it.descricao), h('span', { class: 'muted', style: { marginLeft: '8px', fontSize: '12.5px' } }, `${num(it.quantidade)} ${it.unidade || ''} · ${brl(it.valor_total)}`)),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: '200px' } }, field('Insumo', c)),
            field(`1 ${it.unidade || 'un'} = quantos?`, fator),
            h('button', { class: 'btn small', onClick: async () => {
              if (!escolhido) return toast('Escolha o insumo.', 'error');
              try { const r = ok(await sb.rpc('vincular_item_nota', { p_item: it.id, p_insumo: escolhido, p_fator: Number(fator.value.replace(',', '.')) || 1, p_lembrar: true }));
                toast(`Vinculado e lançado no estoque.${r.outras_notas_vinculadas ? ` Também em ${r.outras_notas_vinculadas} outra(s) nota(s).` : ''} Nas próximas notas desse fornecedor isso é automático.`, 'ok');
                desenharNota(); carregar(); } catch (e) { toast(e.message, 'error'); }
            } }, 'Vincular'),
            h('button', { class: 'btn ghost small', title: 'Frete, serviço ou item que não é controlado no estoque', onClick: async () => {
              try { ok(await sb.rpc('ignorar_item_nota', { p_item: it.id })); desenharNota(); carregar(); } catch (e) { toast(e.message, 'error'); }
            } }, 'Não é estoque')),
          dica);
      });
      corpo.replaceChildren(h('div', { class: 'form-stack' },
        h('div', { class: 'kv-list' },
          ...[['Emissão', dataBR(n.data_emissao)], ['Loja', lojaNome(n.loja)], ['Valor total', brl(n.valor_total)], ['Origem', ORIGEM[n.origem] || n.origem], ['Chave', n.chave_acesso ? `…${n.chave_acesso.slice(-12)}` : '—'], ['Série', n.serie || '—']]
            .map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v)))),
        h('div', { class: 'form-section-title' }, `Itens (${itens.length})`),
        itens.some((i) => !i.insumo_id && !i.estoque_lancado) ? h('div', { class: 'alert warn' }, 'Diga qual insumo é cada item. Use o "1 unidade = quantos?" quando a nota vem em caixa ou fardo (ex.: fardo com 5 kg → 5).') : null,
        ...linhas,
        h('div', { class: 'form-section-title' }, 'Contas a pagar desta nota'),
        table([{ label: 'Parcela', key: 'parcela' }, { label: 'Vencimento', render: (l) => dataBR(l.vencimento) }, { label: 'Valor', render: (l) => brl(l.valor), right: true },
          { label: 'Status', render: (l) => h('span', { class: `badge ${l.status === 'PAGO' ? 'ok' : 'warn'}` }, l.status === 'PAGO' ? 'Pago' : 'Pendente') }], parcelas, { maxHeight: false, emptyText: 'Sem parcelas.' }),
        h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: n.lancada_raffinato, onChange: async (e) => {
          try { ok(await sb.from('notas_fiscais').update({ lancada_raffinato: e.target.checked }).eq('id', n.id)); n.lancada_raffinato = e.target.checked; toast('Atualizado.', 'ok'); carregar(); } catch (ex) { toast(ex.message, 'error'); }
        } }), 'Já lancei esta nota no Raffinato')));
    };
    try { await desenharNota(); } catch (e) { corpo.replaceChildren(alertBox(e.message)); }
  }

  carregar();
}
