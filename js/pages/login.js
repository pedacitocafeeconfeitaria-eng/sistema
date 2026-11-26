// Login da gestão (Supabase Auth). A primeira conta criada vira Administrador;
// as próximas ficam aguardando o administrador liberar em Configurações.
import { sb } from '../api.js';
import { h, brand, field, input, alertBox } from '../ui.js';
import { refreshSession, rotaQuery } from '../app.js';

export async function render(root, { navigate }) {
  const next = rotaQuery().get('next') || '/gestao';
  let modo = 'entrar'; // entrar | criar | esqueci
  const card = h('div', { class: 'login-card' });
  root.append(h('div', { class: 'login-wrap' }, card));

  function desenhar() {
    const err = h('div');
    const nome = input({ autocomplete: 'name', placeholder: 'Seu nome', required: modo === 'criar' });
    const email = input({ type: 'email', autocomplete: 'email', placeholder: 'seu@email.com', required: true });
    const pass = input({ type: 'password', autocomplete: modo === 'criar' ? 'new-password' : 'current-password', placeholder: '••••••••', required: modo !== 'esqueci', minLength: 8 });
    const btn = h('button', { class: 'btn block', type: 'submit' }, { entrar: 'Entrar', criar: 'Criar conta', esqueci: 'Enviar link' }[modo]);

    const form = h('form', { class: 'form-stack', onSubmit: async (e) => {
      e.preventDefault();
      err.replaceChildren();
      btn.disabled = true;
      try {
        if (modo === 'entrar') {
          const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (error) throw new Error(/Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : /not confirmed/i.test(error.message) ? 'Confirme seu e-mail pelo link que enviamos antes de entrar.' : error.message);
          await refreshSession();
          navigate(next.startsWith('/gestao') ? next : '/gestao', true);
        } else if (modo === 'criar') {
          const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value,
            options: { data: { nome: nome.value.trim() }, emailRedirectTo: location.origin + location.pathname + '#/gestao' } });
          if (error) throw error;
          if (data.session) { await refreshSession(); navigate('/gestao', true); return; }
          card.replaceChildren(h('h1', { style: { fontSize: '21px', textAlign: 'center' } }, 'Confira seu e-mail'),
            h('p', { class: 'muted', style: { textAlign: 'center', margin: '10px 0' } }, `Enviamos um link de confirmação para ${email.value.trim()}. Depois de confirmar, volte e entre com sua senha.`),
            h('button', { class: 'btn block', onClick: () => { modo = 'entrar'; desenhar(); } }, 'Voltar para o login'));
          return;
        } else {
          const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname + '#/gestao/config' });
          if (error) throw error;
          err.append(alertBox('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.', 'ok'));
        }
      } catch (ex) {
        err.append(alertBox(ex.message));
      }
      btn.disabled = false;
    } },
    modo === 'criar' ? field('Nome', nome) : null,
    field('E-mail', email),
    modo !== 'esqueci' ? field(modo === 'criar' ? 'Crie uma senha (mín. 8 caracteres)' : 'Senha', pass) : null,
    err, btn);

    const link = (txt, m) => h('a', { href: '#', onClick: (e) => { e.preventDefault(); modo = m; desenhar(); } }, txt);
    card.replaceChildren(
      h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '18px' } }, brand({ light: false })),
      h('h1', { style: { fontSize: '21px', textAlign: 'center' } }, { entrar: 'Painel de Gestão', criar: 'Criar conta', esqueci: 'Esqueci a senha' }[modo]),
      h('p', { class: 'muted', style: { textAlign: 'center', margin: '6px 0 22px', fontSize: '14px' } },
        modo === 'criar' ? 'Depois de criar, o administrador libera o que você pode acessar.' : 'Área restrita. Faça login para continuar.'),
      form,
      h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '13px', marginTop: '18px', display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' } },
        modo !== 'entrar' ? link('Já tenho conta', 'entrar') : link('Criar conta', 'criar'),
        modo === 'entrar' ? link('Esqueci a senha', 'esqueci') : null,
        h('a', { href: '/', 'data-link': true }, 'Voltar ao início')));
    (modo === 'criar' ? nome : email).focus();
  }
  desenhar();
}
