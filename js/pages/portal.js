// Início: atalhos para os formulários das lojas e para a gestão.
import { h, brand, icon } from '../ui.js';
import { quemBar, nomeSessao } from './_public.js';

const CARDS = [
  { href: '/tarefas', icon: 'check', title: 'Minhas tarefas', text: 'As tarefas do dia que o líder passou para você. Marque quando terminar.' },
  { href: '/cozinha', icon: 'chef', title: 'Cozinha', text: 'Registro de produção e de desperdício da cozinha.' },
  { href: '/balcao', icon: 'clipboard', title: 'Relatório do balcão', text: 'Problemas com produtos, observações do dia e falta de estoque.' },
  { href: '/encomenda', icon: 'cake', title: 'Encomendas', text: 'Bolos decorados e eventos: anotar pedido, comprovante e agenda da cozinha.' },
  { href: '/movimentacao', icon: 'arrows', title: 'Movimentação de estoque', text: 'Entradas (compras) e saídas de insumos.' },
  { href: '/contagem', icon: 'box', title: 'Contagem de estoque', text: 'Contar o que tem na loja e acertar o saldo do sistema.' },
  { href: '/lista', icon: 'cart', title: 'Lista de compras', text: 'Lista compartilhada entre as lojas.' },
  { href: '/denuncia', icon: 'shield', title: 'Canal de denúncias', text: 'Espaço seguro e confidencial, com anonimato opcional.' },
  { href: '/gestao', icon: 'lock', title: 'Área de gestão', text: 'Painel financeiro, operação, estoque e cadastros (login).' },
];

export function render(root) {
  root.append(
    h('header', { class: 'portal-hero' }, h('div', { class: 'inner' },
      h('div', {}, brand(), h('h1', {}, nomeSessao() ? `Olá, ${nomeSessao().split(' ')[0]}!` : 'Olá, equipe Pedacito!'), h('p', { style: { opacity: 0.88, margin: '6px 0 0' } }, 'Escolha o que você quer registrar.'), quemBar()))),
    h('div', { class: 'portal' }, h('div', { class: 'portal-grid' }, CARDS.map((c) =>
      h('a', { class: 'portal-card', href: c.href, 'data-link': true },
        h('div', { class: 'portal-icon', style: c.href === '/gestao' ? { background: 'var(--sage-100)', color: 'var(--sage-700)' } : {} }, icon(c.icon)),
        h('h3', {}, c.title), h('p', {}, c.text))))));
}
