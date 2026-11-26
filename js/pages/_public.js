// Moldura comum dos formulários públicos.
import { h, brand, icon } from '../ui.js';

export function publicLayout(root, { title, subtitle }) {
  const body = h('div', { class: 'public-body' });
  root.append(h('div', { class: 'public' },
    h('header', { class: 'public-hero' }, h('div', { class: 'inner' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        brand(), h('a', { class: 'back', href: '/', 'data-link': true }, '← Início')),
      h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null)),
    body));
  return body;
}

export function successCard(title, text, onNew, extra) {
  return h('div', { class: 'card' }, h('div', { class: 'success-box' },
    h('div', { class: 'success-icon' }, icon('check')),
    h('h2', { style: { fontSize: '22px' } }, title),
    text ? h('p', { class: 'muted', style: { margin: 0, maxWidth: '440px' } }, text) : null,
    extra || null,
    h('button', { class: 'btn', onClick: onNew, style: { marginTop: '8px' } }, 'Novo registro')));
}

export const LOJAS = ['Villa Schlosser', 'Souza Cruz'];
export const TURNOS = ['Manhã', 'Tarde'];
export const TIPOS = ['Doce', 'Salgado', 'Bebida', 'Bolo Inteiro', 'Cuca Inteira'];

// Lembra o nome e a loja de quem preencheu por último neste aparelho.
export const lembrar = {
  get: () => { try { return JSON.parse(localStorage.getItem('pedacito.form') || '{}'); } catch { return {}; } },
  set: (o) => { try { localStorage.setItem('pedacito.form', JSON.stringify({ ...lembrar.get(), ...o })); } catch { /* sem espaço */ } },
};
