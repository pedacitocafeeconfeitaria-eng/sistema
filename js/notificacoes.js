// Central de avisos: conta o que é novo, escuta em tempo real e mostra um alerta na tela.
import { sb } from './api.js';
import { h, icon } from './ui.js';

const ouvintes = new Set();
let naoLidas = 0; let lidoAte = null; let canal = null; let userId = null;
const avisar = () => ouvintes.forEach((f) => f(naoLidas));

export const MODULOS = { producao: 'Produção', desperdicio: 'Desperdício', balcao: 'Balcão', estoque: 'Estoque', compras: 'Compras', notas: 'Notas fiscais',
  financeiro: 'Financeiro', rh: 'Pessoas', denuncias: 'Denúncias', config: 'Sistema', encomendas: 'Encomendas', tarefas: 'Tarefas' };

export async function iniciarNotificacoes() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || userId === session.user.id) return;
  userId = session.user.id;
  const { data } = await sb.from('atividades_leitura').select('lido_ate').eq('user_id', userId).maybeSingle();
  if (!data) {
    lidoAte = new Date(Date.now() - 24 * 3600e3).toISOString();
    await sb.from('atividades_leitura').upsert({ user_id: userId, lido_ate: lidoAte });
  } else lidoAte = data.lido_ate;
  await recontar();
  canal?.unsubscribe();
  canal = sb.channel('atividades-ao-vivo')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'atividades' }, ({ new: a }) => { naoLidas += 1; avisar(); alertaNaTela(a); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'atividades' }, () => recontar())
    .subscribe();
}

export async function recontar() {
  if (!lidoAte) return;
  const { count } = await sb.from('atividades').select('id', { count: 'exact', head: true }).gt('criado_em', lidoAte);
  naoLidas = count || 0; avisar();
}

export async function marcarLidas() {
  if (!userId) return;
  lidoAte = new Date().toISOString();
  await sb.from('atividades_leitura').upsert({ user_id: userId, lido_ate: lidoAte });
  naoLidas = 0; avisar();
}
export const ultimaLeitura = () => lidoAte;

export function pararNotificacoes() { canal?.unsubscribe(); canal = null; userId = null; naoLidas = 0; lidoAte = null; avisar(); }

export const limparSinos = () => ouvintes.clear();

// Sino com contador (pode haver mais de um na tela: barra lateral e celular)
export function sino({ claro = false } = {}) {
  const num = h('span', { class: 'sino-num' });
  const el = h('a', { class: `sino${claro ? ' claro' : ''}`, href: '/gestao/atividades', 'data-link': true, title: 'Atividades e avisos' }, icon('bell'), num);
  const f = (n) => { num.textContent = n > 99 ? '99+' : String(n); num.style.display = n ? '' : 'none'; };
  ouvintes.add(f); f(naoLidas);
  return el;
}

function alertaNaTela(a) {
  const cor = { alerta: 'danger', atencao: 'warn' }[a.nivel] || '';
  const caixa = h('a', { class: `aviso-flutuante ${cor}`, href: a.link || '/gestao/atividades', 'data-link': true },
    h('div', { class: 'aviso-mod' }, `${MODULOS[a.modulo] || a.modulo}${a.loja ? ` · ${a.loja === 'VILLA' ? 'Villa' : 'Souza Cruz'}` : ''}`),
    h('b', {}, a.titulo), a.detalhe ? h('div', { class: 'aviso-det' }, a.detalhe) : null, a.autor ? h('div', { class: 'aviso-mod' }, `por ${a.autor}`) : null);
  let pilha = document.querySelector('.avisos-pilha');
  if (!pilha) { pilha = h('div', { class: 'avisos-pilha' }); document.body.append(pilha); }
  pilha.prepend(caixa);
  setTimeout(() => caixa.remove(), 9000);
  caixa.addEventListener('click', () => caixa.remove());
  // Notificação do aparelho quando o app está em segundo plano
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration().then((reg) => {
        const op = { body: [a.detalhe, a.autor && `por ${a.autor}`].filter(Boolean).join('\n'), icon: 'img/icon-192.png', badge: 'img/icon-192.png', tag: `atv-${a.id}`, data: { link: a.link } };
        if (reg) reg.showNotification(a.titulo, op); else new Notification(a.titulo, op);
      });
    }
  } catch { /* sem suporte */ }
}
