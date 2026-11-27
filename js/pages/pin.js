// Tela do PIN pessoal: o colaborador escolhe a loja, o nome e digita o PIN.
// A identificação vale neste aparelho até as 4h do dia seguinte (ou até tocar em "Trocar pessoa").
import { api } from '../api.js';
import { h, brand, field, input, select, alertBox } from '../ui.js';
import { LOJAS, lembrar } from './_public.js';

const PULO_KEY = 'pedacito_pin_pulado';
export const pinPuladoHoje = () => { try { return localStorage.getItem(PULO_KEY) === new Date().toDateString(); } catch { return false; } };

export function render(root, { onOk, exigirPin }) {
  const mem = lembrar.get();
  const st = { loja: LOJAS.includes(mem.loja) ? mem.loja : '', func: mem.funcionario_id ? String(mem.funcionario_id) : '' };
  const err = h('div');
  const loja = select([{ value: '', label: 'Selecione' }, ...LOJAS.map((l) => ({ value: l, label: l }))], { onChange: (e) => { st.loja = e.target.value; st.func = ''; carregar(); } });
  const pessoa = select([{ value: '', label: 'Escolha a loja primeiro' }], { onChange: (e) => { st.func = e.target.value; if (st.func) pin.focus(); } });
  const pin = input({ type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, autocomplete: 'off', placeholder: '••••', style: { fontSize: '24px', textAlign: 'center', letterSpacing: '8px' } });
  const btn = h('button', { class: 'btn block', type: 'submit' }, 'Entrar');

  async function carregar() {
    loja.value = st.loja;
    if (!st.loja) { pessoa.replaceChildren(h('option', { value: '' }, 'Escolha a loja primeiro')); return; }
    pessoa.replaceChildren(h('option', { value: '' }, 'Carregando...'));
    try {
      const equipe = await api.get(`/api/public/equipe?loja=${encodeURIComponent(st.loja)}`);
      pessoa.replaceChildren(h('option', { value: '' }, 'Escolha seu nome'), ...equipe.map((p) => h('option', { value: String(p.id) }, p.nome)));
      if (!equipe.some((p) => String(p.id) === st.func)) st.func = '';
      pessoa.value = st.func;
    } catch (e) { err.replaceChildren(alertBox(e.message)); }
  }

  const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
    e.preventDefault(); err.replaceChildren();
    if (!st.func) return err.append(alertBox('Escolha seu nome.'));
    if (!/^[0-9]{4,6}$/.test(pin.value)) return err.append(alertBox('Digite seu PIN (4 a 6 números).'));
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      await api.post('/api/public/entrar', { funcionario_id: st.func, pin: pin.value });
      lembrar.set({ loja: st.loja, funcionario_id: st.func });
      onOk();
    } catch (ex) { err.append(alertBox(ex.message)); pin.value = ''; pin.focus(); btn.disabled = false; btn.textContent = 'Entrar'; }
  } }, field('Loja', loja), field('Seu nome', pessoa), field('Seu PIN', pin), err, btn);

  root.append(h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' },
    h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '18px' } }, brand({ light: false })),
    h('h1', { style: { fontSize: '21px', textAlign: 'center' } }, 'Quem está usando?'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: '6px 0 22px', fontSize: '14px' } }, 'Escolha seu nome e digite seu PIN. Vale neste aparelho até o fim do dia.'),
    form,
    !exigirPin ? h('p', { style: { textAlign: 'center', marginTop: '16px' } }, h('button', { class: 'link-btn muted', style: { fontSize: '13px', textDecoration: 'underline' }, onClick: () => {
      try { localStorage.setItem(PULO_KEY, new Date().toDateString()); } catch { /* sem armazenamento */ }
      onOk();
    } }, 'Ainda não tenho PIN — continuar sem')) : null,
    h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '12px', marginTop: '14px' } }, 'Esqueceu o PIN? Fale com a gestão.'))));
  carregar();
}
