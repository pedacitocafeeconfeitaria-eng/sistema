// Camada de dados do ERP Pedacito: as telas continuam chamando os mesmos endereços
// (/api/...), e aqui cada um vira uma consulta ao Supabase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// ---------- utilitários ----------
const COD_KEY = 'pedacito_codigo_equipe';
export const codigoEquipe = {
  get: () => { try { return localStorage.getItem(COD_KEY) || ''; } catch { return ''; } },
  set: (v) => { try { localStorage.setItem(COD_KEY, v); } catch { /* sem armazenamento */ } },
};
// Sessão do PIN pessoal (vale até as 4h do dia seguinte, neste aparelho)
const SES_KEY = 'pedacito_sessao_equipe';
export const sessaoEquipe = {
  get: () => { try { const s = JSON.parse(localStorage.getItem(SES_KEY) || 'null'); return s && new Date(s.expira) > new Date() ? s : null; } catch { return null; } },
  set: (v) => { try { if (v) localStorage.setItem(SES_KEY, JSON.stringify(v)); else localStorage.removeItem(SES_KEY); } catch { /* sem armazenamento */ } },
};
// O que vai no p_codigo das funções do banco: "CODIGO" ou "CODIGO|TOKEN"
const cod = () => { const s = sessaoEquipe.get(); return codigoEquipe.get() + (s ? `|${s.token}` : ''); };
const LOJA_UI = { VILLA: 'Villa', SOUZA_CRUZ: 'Souza Cruz' };
const lojaUI = (l) => LOJA_UI[l] || l || '—';
const lojaDB = (l) => (/souza/i.test(l || '') ? 'SOUZA_CRUZ' : /villa/i.test(l || '') ? 'VILLA' : null);
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const diaSemana = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return DIAS[new Date(y, m - 1, d).getDay()]; };

function erro(e, status) {
  const msg = e?.message || String(e);
  const err = new Error(/Código da equipe inválido/.test(msg) ? 'Código da equipe inválido. Digite o código novamente.' : msg);
  err.status = status || (/JWT|permission|denied/i.test(msg) ? 403 : 400);
  if (/Código da equipe/.test(msg)) { codigoEquipe.set(''); sessaoEquipe.set(null); err.status = 401; }
  if (/Identifique-se com seu PIN|acesso expirou/.test(msg)) { sessaoEquipe.set(null); err.status = 401; err.pin = true; }
  return err;
}
const ok = ({ data, error }) => { if (error) throw erro(error); return data; };
const rpc = async (fn, args) => ok(await sb.rpc(fn, args));

// Lê todas as linhas (o Supabase devolve no máximo 1000 por vez).
async function tudo(tabela, select = '*', ajustar = (q) => q) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const lote = ok(await ajustar(sb.from(tabela).select(select)).range(de, de + 999));
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

// ---------- cache de listas dos formulários ----------
let cacheProdutos = null;
let cacheInsumos = null;
async function produtosVenda(force) {
  if (!cacheProdutos || force) cacheProdutos = await rpc('form_produtos', { p_codigo: cod(), p_loja: null });
  return cacheProdutos;
}
async function produtoPorNome(nome) {
  const lista = await produtosVenda();
  return lista.find((p) => p.nome.toUpperCase() === String(nome || '').toUpperCase());
}

// ---------- rotas ----------
const ROTAS = {
  // Código da equipe
  'GET /api/public/acesso': async () => {
    if (!codigoEquipe.get()) return { precisaCodigo: true };
    const sessao = sessaoEquipe.get();
    if (sessao) return { precisaCodigo: false, sessao };
    const c = await rpc('form_config_equipe', { p_codigo: codigoEquipe.get() }).catch((e) => { if (e.status === 401) throw e; return { exigir_pin: false }; });
    return { precisaCodigo: false, sessao: null, exigirPin: !!c.exigir_pin };
  },
  'POST /api/public/acesso': async (b) => {
    const c = String(b.codigo || '').trim();
    await rpc('form_equipe', { p_codigo: c, p_loja: null }).catch(() => { throw erro('Código incorreto.', 401); });
    codigoEquipe.set(c);
    return { ok: true };
  },
  // PIN pessoal
  'POST /api/public/entrar': async (b) => {
    const r = await rpc('equipe_entrar', { p_codigo: codigoEquipe.get(), p_pin: String(b.pin || '') });
    if (!r.ok) throw erro(r.erro);
    const s = { token: r.token, funcionario_id: r.funcionario_id, nome: r.nome, loja: r.loja, expira: r.expira };
    sessaoEquipe.set(s);
    return s;
  },
  'POST /api/public/sair': async () => {
    const s = sessaoEquipe.get(); sessaoEquipe.set(null);
    if (s) await sb.rpc('equipe_sair', { p_token: s.token });
    return { ok: true };
  },

  // Listas
  'GET /api/public/produtos-venda': async (_, q) => {
    const lista = await produtosVenda(q.force === '1');
    return { produtos: lista.map((p) => ({ produto: p.nome, tipo: p.tipo, valor: Number(p.preco) || 0, status: 'Ativo Ambos' })) };
  },
  'GET /api/public/insumos': async () => {
    cacheInsumos = await rpc('form_insumos', { p_codigo: cod() });
    return { produtos: cacheInsumos.map((i) => ({ produto: i.nome, categoria: i.categoria || 'Sem categoria', unidade: i.unidade, status: 'ATIVO' })) };
  },
  'GET /api/public/bancos': async () => ({ bancos: await rpc('form_bancos', { p_codigo: cod() }).catch(() => []) }),

  // Contagem de estoque
  'GET /api/public/saldos': async (_, q) => ({ itens: await rpc('form_saldos', { p_codigo: cod(), p_loja: q.loja }) }),
  'GET /api/public/catalogo-encomenda': async () => rpc('form_catalogo_encomenda', { p_codigo: cod() }),
  'POST /api/public/encomenda': async (b) => ({ numero: await rpc('form_encomenda', { p_codigo: cod(), p: b }) }),
  'GET /api/public/agenda-encomendas': async (_, q) => rpc('form_agenda_encomendas', { p_codigo: cod(), p_loja: lojaDB(q.loja), p_de: q.de, p_ate: q.ate }),
  'POST /api/public/encomenda-status': async (b) => rpc('form_encomenda_status', { p_codigo: cod(), p_id: b.id, p_status: b.status }),
  'GET /api/public/equipe': async (_, q) => rpc('form_equipe', { p_codigo: cod(), p_loja: q.loja }),
  'GET /api/public/minhas-tarefas': async (_, q) => rpc('form_minhas_tarefas', { p_codigo: cod(), p_loja: q.loja, p_funcionario: Number(q.f) }),
  'POST /api/public/tarefa': async (b) => rpc('form_concluir_tarefa', { p_codigo: cod(), p_tarefa: b.id, p_data: b.data, p_nome: b.nome, p_obs: b.obs || null, p_desfazer: !!b.desfazer }),
  'POST /api/public/contagem': async (b) => rpc('form_contagem', { p_codigo: cod(), p_loja: b.loja, p_nome: b.nome, p_itens: b.itens, p_obs: b.obs || null }),

  // Cozinha: produção
  'POST /api/public/producao': async (b) => {
    const itens = [];
    for (const p of b.produtos || []) {
      const prod = await produtoPorNome(p.produto);
      if (!prod) throw erro(`Produto não encontrado: ${p.produto}`);
      itens.push({ produto_id: prod.id, quantidade: Number(p.quantidade), observacao: p.observacao || '' });
    }
    await rpc('form_producao', { p_codigo: cod(), p_data: b.data, p_loja: b.loja, p_turno: b.turno, p_nome: b.nome, p_itens: itens });
    return { ok: true };
  },
  // Cozinha: desperdício
  'POST /api/public/desperdicio-cozinha': async (b) => {
    const itens = (b.produtos || []).map((p) => ({ nome: p.produto, quantidade: Number(p.quantidade), valor: Number(p.valor) || 0, motivo: p.motivo }));
    await rpc('form_desperdicio', { p_codigo: cod(), p_origem: 'COZINHA', p_data: b.data, p_loja: b.loja, p_turno: b.turno, p_nome: b.nome, p_itens: itens });
    return { ok: true };
  },
  // Balcão
  'POST /api/public/registro': async (b) => {
    const c = cod();
    if (b.teveProblema === 'sim' && (b.problemas || []).length) {
      const itens = [];
      for (const p of b.problemas) {
        const prod = await produtoPorNome(p.produto);
        itens.push(prod ? { produto_id: prod.id, quantidade: Number(p.quantidade), motivo: p.motivo } : { nome: p.produto, quantidade: Number(p.quantidade), motivo: p.motivo });
      }
      await rpc('form_desperdicio', { p_codigo: c, p_origem: 'BALCAO', p_data: b.data, p_loja: b.loja, p_turno: b.turno, p_nome: b.nome, p_itens: itens });
    }
    await rpc('form_balcao', { p_codigo: c, p_data: b.data, p_loja: b.loja, p_turno: b.turno, p_nome: b.nome,
      p_observacoes: b.observacoes || null, p_teve_falta: b.teveFalta === 'sim', p_produtos_falta: b.teveFalta === 'sim' ? b.produtosFalta : null });
    return { ok: true };
  },
  // Denúncia
  'POST /api/public/denuncia': async (b) => {
    const anon = b.anonimo !== 'nao';
    const protocolo = await rpc('form_denuncia', { p_tipo: b.tipo, p_categoria: b.categoria, p_descricao: b.descricao, p_envolvidos: b.envolvidos || null,
      p_data_fato: b.data || null, p_loja: b.loja || null, p_anonima: anon, p_contato: anon ? null : [b.nome, b.contato].filter(Boolean).join(' · ') });
    return { ok: true, protocolo };
  },
  // Movimentação de estoque
  'POST /api/public/movimentacao': async (b) => {
    const r = await rpc('form_movimentacao_v2', { p_codigo: cod(), p: b });
    return { ...r, avisos: [] };
  },
  // Lista de compras
  'GET /api/public/lista': async () => {
    const rows = await rpc('form_lista', { p_codigo: cod() });
    return { itens: rows.map((r) => ({ id: r.id, produto: r.item, quantidade: r.quantidade, observacao: r.pedido_por ? `Pedido por ${r.pedido_por}` : '', loja: lojaUI(r.loja), comprado: r.comprado, created_at: r.criado_em })) };
  },
  'POST /api/public/lista': async (b) => {
    if (!String(b.produto || '').trim()) throw erro('Informe o produto.');
    const qtd = [b.quantidade, b.observacao].filter((x) => String(x || '').trim()).join(' · ');
    await rpc('form_lista_add', { p_codigo: cod(), p_loja: b.loja, p_item: b.produto, p_qtd: qtd || null, p_nome: null });
    return { ok: true };
  },
  'PATCH /api/public/lista/:id': async (b, q, id) => { await rpc('form_lista_marcar', { p_codigo: cod(), p_id: Number(id), p_comprado: !!b.comprado }); return { ok: true }; },
  'DELETE /api/public/lista/:id': async (b, q, id) => {
    await rpc('form_lista_remover', { p_codigo: cod(), p_id: id === 'comprados' ? null : Number(id) });
    return { ok: true };
  },

  // ---------- gestão (com login) ----------
  'GET /api/data/financeiro': async () => {
    const [lanc, contas, func, empr] = await Promise.all([
      tudo('lancamentos', 'id,loja,tipo,categoria,subcategoria,descricao,valor,vencimento,status,forma_pagamento,conta_id,pedidos,origem', (q) => q.order('vencimento')),
      tudo('contas_bancarias'), tudo('funcionarios', '*', (q) => q.eq('ativo', true)), tudo('emprestimos'),
    ]);
    const banco = new Map(contas.map((c) => [c.id, c.nome.toUpperCase()]));
    const mov = (l) => ({
      id: l.id, data: l.vencimento, loja: lojaUI(l.loja), tipo: l.tipo === 'RECEITA' ? 'Receita' : 'Despesa', categoria: l.categoria,
      subcategoria: l.subcategoria || '—', nome: l.descricao, formaPagamento: l.forma_pagamento || '—', banco: banco.get(l.conta_id) || '—',
      status: l.tipo === 'RECEITA' && /FATURAMENTO/i.test(l.categoria) && l.status === 'PAGO' ? 'Vendas' : cap(l.status), valor: Number(l.valor), pedidos: Number(l.pedidos) || 0,
    });
    const ehBoleto = (l) => l.origem === 'legado_boleto' || l.origem === 'estoque';
    return {
      movimentacoes: lanc.filter((l) => !ehBoleto(l)).map(mov),
      boletos: lanc.filter(ehBoleto).map(mov),
      funcionarios: func.map((f) => ({ nome: f.nome, loja: lojaUI(f.loja), cargo: f.cargo, salario: Number(f.salario) || 0, tipo: f.tipo, custoMensal: Number(f.custo_mensal) || Number(f.salario) || 0 })),
      emprestimos: empr.map((e) => {
        const n = Number(e.n_parcelas) || 0, pagas = Number(e.parcelas_pagas) || 0, rest = Math.max(n - pagas, 0);
        return { nome: e.nome, credor: e.credor, valorTotal: Number(e.valor_total) || 0, valorParcela: Number(e.valor_parcela) || 0, parcelasTotais: n,
          parcelasPagas: pagas, parcelasRestantes: rest, saldoDevedor: rest * (Number(e.valor_parcela) || 0), dataInicio: e.data_inicio, dataFinal: e.data_fim,
          status: /quitado/i.test(e.status || '') || (n > 0 && pagas >= n) ? 'Quitado' : e.status || 'Ativo' };
      }),
      atualizadoEm: Date.now(),
    };
  },
  'GET /api/data/operacao': async () => {
    const [prod, desp, balc] = await Promise.all([tudo('producao_registros', '*', (q) => q.order('data')), tudo('desperdicio_registros', '*', (q) => q.order('data')), tudo('balcao_relatorios')]);
    const falta = new Map(balc.map((b) => [[b.data, b.loja, b.turno, b.responsavel].join('|'), b]));
    return {
      producao: prod.map((r) => ({ nome: r.responsavel, data: r.data, diaSemana: diaSemana(r.data), loja: lojaUI(r.loja), turno: r.turno, categoria: r.tipo || 'Sem categoria',
        produto: r.produto_nome, quantidade: Number(r.quantidade), valor: Number(r.valor) || 0, observacao: r.observacao || '' })),
      desperdicio: desp.map((r) => {
        const b = falta.get([r.data, r.loja, r.turno, r.responsavel].join('|'));
        const coz = r.origem === 'COZINHA';
        return { nome: r.responsavel, data: r.data, diaSemana: diaSemana(r.data), loja: lojaUI(r.loja), turno: r.turno || (coz ? 'Cozinha' : ''),
          tipo: r.tipo || (coz ? 'Cozinha' : 'Não definido'), produto: r.item_nome, quantidade: Number(r.quantidade), motivo: r.motivo || '', valor: Number(r.valor) || 0,
          observacoes: b?.observacoes || '', teveFalta: b ? (b.teve_falta ? 'Sim' : 'Não') : '', origem: coz ? 'Cozinha' : 'Loja' };
      }),
      atualizadoEm: Date.now(),
    };
  },
  'GET /api/data/estoque': async () => {
    const [ins, movs] = await Promise.all([tudo('insumos', '*', (q) => q.neq('uso', 'receita').order('nome')), tudo('estoque_movimentos', '*', (q) => q.order('data'))]);
    const nome = new Map(ins.map((i) => [i.id, i]));
    return {
      base: ins.map((i) => ({ id: i.id, produto: i.nome, categoria: i.categoria || 'Sem categoria', unidade: i.unidade, estoqueMinimo: Number(i.estoque_minimo) || 0,
        valorUnidade: Number(i.custo_unitario) || 0, status: i.ativo ? 'ATIVO' : 'INATIVO' })),
      movs: movs.map((m) => {
        const i = nome.get(m.insumo_id) || {};
        const sinal = m.tipo === 'ENTRADA' || (m.tipo === 'AJUSTE' && m.quantidade >= 0);
        return { data: m.data, loja: lojaUI(m.loja), produto: i.nome, tipo: sinal ? 'Entrada' : 'Saída', quantidade: Math.abs(Number(m.quantidade)), unidade: i.unidade,
          valorUnitario: Number(m.custo_unit) || 0, valorTotal: Math.abs(Number(m.quantidade)) * (Number(m.custo_unit) || 0), nome: m.responsavel || '', observacao: m.observacao || '' };
      }),
      atualizadoEm: Date.now(),
    };
  },
  'GET /api/data/denuncias': async () => {
    const rows = await tudo('denuncias', '*', (q) => q.order('criado_em', { ascending: false }));
    return { denuncias: rows.map((d) => ({ rowIndex: d.id, id: d.protocolo, data: d.criado_em, tipo: d.tipo, categoria: d.categoria, descricao: d.descricao,
      envolvidos: d.envolvidos, anonimo: d.anonima ? 'Sim' : 'Não', nome: '', contato: d.contato, dataOcorrido: d.data_fato, gravidade: d.gravidade,
      status: d.status || 'Aberto', responsavel: d.responsavel || '', observacoes: d.notas_admin || '' })) };
  },
  'PUT /api/data/denuncias/:id': async (b, q, id) => {
    ok(await sb.from('denuncias').update({ status: b.status, responsavel: b.responsavel, notas_admin: b.observacoes }).eq('id', Number(id)));
    return { ok: true };
  },
  'POST /api/refresh': async () => { cacheProdutos = null; cacheInsumos = null; return { ok: true }; },

  // Cadastros
  'GET /api/cad/produtos': async () => ({ produtos: (await tudo('produtos', '*', (q) => q.order('nome'))).map((p) => ({
    rowIndex: p.id, produto: p.nome, tipo: p.tipo, valor: Number(p.preco) || 0,
    status: p.ativo_villa && p.ativo_souza ? 'Ativo Ambos' : p.ativo_villa ? 'Ativo Villa' : p.ativo_souza ? 'Ativo Souza Cruz' : 'Inativo' })) }),
  'POST /api/cad/produtos': async (b) => {
    if (!String(b.produto || '').trim()) throw erro('Informe o nome do produto');
    if (!b.tipo) throw erro('Selecione o tipo');
    const row = { nome: b.produto.trim(), tipo: b.tipo, preco: Number(b.valor) || 0, ativo_villa: /ambos|villa/i.test(b.status), ativo_souza: /ambos|souza/i.test(b.status) };
    ok(b.rowIndex ? await sb.from('produtos').update(row).eq('id', b.rowIndex) : await sb.from('produtos').insert(row));
    cacheProdutos = null;
    return { ok: true };
  },
  'GET /api/cad/insumos': async () => ({ produtos: (await tudo('insumos', '*', (q) => q.order('nome'))).map((i) => ({
    rowIndex: i.id, produto: i.nome, categoria: i.categoria || '', unidade: i.unidade, estoqueMinimo: Number(i.estoque_minimo) || 0,
    valorUnidade: Number(i.custo_unitario) || 0, status: i.ativo ? 'ATIVO' : 'INATIVO' })) }),
  'POST /api/cad/insumos': async (b) => {
    if (!String(b.produto || '').trim()) throw erro('Informe o nome do produto');
    if (!b.unidade) throw erro('Selecione a unidade');
    const row = { nome: b.produto.trim(), categoria: b.categoria || null, unidade: b.unidade, estoque_minimo: Number(b.estoqueMinimo) || 0,
      custo_unitario: Number(b.valorUnidade) || null, ativo: b.status !== 'INATIVO' };
    ok(b.rowIndex ? await sb.from('insumos').update(row).eq('id', b.rowIndex) : await sb.from('insumos').insert(row));
    return { ok: true };
  },
};

function resolver(method, url) {
  const u = new URL(url, location.origin);
  const q = Object.fromEntries(u.searchParams);
  for (const [k, fn] of Object.entries(ROTAS)) {
    const [m, pat] = k.split(' ');
    if (m !== method) continue;
    const re = new RegExp(`^${pat.replace(/:[a-z]+/g, '([^/]+)')}$`);
    const hit = u.pathname.match(re);
    if (hit) return { fn, q, params: hit.slice(1).map(decodeURIComponent) };
  }
  return null;
}

async function request(method, url, body) {
  const r = resolver(method, url);
  // Formulários: com PIN, o nome é sempre o da pessoa identificada (o banco também garante isso)
  const s = url.startsWith('/api/public/') && body ? sessaoEquipe.get() : null;
  if (s) { if ('nome' in body) body.nome = s.nome; if ('atendente' in body) body.atendente = s.nome; }
  if (!r) throw erro(`Função ainda não disponível no sistema novo (${method} ${url}).`, 404);
  try { return await r.fn(body || {}, r.q, ...r.params); } catch (e) {
    const x = e.status ? e : erro(e);
    if (x.pin) setTimeout(() => window.dispatchEvent(new Event('pedacito:pin')), 1500); // mostra o erro e volta para a tela do PIN
    throw x;
  }
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b || {}),
  patch: (u, b) => request('PATCH', u, b || {}),
  del: (u) => request('DELETE', u),
};

// Cache curto para trocar de tela sem recarregar tudo.
const memo = new Map();
export async function loadData(name, force = false) {
  const hit = memo.get(name);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.data;
  const data = await api.get(`/api/data/${name}`);
  memo.set(name, { at: Date.now(), data });
  return data;
}
export function clearMemo() { memo.clear(); }

// ---------- sessão ----------
const TODAS = ['dashboard', 'financeiro', 'projecoes', 'operacao', 'estoque', 'compras', 'notas', 'encomendas', 'fichas', 'cadastros', 'rh', 'tarefas', 'contratos', 'denuncias', 'config'];
export async function carregarSessao() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const perfil = ok(await sb.from('perfis').select('*').eq('user_id', session.user.id).maybeSingle());
  const base = { email: session.user.email, username: perfil?.nome || session.user.email.split('@')[0] };
  if (!perfil || !perfil.ativo) return { ...base, label: 'Aguardando liberação', role: 'pendente', areas: [] };
  if (perfil.funcao_id === 'admin') return { ...base, label: 'Administrador', role: 'admin', areas: TODAS };
  const mods = (await rpc('minhas_areas')).map((m) => m.modulo);
  const areas = new Set(mods.filter((m) => TODAS.includes(m)));
  if (mods.includes('producao') || mods.includes('desperdicio')) areas.add('operacao');
  if (mods.includes('financeiro')) areas.add('projecoes');
  if (areas.size) areas.add('dashboard');
  const funcao = ok(await sb.from('funcoes').select('nome').eq('id', perfil.funcao_id).maybeSingle());
  return { ...base, label: funcao?.nome || perfil.funcao_id, role: perfil.funcao_id, areas: [...areas] };
}
