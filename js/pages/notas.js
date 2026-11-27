// Notas fiscais: importar XML, conferir itens, vincular aos insumos (o sistema aprende) e acompanhar.
import { sb, clearMemo } from '../api.js';
import { h, kpi, field, input, select, table, toast, loading, alertBox, icon, brl, num, dataBR, combo } from '../ui.js';
import { pageHeader } from './_painel.js';
import { drawer, ok, abrirArquivo } from '../crud.js';
import { lerNFe } from '../nfe.js';

const LOJAS = [{ value: 'VILLA', label: 'Villa Schlosser' }, { value: 'SOUZA_CRUZ', label: 'Souza Cruz' }];
const lojaNome = (l) => (l === 'VILLA' ? 'Villa' : l === 'SOUZA_CRUZ' ? 'Souza Cruz' : '—');
const ORIGEM = { xml: 'XML', email: 'E-mail', foto: 'Foto', manual: 'Manual', pedido: 'Pedido' };

export async function render(main) {
  pageHeader(main, { title: 'Notas fiscais', sub: 'Entrada de mercadorias: estoque e contas a pagar de uma vez' });
  const area = h('div', {}, loading('Carregando notas...'));
  main.append(area);
  const st = { status: '', loja: '', q: '' };
  let notas = [], forn = new Map(), insumos = [], fotos = [];

  // Cadastro rápido: o item da nota ainda não existe como insumo
  function novoInsumo(texto, box, pronto) {
    const limpo = String(texto || '').toUpperCase().replace(/\s+/g, ' ').trim();
    const nome = input({ value: limpo });
    const un = select(UNIDADES_INSUMO); un.value = /\bKG\b|\d\s?KG/.test(limpo) ? 'KG' : 'UN';
    const cats = [...new Set(insumos.map((i) => i.categoria).filter(Boolean))].sort();
    const cat = h('div', {}, input({ list: 'cat-ins-nota', placeholder: 'Ex.: Doces e confeitaria' }), h('datalist', { id: 'cat-ins-nota' }, cats.map((c) => h('option', { value: c }))));
    const salvar = h('button', { class: 'btn small' }, 'Cadastrar e usar');
    salvar.addEventListener('click', async () => {
      const n = nome.value.trim().toUpperCase();
      if (!n) return toast('Dê um nome ao insumo.', 'error');
      salvar.disabled = true;
      try {
        const existente = insumos.find((i) => i.nome.toUpperCase() === n);
        const ins = existente || ok(await sb.from('insumos').insert({ nome: n, unidade: un.value, categoria: cat.querySelector('input').value.trim() || null, ativo: true, uso: 'estoque' })
          .select('id,nome,unidade,custo_unitario,categoria,uso').single());
        if (!existente) { insumos.push(ins); insumos.sort((a, b) => a.nome.localeCompare(b.nome)); clearMemo(); }
        box.replaceChildren();
        toast(`Insumo "${ins.nome}" cadastrado. Agora é só informar quantos vêm em cada unidade e tocar em Vincular.`, 'ok');
        pronto(ins);
      } catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'Já existe um insumo com esse nome.' : e.message, 'error'); salvar.disabled = false; }
    });
    box.replaceChildren(h('div', { class: 'novo-insumo' },
      h('b', {}, 'Novo insumo'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' } },
        h('div', { style: { flex: 2, minWidth: '200px' } }, field('Nome', nome)),
        field('Controlar em', un),
        h('div', { style: { flex: 1, minWidth: '160px' } }, field('Categoria', cat))),
      h('div', { style: { display: 'flex', gap: '8px' } }, salvar, h('button', { class: 'btn ghost small', onClick: () => box.replaceChildren() }, 'Cancelar'))));
    nome.focus();
  }

  async function carregar() {
    area.replaceChildren(loading('Carregando notas...'));
    try {
      const [n, f, i] = await Promise.all([
        sb.from('notas_fiscais').select('*, nota_itens(id, insumo_id, estoque_lancado)').order('data_emissao', { ascending: false }).limit(1000).then(ok),
        sb.from('fornecedores').select('id,nome').then(ok),
        sb.from('insumos').select('id,nome,unidade,custo_unitario,categoria,uso').eq('ativo', true).neq('uso', 'receita').order('nome').then(ok),
      ]);
      notas = n; forn = new Map(f.map((x) => [x.id, x.nome])); insumos = i;
      // Fila de fotos: as que aguardam leitura, com erro, e as lançadas nos últimos 7 dias
      const desde = new Date(Date.now() - 7 * 864e5).toISOString();
      const rf = await sb.from('notas_fotos').select('*').or(`status.in.(AGUARDANDO,ERRO),enviado_em.gte."${desde}"`).order('enviado_em', { ascending: false }).limit(50);
      fotos = rf.error ? [] : rf.data;
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
        kpi({ label: 'Comprado no mês', value: brl(doMes.reduce((s, n) => s + Number(n.valor_total), 0)), tone: 'expense',
          hint: doMes.some(temImpostos) ? `${brl(doMes.reduce((s, n) => s + Number(n.impostos_total || 0), 0))} de impostos destacados nas notas` : undefined }),
        kpi({ label: 'Com itens para vincular', value: num(notas.filter((n) => pend(n) > 0).length), tone: 'warning', hint: 'esses itens ainda não entraram no estoque' }),
        kpi({ label: 'Não lançadas no Raffinato', value: num(notas.filter((n) => !n.lancada_raffinato).length), tone: 'info' })),
      h('div', { class: 'filters', style: { marginBottom: '14px' } },
        field('Busca', input({ value: st.q, placeholder: 'Número ou fornecedor', onInput: (e) => { st.q = e.target.value.toLowerCase(); desenhar(); } })),
        field('Loja', sel([{ value: '', label: 'Todas' }, ...LOJAS], 'loja')),
        field('Situação', sel([{ value: '', label: 'Todas' }, { value: 'pend', label: 'Com itens para vincular' }, { value: 'ok', label: 'Completas' }], 'status')),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } }, arquivo,
          h('button', { class: 'btn', onClick: () => enviarFoto() }, icon('camera'), 'Foto da nota'),
          h('button', { class: 'btn ghost', onClick: () => arquivo.click() }, icon('plus'), 'Importar XML'))),
      fotos.length ? quadroFotos() : null,
      h('div', { class: 'card', style: { padding: '6px 10px' } }, table([
        { label: 'Emissão', render: (n) => dataBR(n.data_emissao || n.data_entrada) },
        { label: 'Nota', render: (n) => h('button', { class: 'link-btn', onClick: () => abrir(n) }, h('b', {}, `${n.tipo_doc === 'NF-e' ? 'NF' : n.tipo_doc} ${n.numero || '—'}`)) },
        { label: 'Fornecedor', render: (n) => forn.get(n.fornecedor_id) || '—' },
        { label: 'Loja', render: (n) => lojaNome(n.loja) },
        { label: 'Itens', render: (n) => num(n.nota_itens.length), right: true },
        { label: 'Valor', render: (n) => brl(n.valor_total), right: true },
        { label: 'Impostos', render: (n) => temImpostos(n) ? brl(n.impostos_total) : '—', right: true },
        { label: 'Situação', render: (n) => { const p = pend(n); return h('span', { class: `badge ${p ? 'warn' : 'ok'}` }, p ? `${p} p/ vincular` : 'Completa'); } },
        { label: 'Raffinato', render: (n) => h('span', { class: `badge ${n.lancada_raffinato ? 'ok' : ''}` }, n.lancada_raffinato ? 'Lançada' : 'Pendente') },
        { label: 'Origem', render: (n) => ORIGEM[n.origem] || n.origem || '—' },
      ], vis, { maxHeight: false, emptyText: 'Nenhuma nota ainda. Importe o XML que o fornecedor manda por e-mail, ou use "Foto da nota".' })));
  }

  // ---------- Fotos de notas: a equipe envia, o Claude lê e lança ----------
  const FOTO_STATUS = { AGUARDANDO: ['Aguardando leitura', 'warn'], LANCADA: ['Lançada', 'ok'], DUPLICADA: ['Já estava lançada', ''], ERRO: ['Precisa de atenção', 'error'] };
  function quadroFotos() {
    return h('div', { class: 'card', style: { padding: '10px 14px', marginBottom: '14px' } },
      h('div', { class: 'form-section-title', style: { marginTop: 0 } }, 'Fotos de notas enviadas'),
      h('p', { class: 'muted', style: { margin: '0 0 8px', fontSize: '12.5px' } }, 'O Claude lê as fotos e lança a nota com estoque e contas a pagar (na importação diária ou quando você pedir).'),
      table([
        { label: 'Enviada', render: (f) => `${dataBR(f.enviado_em)} ${f.enviado_em.slice(11, 16)}` },
        { label: 'Loja', render: (f) => lojaNome(f.loja) },
        { label: 'Fotos', render: (f) => h('div', { style: { display: 'flex', gap: '6px' } }, ...f.arquivos.map((a, i) =>
          h('button', { class: 'link-btn', onClick: () => abrirArquivo('notas', a) }, f.arquivos.length > 1 ? `pág. ${i + 1}` : 'ver'))) },
        { label: 'Situação', render: (f) => { const [t, c] = FOTO_STATUS[f.status] || [f.status, '']; return h('span', { class: `badge ${c}`, title: f.mensagem || '' }, t); } },
        { label: 'Observação', render: (f) => f.mensagem || f.observacao || '' },
        { label: '', render: (f) => {
          if (f.nota_id) { const n = notas.find((x) => x.id === f.nota_id); return n ? h('button', { class: 'link-btn', onClick: () => abrir(n) }, `NF ${n.numero}`) : ''; }
          if (f.status !== 'AGUARDANDO' && f.status !== 'ERRO') return '';
          return h('button', { class: 'btn ghost small', title: 'Apagar esta foto', onClick: async () => {
            if (!confirm('Apagar esta foto da fila?')) return;
            try { await sb.storage.from('notas').remove(f.arquivos); ok(await sb.from('notas_fotos').delete().eq('id', f.id)); toast('Foto apagada.', 'ok'); carregar(); } catch (e) { toast(e.message, 'error'); }
          } }, icon('trash')); }, right: true },
      ], fotos, { maxHeight: false }));
  }

  function enviarFoto() {
    let fechar; let arquivos = [];
    const lista = h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Nenhuma foto ainda.');
    const mostra = () => { lista.replaceChildren(...(arquivos.length ? arquivos.map((f, i) => h('div', {}, `Página ${i + 1}: ${f.name}`)) : ['Nenhuma foto ainda.'])); };
    const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onChange: (e) => { arquivos.push(...e.target.files); e.target.value = ''; mostra(); } });
    const galeria = h('input', { type: 'file', accept: 'image/*,.pdf', multiple: true, class: 'hidden', onChange: (e) => { arquivos.push(...e.target.files); e.target.value = ''; mostra(); } });
    const loja = select([{ value: '', label: 'Não sei (o Claude descobre pelo CNPJ)' }, ...LOJAS]);
    const obs = input({ placeholder: 'Ex.: chegou com 1 caixa faltando' });
    const enviar = h('button', { class: 'btn block', onClick: async () => {
      if (!arquivos.length) return toast('Tire a foto da nota primeiro.', 'error');
      enviar.disabled = true; enviar.textContent = 'Enviando...';
      try {
        const caminhos = [];
        for (const f of arquivos) {
          const img = await reduzirFoto(f);
          const ext = img.type === 'application/pdf' ? 'pdf' : 'jpg';
          const path = `fotos/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${caminhos.length + 1}.${ext}`;
          ok(await sb.storage.from('notas').upload(path, img, { contentType: img.type || 'image/jpeg' }));
          caminhos.push(path);
        }
        ok(await sb.from('notas_fotos').insert({ arquivos: caminhos, loja: loja.value || null, observacao: obs.value.trim() || null }));
        toast('Foto enviada. O Claude vai ler e lançar a nota.', 'ok'); fechar(); carregar();
      } catch (e) { toast(e.message, 'error'); enviar.disabled = false; enviar.textContent = 'Enviar para lançamento'; }
    } }, 'Enviar para lançamento');
    const corpo = h('div', { class: 'form-stack' },
      h('p', { style: { margin: 0 } }, 'Fotografe a nota inteira, bem iluminada e sem cortar as bordas. Se tiver mais de uma página, tire uma foto de cada.'),
      camera, galeria,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onClick: () => camera.click() }, icon('camera'), arquivos.length ? 'Tirar mais uma' : 'Tirar foto'),
        h('button', { class: 'btn ghost', onClick: () => galeria.click() }, icon('file'), 'Escolher da galeria')),
      lista,
      field('Loja', loja),
      field('Observação (opcional)', obs),
      enviar);
    fechar = drawer('Foto da nota fiscal', corpo);
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
      // insumos de receita (fora da lista de estoque) também precisam aparecer pelo nome
      const faltam = [...new Set(itens.map((i) => i.insumo_id).filter((id) => id && !insMap.has(id)))];
      if (faltam.length) ok(await sb.from('insumos').select('id,nome,unidade,custo_unitario,categoria,uso').in('id', faltam)).forEach((i) => insMap.set(i.id, i));
      const linhas = itens.map((it) => {
        const ins = insMap.get(it.insumo_id);
        if (it.insumo_id || it.estoque_lancado) {
          return h('div', { class: 'item-line' }, h('div', { style: { flex: 1 } }, h('b', {}, it.descricao),
            h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${num(it.quantidade)} ${it.unidade || ''} · ${brl(it.valor_total)}`)),
            h('div', { style: { textAlign: 'right', fontSize: '13px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } },
              ins ? h('span', { class: 'badge ok' }, `→ ${ins.nome}${Number(it.fator) !== 1 ? ` (×${num(it.fator)})` : ''}`) : h('span', { class: 'badge' }, 'Fora do estoque'),
              h('button', { class: 'link-btn', style: { color: 'var(--coral)', fontSize: '12.5px', fontWeight: 700 }, onClick: async () => {
                if (!confirm(ins ? `Desfazer o vínculo com "${ins.nome}"? A entrada no estoque desse item é retirada e você escolhe o insumo certo.` : 'Voltar este item para "a vincular"?')) return;
                try { ok(await sb.rpc('desvincular_item_nota', { p_item: it.id })); toast('Vínculo desfeito. Agora escolha o insumo certo.', 'ok'); desenharNota(); carregar(); } catch (e) { toast(e.message, 'error'); }
              } }, 'Corrigir vínculo')));
        }
        let escolhido = null;
        const fator = input({ inputMode: 'decimal', value: '1', style: { width: '80px' } });
        const dica = h('div', { class: 'muted', style: { fontSize: '12px' } });
        const atualizaDica = () => { const i = insMap.get(escolhido); const f = Number(fator.value.replace(',', '.')) || 1;
          dica.textContent = i ? `Entra ${num(it.quantidade * f)} ${i.unidade} no estoque · custo ${brl(it.valor_total / (it.quantidade * f))}/${i.unidade}` : ''; };
        fator.addEventListener('input', atualizaDica);
        const novoBox = h('div');
        const c = combo({ options: insumos.map((i) => ({ value: i.id, label: i.nome, sub: i.unidade })), placeholder: 'Qual insumo é este?', onSelect: (o) => { escolhido = o?.value || null; atualizaDica(); },
          createLabel: 'Cadastrar novo insumo', onCreate: (texto) => novoInsumo(texto || it.descricao, novoBox, (ins) => {
            insMap.set(ins.id, ins); escolhido = ins.id; c.setValue(ins.nome);
            c.setOptions(insumos.map((i) => ({ value: i.id, label: i.nome, sub: i.unidade }))); atualizaDica();
          }) });
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
          dica, novoBox);
      });
      corpo.replaceChildren(h('div', { class: 'form-stack' },
        h('div', { class: 'kv-list' },
          ...[['Emissão', dataBR(n.data_emissao)], ['Loja', lojaNome(n.loja)], ['Valor total', brl(n.valor_total)], ['Origem', ORIGEM[n.origem] || n.origem], ['Chave', n.chave_acesso ? `…${n.chave_acesso.slice(-12)}` : '—'], ['Série', n.serie || '—']]
            .map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v)))),
        n.arquivo_url ? h('button', { class: 'btn ghost small', style: { alignSelf: 'flex-start' }, onClick: () => abrirArquivo('notas', n.arquivo_url) }, icon('camera'), 'Ver foto da nota') : null,
        ...quadroImpostos(n),
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

const temImpostos = (n) => n.impostos_informados === true;

// Diminui a foto do celular (até 2400px, JPEG) para enviar mais rápido; mantém legível para a leitura.
async function reduzirFoto(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

// Impostos destacados no XML: ICMS, PIS, COFINS e IBS/CBS já estão dentro do preço; ST, FCP-ST e IPI vêm somados por cima.
function quadroImpostos(n) {
  if (!temImpostos(n)) return [];
  const linhas = [['ICMS', n.icms], ['ICMS-ST', n.icms_st], ['FCP-ST', n.fcp_st], ['IPI', n.ipi], ['PIS', n.pis], ['COFINS', n.cofins], ['IBS', n.ibs], ['CBS', n.cbs]]
    .filter(([, v]) => Number(v) > 0);
  const porCima = Number(n.icms_st) + Number(n.fcp_st) + Number(n.ipi);
  return [
    h('div', { class: 'form-section-title' }, 'Impostos da nota'),
    linhas.length
      ? h('div', { class: 'kv-list' },
          ...linhas.map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, brl(v)))),
          h('div', { class: 'kv' }, h('b', {}, 'Total destacado'), h('b', {}, brl(n.impostos_total))),
          n.tributos_aprox != null ? h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Carga aproximada de tributos (informada)'), h('span', {}, brl(n.tributos_aprox))) : null)
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum imposto destacado nesta nota (fornecedor do Simples Nacional ou isento).'),
    linhas.length ? h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, porCima > 0
      ? `${brl(porCima)} (ST/IPI) foram somados por cima do preço dos produtos; o restante já está dentro do preço.`
      : 'Esses impostos já estão dentro do preço dos produtos; nada foi cobrado à parte.') : null,
  ];
}

// Cadastro rápido de insumo direto da nota (quando o item ainda não existe no cadastro)
const UNIDADES_INSUMO = [{ value: 'KG', label: 'kg' }, { value: 'G', label: 'g' }, { value: 'L', label: 'litro' }, { value: 'ML', label: 'ml' }, { value: 'UN', label: 'unidade' }, { value: 'CX', label: 'caixa' }, { value: 'PCT', label: 'pacote' }, { value: 'FD', label: 'fardo' }];
