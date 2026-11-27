// Tela do PIN pessoal: o colaborador digita só o PIN e o sistema já sabe quem é.
// A identificação vale neste aparelho até as 4h do dia seguinte (ou até tocar em "Trocar pessoa").
import { api } from '../api.js';
import { h, brand, input, alertBox } from '../ui.js';

const PULO_KEY = 'pedacito_pin_pulado';
export const pinPuladoHoje = () => { try { return localStorage.getItem(PULO_KEY) === new Date().toDateString(); } catch { return false; } };

export function render(root, { onOk, exigirPin }) {
  const err = h('div');
  const pin = input({ type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, autocomplete: 'off', placeholder: '••••',
    'aria-label': 'Seu PIN', style: { fontSize: '28px', textAlign: 'center', letterSpacing: '10px' } });
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Entrar');

  const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    if (!/^[0-9]{4,6}$/.test(pin.value)) return err.append(alertBox('Digite seu PIN (4 a 6 números).'));
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      await api.post('/api/public/entrar', { pin: pin.value });
      onOk();
    } catch (ex) { err.append(alertBox(ex.message)); pin.value = ''; pin.focus(); btn.disabled = false; btn.textContent = 'Entrar'; }
  } }, pin, err, btn);

  root.append(h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' },
    h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '18px' } }, brand({ light: false })),
    h('h1', { style: { fontSize: '21px', textAlign: 'center' } }, 'Digite seu PIN'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: '6px 0 22px', fontSize: '14px' } }, 'O sistema reconhece você pelo PIN. Vale neste aparelho até o fim do dia.'),
    form,
    !exigirPin ? h('p', { style: { textAlign: 'center', marginTop: '16px' } }, h('button', { class: 'link-btn muted', style: { fontSize: '13px', textDecoration: 'underline' }, onClick: () => {
      try { localStorage.setItem(PULO_KEY, new Date().toDateString()); } catch { /* sem armazenamento */ }
      onOk();
    } }, 'Ainda não tenho PIN — continuar sem')) : null,
    h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '12px', marginTop: '14px' } }, 'Esqueceu o PIN? Fale com a gestão.'))));
  pin.focus();
}
