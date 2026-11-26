// Tela do código de acesso da equipe (só aparece fora da rede da loja).
import { api } from '../api.js';
import { h, brand, field, input, alertBox } from '../ui.js';

export function render(root, { onOk }) {
  const err = h('div');
  const cod = input({ inputMode: 'numeric', autocomplete: 'one-time-code', placeholder: '••••••', style: { fontSize: '22px', textAlign: 'center', letterSpacing: '6px' }, required: true });
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Entrar');
  root.append(h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' },
    h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '18px' } }, brand({ light: false })),
    h('h1', { style: { fontSize: '21px', textAlign: 'center' } }, 'Código da equipe'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: '6px 0 22px', fontSize: '14px' } }, 'Digite o código que a gestão passou. Ele fica lembrado neste aparelho.'),
    h('form', { class: 'form-stack', onSubmit: async (e) => {
      e.preventDefault();
      err.replaceChildren();
      btn.disabled = true;
      try {
        await api.post('/api/public/acesso', { codigo: cod.value });
        onOk();
      } catch (ex) {
        err.append(alertBox(ex.message));
        btn.disabled = false;
      }
    } }, field('Código', cod), err, btn),
    h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '12px', marginTop: '18px' } }, 'Gestão? ', h('a', { href: '/login', 'data-link': true }, 'Entrar com usuário e senha')))));
  cod.focus();
}
