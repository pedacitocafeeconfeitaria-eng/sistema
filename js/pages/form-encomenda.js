// Encomendas pelo balcão: bolo decorado ou evento (mini croissant, ciabatta, brownie...) e agenda da cozinha.
import { api } from '../api.js';
import { h, card, field, input, select, textarea, seg, toast, brl, parseNum, hojeISO, dataBR, diaSemana, loading, icon } from '../ui.js';
import { publicLayout, successCard, LOJAS, lembrar } from './_public.js';
import { comprovante, relatorioCozinha, STATUS, linkWhats, textoCliente } from './_encomenda.js';

export async function render(root) {
  const body = publicLayout(root, { title: 'Encomendas', subtitle: 'Bolos decorados e pedidos para eventos.' });
  const mem = lembrar.get();
  let aba = 'nova';
  const topo = h('div', { style: { marginBottom: '12px' } });
  const content = h('div', { class: 'form-stack' });
  body.append(topo, content);
  const trocar = () => { topo.replaceChildren(seg([{ value: 'nova', label: 'Nova encomenda' }, { value: 'agenda', label: 'Agenda' }], aba, (v) => { aba = v; trocar(); })); aba === 'nova' ? nova() : agenda(); };

  let catalogo = [];
  try { catalogo = await api.get('/api/public/catalogo-encomenda'); } catch (e) { toast(e.message, 'error'); }

  function nova() {
    const st = { tipo: 'BOLO', loja: mem.loja || '', atendente: mem.nome || '', entrega_tipo: 'RETIRADA', itens: [], detalhes: {} };
    const f = {
      cliente: input({ placeholder: 'Nome do cliente' }), fone: input({ inputMode: 'tel', placeholder: '(47) 9 9999-9999' }),
      data: input({ type: 'date', min: hojeISO() }), hora: input({ type: 'time' }), endereco: input({ placeholder: 'Rua, número, bairro' }),
      sinal: input({ inputMode: 'decimal', placeholder: '0,00' }), obs: textarea({ rows: 2, placeholder: 'Alergias, recados, forma de pagamento...' }),
      atendente: input({ value: st.atendente, placeholder: 'Seu nome' }), loja: select([{ value: '', label: 'Selecione' }, ...LOJAS]),
    };
    f.loja.value = st.loja;
    const bolo = { tamanho: input({ placeholder: 'Ex.: 2 kg, 20 fatias, aro 25' }), massa: input({ placeholder: 'Ex.: chocolate' }), recheio: input({ placeholder: 'Ex.: brigadeiro + morango' }),
      cobertura: input({ placeholder: 'Ex.: chantininho' }), tema: input({ placeholder: 'Tema / decoração / cores' }), escrita: input({ placeholder: 'Frase escrita no bolo' }) };
    const enderecoBox = h('div', {}, field('Endereço de entrega', f.endereco));
    const itensBox = h('div', { class: 'form-stack', style: { gap: '6px' } });
    const totalBox = h('div', { class: 'kv' });
    const boloBox = card({ title: 'Detalhes do bolo' }, h('div', { class: 'form-row' }, field('Tamanho / peso', bolo.tamanho), field('Massa', bolo.massa)),
      h('div', { class: 'form-row' }, field('Recheio', bolo.recheio), field('Cobertura', bolo.cobertura)),
      h('div', { class: 'form-row' }, field('Tema / decoração', bolo.tema), field('Escrita', bolo.escrita)));

    const total = () => st.itens.reduce((s, i) => s + (parseNum(i.quantidade) * parseNum(i.preco_unit)), 0);
    const desenharItens = () => {
      itensBox.replaceChildren(...st.itens.map((it, idx) => h('div', { class: 'item-line', style: { padding: '8px 10px', gap: '8px', flexWrap: 'wrap' } },
        h('input', { class: 'input', value: it.descricao, placeholder: 'Item', style: { flex: '2 1 160px' }, onInput: (e) => { it.descricao = e.target.value; } }),
        h('input', { class: 'input', value: it.quantidade, inputMode: 'decimal', placeholder: 'Qtd', style: { width: '74px' }, onInput: (e) => { it.quantidade = e.target.value; resumo(); } }),
        h('input', { class: 'input', value: it.preco_unit, inputMode: 'decimal', placeholder: 'R$ un.', style: { width: '96px' }, onInput: (e) => { it.preco_unit = e.target.value; resumo(); } }),
        h('button', { class: 'icon-btn', title: 'Remover', onClick: () => { st.itens.splice(idx, 1); desenharItens(); } }, icon('x')))));
      resumo();
    };
    const resumo = () => { const t = total(); const s = parseNum(f.sinal.value); totalBox.replaceChildren(h('span', {}, 'Total'), h('b', {}, brl(t)), h('span', {}, 'Sinal'), h('b', {}, brl(s)), h('span', {}, 'Falta pagar'), h('b', {}, brl(Math.max(t - s, 0)))); };
    f.sinal.addEventListener('input', resumo);
    const addSel = select([{ value: '', label: '+ Adicionar do cardápio' }, ...catalogo.map((p) => ({ value: String(p.id), label: `${p.nome}${p.preco ? ` · ${brl(p.preco)}/${p.unidade || 'un'}` : ''}` }))], {
      onChange: (e) => { const p = catalogo.find((x) => String(x.id) === e.target.value); if (p) st.itens.push({ produto_id: p.id, descricao: p.nome, quantidade: '1', preco_unit: p.preco ? String(p.preco).replace('.', ',') : '' }); e.target.value = ''; desenharItens(); } });

    const tipoSeg = h('div');
    const desenharTipo = () => {
      tipoSeg.replaceChildren(seg([{ value: 'BOLO', label: 'Bolo decorado' }, { value: 'EVENTO', label: 'Evento / salgados e doces' }, { value: 'OUTRO', label: 'Outro' }], st.tipo, (v) => { st.tipo = v; desenharTipo(); }));
      boloBox.style.display = st.tipo === 'BOLO' ? '' : 'none';
    };
    const entregaSeg = h('div');
    const desenharEntrega = () => { entregaSeg.replaceChildren(seg([{ value: 'RETIRADA', label: 'Retirada na loja' }, { value: 'ENTREGA', label: 'Entrega' }], st.entrega_tipo, (v) => { st.entrega_tipo = v; desenharEntrega(); })); enderecoBox.style.display = st.entrega_tipo === 'ENTREGA' ? '' : 'none'; };
    if (st.tipo === 'BOLO' && !st.itens.length) st.itens.push({ descricao: 'Bolo decorado', quantidade: '1', preco_unit: '' });
    desenharTipo(); desenharEntrega(); desenharItens();

    const salvar = h('button', { class: 'btn big', onClick: async () => {
      const dados = {
        tipo: st.tipo, loja: f.loja.value, cliente_nome: f.cliente.value.trim(), cliente_fone: f.fone.value.trim(), data_entrega: f.data.value, hora_entrega: f.hora.value,
        entrega_tipo: st.entrega_tipo, endereco: st.entrega_tipo === 'ENTREGA' ? f.endereco.value : '', sinal: parseNum(f.sinal.value), observacao: f.obs.value.trim(), atendente: f.atendente.value.trim(),
        detalhes: st.tipo === 'BOLO' ? Object.fromEntries(Object.entries(bolo).map(([k, el]) => [k, el.value.trim()]).filter(([, v]) => v)) : {},
        itens: st.itens.filter((i) => i.descricao.trim() && parseNum(i.quantidade) > 0).map((i) => ({ produto_id: i.produto_id || null, descricao: i.descricao.trim(), quantidade: parseNum(i.quantidade), preco_unit: parseNum(i.preco_unit) })),
      };
      const falta = [!dados.atendente && 'seu nome', !dados.loja && 'a loja', !dados.cliente_nome && 'o cliente', !dados.data_entrega && 'a data de entrega', !dados.itens.length && 'pelo menos um item'].filter(Boolean);
      if (falta.length) return toast(`Preencha ${falta.join(', ')}.`, 'error');
      salvar.disabled = true;
      try {
        const { numero } = await api.post('/api/public/encomenda', dados);
        lembrar.set({ nome: dados.atendente, loja: dados.loja });
        const enc = { ...dados, numero, total: total(), status: 'CONFIRMADO' };
        content.replaceChildren(successCard(`Encomenda ${numero} registrada`, `${dados.cliente_nome} · ${dataBR(dados.data_entrega)} ${dados.hora_entrega || ''}`, () => nova(),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
            h('button', { class: 'btn ghost', onClick: () => comprovante(enc) }, icon('file'), 'Comprovante do cliente'),
            dados.cliente_fone ? h('a', { class: 'btn ghost', href: linkWhats(dados.cliente_fone, textoCliente(enc)), target: '_blank', rel: 'noopener' }, 'Enviar no WhatsApp') : null)));
        window.scrollTo(0, 0);
      } catch (e) { toast(e.message, 'error'); salvar.disabled = false; }
    } }, 'Registrar encomenda');

    content.replaceChildren(
      card({}, h('div', { class: 'form-row' }, field('Seu nome *', f.atendente), field('Loja *', f.loja)), field('Tipo', tipoSeg)),
      card({ title: 'Cliente e entrega' }, h('div', { class: 'form-row' }, field('Cliente *', f.cliente), field('Telefone / WhatsApp', f.fone)),
        h('div', { class: 'form-row' }, field('Data *', f.data), field('Horário', f.hora)), field('Como recebe', entregaSeg), enderecoBox),
      boloBox,
      card({ title: 'Itens e valores', desc: 'Escolha do cardápio ou digite. Para eventos, a quantidade pode ser em centos.' }, itensBox,
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, addSel,
          h('button', { class: 'btn ghost small', onClick: () => { st.itens.push({ descricao: '', quantidade: '1', preco_unit: '' }); desenharItens(); } }, '+ Item livre')),
        h('div', { class: 'form-row', style: { marginTop: '10px' } }, field('Sinal pago (R$)', f.sinal), h('div', {}, totalBox))),
      card({}, field('Observações', f.obs)), salvar);
  }

  async function agenda() {
    const st = { loja: mem.loja || '', dias: 7 };
    content.replaceChildren(loading('Carregando agenda...'));
    const carregar = async () => {
      const de = hojeISO(); const d = new Date(); d.setDate(d.getDate() + st.dias);
      const ate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      let lista = [];
      try { lista = await api.get(`/api/public/agenda-encomendas?loja=${encodeURIComponent(st.loja)}&de=${de}&ate=${ate}`); } catch (e) { toast(e.message, 'error'); }
      const lojaSel = select([{ value: '', label: 'As duas lojas' }, ...LOJAS], { onChange: (e) => { st.loja = e.target.value; carregar(); } }); lojaSel.value = st.loja;
      const diasSel = select([{ value: '1', label: 'Hoje e amanhã' }, { value: '7', label: 'Próximos 7 dias' }, { value: '30', label: 'Próximos 30 dias' }], { onChange: (e) => { st.dias = Number(e.target.value); carregar(); } }); diasSel.value = String(st.dias);
      const porDia = new Map(); lista.forEach((e) => { if (!porDia.has(e.data_entrega)) porDia.set(e.data_entrega, []); porDia.get(e.data_entrega).push(e); });
      content.replaceChildren(
        card({}, h('div', { class: 'form-row' }, field('Loja', lojaSel), field('Período', diasSel)),
          h('button', { class: 'btn ghost small', style: { marginTop: '8px' }, onClick: () => relatorioCozinha(lista, `Encomendas · ${st.loja || 'as duas lojas'}`) }, icon('file'), 'Imprimir para a cozinha')),
        !lista.length ? h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Nenhuma encomenda no período.') : null,
        ...[...porDia].map(([dia, encs]) => card({ title: `${diaSemana(dia)}, ${dataBR(dia)}` }, encs.map((e) => {
          const prox = { CONFIRMADO: 'EM_PRODUCAO', EM_PRODUCAO: 'PRONTO', PRONTO: 'ENTREGUE' }[e.status];
          return h('div', { class: 'item-line', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: '200px' } },
              h('b', {}, `${e.hora_entrega || '--:--'} · ${e.numero} · ${e.cliente_nome}`),
              h('div', { class: 'muted', style: { fontSize: '13px' } }, `${e.loja === 'VILLA' ? 'Villa' : 'Souza Cruz'} · ${e.entrega_tipo === 'ENTREGA' ? 'Entrega' : 'Retirada'}`),
              h('div', { style: { fontSize: '13.5px', marginTop: '4px' } }, (e.itens || []).map((i) => `${String(i.quantidade).replace('.', ',')}x ${i.descricao}`).join(' · ')),
              Object.keys(e.detalhes || {}).length ? h('div', { class: 'muted', style: { fontSize: '13px' } }, Object.entries(e.detalhes).map(([k, v]) => `${k}: ${v}`).join(' · ')) : null,
              e.observacao ? h('div', { style: { fontSize: '13px', color: 'var(--coral)' } }, e.observacao) : null),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' } },
              h('span', { class: `badge st-${e.status.toLowerCase()}` }, STATUS[e.status]),
              prox ? h('button', { class: 'btn small', onClick: async () => { try { await api.post('/api/public/encomenda-status', { id: e.id, status: prox }); toast(`${e.numero}: ${STATUS[prox]}`, 'ok'); carregar(); } catch (er) { toast(er.message, 'error'); } } }, `Marcar ${STATUS[prox].toLowerCase()}`) : null));
        }))));
    };
    carregar();
  }

  trocar();
}
