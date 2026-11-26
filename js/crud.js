// Tela padrão de cadastro: lista com busca/filtros + painel lateral para criar/editar.
// Usada por fornecedores, contratos, colaboradores, cotações etc.
import { sb } from './api.js';
import { h, input, select, textarea, field, table, toast, loading, alertBox, icon, brl, dataBR, num } from './ui.js';

export const ok = ({ data, error }) => { if (error) throw new Error(traduz(error.message)); return data; };
function traduz(m) {
  if (/row-level security|permission denied/i.test(m)) return 'Sua função não tem permissão para alterar isto.';
  if (/duplicate key/i.test(m)) return 'Já existe um registro com esses dados.';
  if (/violates foreign key/i.test(m)) return 'Este registro está sendo usado em outro lugar e não pode ser apagado.';
  if (/Payload too large|exceeded the maximum/i.test(m)) return 'Arquivo grande demais (máximo 20 MB).';
  return m;
}

// Formatação por tipo de campo
export function fmt(tipo, v) {
  if (v == null || v === '') return '—';
  if (tipo === 'money') return brl(v);
  if (tipo === 'date') return dataBR(v);
  if (tipo === 'number') return num(v);
  if (tipo === 'bool') return v ? 'Sim' : 'Não';
  return String(v);
}

export async function abrirArquivo(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 300);
  if (error) return toast(traduz(error.message), 'error');
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function enviarArquivo(bucket, pasta, file) {
  const nome = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_');
  const path = `${pasta}/${Date.now()}_${nome}`;
  ok(await sb.storage.from(bucket).upload(path, file, { contentType: file.type || 'application/octet-stream' }));
  return { path, nome: file.name };
}

// Painel lateral
export function drawer(titulo, corpo, { onClose } = {}) {
  const fundo = h('div', { class: 'drawer-bg', onClick: (e) => { if (e.target === fundo) fechar(); } });
  const fechar = () => { fundo.remove(); onClose?.(); };
  fundo.append(h('aside', { class: 'drawer' },
    h('div', { class: 'drawer-head' }, h('h2', {}, titulo), h('button', { class: 'icon-btn', 'aria-label': 'Fechar', onClick: fechar }, '✕')),
    h('div', { class: 'drawer-body' }, corpo)));
  document.body.append(fundo);
  return fechar;
}

// Monta o controle de um campo. f = {key, label, tipo, opcoes, obrigatorio, dica, largura}
function controle(f, valor, set) {
  const t = f.tipo || 'text';
  if (t === 'select') {
    const s = select([{ value: '', label: f.placeholder || 'Selecione' }, ...(f.opcoes || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))],
      { onChange: (e) => set(e.target.value || null) });
    s.value = valor ?? '';
    return s;
  }
  if (t === 'textarea') return textarea({ rows: 3, value: valor ?? '', onInput: (e) => set(e.target.value) });
  if (t === 'bool') {
    const c = h('input', { type: 'checkbox', checked: !!valor, onChange: (e) => set(e.target.checked) });
    return h('label', { class: 'check-inline' }, c, f.texto || 'Sim');
  }
  if (t === 'money' || t === 'number') {
    return input({ inputMode: 'decimal', value: valor == null ? '' : String(valor).replace('.', ','), placeholder: t === 'money' ? '0,00' : '0',
      onInput: (e) => { const s = e.target.value.trim(); set(s === '' ? null : Number(s.replace(/\./g, '').replace(',', '.'))); } });
  }
  if (t === 'date') return input({ type: 'date', value: valor ?? '', onInput: (e) => set(e.target.value || null) });
  if (t === 'stars') {
    const box = h('div', { class: 'stars' });
    const draw = (v) => box.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: n <= (v || 0) ? 'on' : '', onClick: () => { set(n); draw(n); } }, '★')));
    draw(valor); return box;
  }
  return input({ type: t === 'email' ? 'email' : t === 'tel' ? 'tel' : 'text', value: valor ?? '', placeholder: f.placeholder || '', onInput: (e) => set(e.target.value) });
}

// Formulário genérico em painel. Devolve uma Promise resolvida quando salvar.
export function formulario({ titulo, campos, valores = {}, tabela, arquivo, aoSalvar, extra }) {
  return new Promise((resolve) => {
    const dados = { ...valores };
    let file = null;
    const err = h('div');
    const btn = h('button', { class: 'btn block', type: 'submit' }, icon('check'), 'Salvar');
    const linhas = [];
    let par = [];
    for (const f of campos) {
      const el = field(f.label + (f.obrigatorio ? ' *' : ''), controle(f, dados[f.key], (v) => { dados[f.key] = v; }));
      if (f.dica) el.append(h('small', { class: 'muted' }, f.dica));
      if (f.largura === 'meia') { par.push(el); if (par.length === 2) { linhas.push(h('div', { class: 'form-row' }, par)); par = []; } } else {
        if (par.length) { linhas.push(h('div', { class: 'form-row' }, par)); par = []; }
        linhas.push(el);
      }
    }
    if (par.length) linhas.push(h('div', { class: 'form-row' }, par));
    if (arquivo) {
      const atual = dados[arquivo.campoPath] ? h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Arquivo atual: ',
        h('button', { type: 'button', class: 'link-btn', onClick: () => abrirArquivo(arquivo.bucket, dados[arquivo.campoPath]) }, dados[arquivo.campoNome] || 'abrir')) : null;
      linhas.push(field(arquivo.label || 'Arquivo (PDF ou foto)', h('div', {}, h('input', { type: 'file', class: 'input', accept: arquivo.accept || '.pdf,image/*', onChange: (e) => { file = e.target.files[0] || null; } }), atual)));
    }
    if (extra) linhas.push(extra);
    let fechar;
    const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
      e.preventDefault(); err.replaceChildren();
      for (const f of campos) if (f.obrigatorio && (dados[f.key] == null || dados[f.key] === '')) return err.append(alertBox(`Preencha: ${f.label}`));
      btn.disabled = true;
      try {
        if (file) { const up = await enviarArquivo(arquivo.bucket, arquivo.pasta || tabela, file); dados[arquivo.campoPath] = up.path; dados[arquivo.campoNome] = up.nome; }
        const linha = {}; for (const f of campos) linha[f.key] = dados[f.key] ?? null;
        if (arquivo) { linha[arquivo.campoPath] = dados[arquivo.campoPath] ?? null; linha[arquivo.campoNome] = dados[arquivo.campoNome] ?? null; }
        Object.assign(linha, extra?.valores?.() || {});
        if (!valores.id) for (const k of Object.keys(linha)) if (linha[k] == null) delete linha[k]; // deixa o banco usar o padrão
        if (aoSalvar) await aoSalvar(linha, dados);
        else if (valores.id) ok(await sb.from(tabela).update(linha).eq('id', valores.id));
        else ok(await sb.from(tabela).insert(linha));
        toast('Salvo.', 'ok'); fechar(); resolve(true);
      } catch (ex) { err.append(alertBox(ex.message)); btn.disabled = false; }
    } }, linhas, err, btn);
    fechar = drawer(titulo, form);
  });
}

// Página de lista completa
export async function paginaLista(area, cfg) {
  const { tabela, select: sel = '*', ordem = ['id', false], colunas, campos, titulo, filtros = [], busca = [], arquivo, acoes, transformar, vazio, novoLabel = 'Novo', podeEditar = true, resumo } = cfg;
  const estado = { q: '', f: {} };
  let linhas = [];
  const corpo = h('div');
  const barra = h('div', { class: 'filters', style: { marginBottom: '14px' } });
  area.replaceChildren(barra, corpo);

  const q = input({ placeholder: 'Buscar…', style: { minWidth: '220px' }, onInput: (e) => { estado.q = e.target.value.toLowerCase(); desenhar(); } });
  barra.append(field('Busca', q));
  for (const f of filtros) {
    const s = select([{ value: '', label: 'Todos' }, ...f.opcoes.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))], { onChange: (e) => { estado.f[f.key] = e.target.value; desenhar(); } });
    barra.append(field(f.label, s));
  }
  if (podeEditar) barra.append(h('div', { style: { marginLeft: 'auto' } }, h('button', { class: 'btn', onClick: () => editar({}) }, icon('plus'), novoLabel)));

  async function carregar() {
    corpo.replaceChildren(loading('Carregando...'));
    try {
      linhas = ok(await sb.from(tabela).select(sel).order(ordem[0], { ascending: ordem[1] }).limit(5000));
      if (transformar) linhas = linhas.map(transformar);
      desenhar();
    } catch (e) { corpo.replaceChildren(alertBox(e.message)); }
  }
  function desenhar() {
    const vis = linhas.filter((r) => (!estado.q || busca.some((k) => String(r[k] ?? '').toLowerCase().includes(estado.q)))
      && filtros.every((f) => !estado.f[f.key] || (f.teste ? f.teste(r, estado.f[f.key]) : String(r[f.key]) === estado.f[f.key])));
    const cols = colunas.map((c) => ({ ...c, render: c.render || ((r) => fmt(c.tipo, r[c.key])) }));
    if (arquivo) cols.push({ label: 'Arquivo', render: (r) => (r[arquivo.campoPath] ? h('button', { class: 'link-btn', onClick: (e) => { e.stopPropagation(); abrirArquivo(arquivo.bucket, r[arquivo.campoPath]); } }, icon('clipboard'), 'Abrir') : '—') });
    if (podeEditar || acoes) cols.push({ label: '', render: (r) => h('div', { class: 'row-actions' },
      ...(acoes ? acoes(r, carregar) : []),
      podeEditar ? h('button', { class: 'btn ghost small', onClick: () => editar(r) }, 'Editar') : null,
      podeEditar ? h('button', { class: 'btn ghost small danger-text', title: 'Apagar', onClick: () => apagar(r) }, icon('trash')) : null) });
    corpo.replaceChildren(resumo ? resumo(vis) : '', h('div', { class: 'card', style: { padding: '6px 10px' } }, table(cols, vis, { maxHeight: false, emptyText: vazio || 'Nada cadastrado ainda.' })),
      h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } }, `${vis.length} de ${linhas.length} registro(s)`));
  }
  async function editar(r) {
    const salvo = await formulario({ titulo: r.id ? `Editar ${titulo}` : `Novo ${titulo}`, campos: typeof campos === 'function' ? campos(r) : campos, valores: r, tabela, arquivo });
    if (salvo) carregar();
  }
  let confirma = null;
  async function apagar(r) {
    if (confirma !== r.id) { confirma = r.id; toast('Clique de novo na lixeira para confirmar a exclusão.', 'warn'); setTimeout(() => { confirma = null; }, 5000); return; }
    try {
      ok(await sb.from(tabela).delete().eq('id', r.id));
      if (arquivo && r[arquivo.campoPath]) await sb.storage.from(arquivo.bucket).remove([r[arquivo.campoPath]]);
      toast('Apagado.', 'ok'); carregar();
    } catch (e) { toast(e.message, 'error'); }
  }
  await carregar();
  return { recarregar: carregar };
}

// Abas simples
export function abas(lista, ativa, onChange) {
  return h('div', { class: 'tabs' }, lista.map(([id, label]) => h('button', { class: `tab${id === ativa ? ' on' : ''}`, onClick: () => onChange(id) }, label)));
}
