// Configurações: código da equipe, funções (o que cada cargo vê/edita), usuários e senha.
import { sb } from '../api.js';
import { h, card, field, input, select, table, toast, loading, alertBox, icon } from '../ui.js';
import { pageHeader } from './_painel.js';

export const MODULOS = [
  ['dashboard', 'Dashboard'], ['estoque', 'Estoque'], ['desperdicio', 'Desperdício'], ['producao', 'Produção'],
  ['balcao', 'Relatório do balcão'], ['compras', 'Compras e lista'], ['notas', 'Notas fiscais'], ['cadastros', 'Cadastros'],
  ['fichas', 'Fichas técnicas'], ['encomendas', 'Encomendas e eventos'], ['faturamento', 'Faturamento'],
  ['financeiro', 'Financeiro'], ['rh', 'Gestão de pessoas'], ['contratos', 'Contratos'], ['denuncias', 'Denúncias'], ['config', 'Configurações'],
];

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export async function render(main, { session }) {
  pageHeader(main, { title: 'Configurações', sub: 'Acessos da equipe, funções e usuários' });
  const area = h('div', {}, loading('Carregando...'));
  main.append(area);
  const admin = session.user.role === 'admin';

  async function carregar() {
    area.replaceChildren(loading('Carregando...'));
    try {
      const blocos = [];
      if (admin) {
        const [cfg, funcoes, perms, perfis, pend] = await Promise.all([
          sb.from('config').select('*').eq('chave', 'codigo_equipe').maybeSingle().then(ok),
          sb.from('funcoes').select('*').order('nome').then(ok),
          sb.from('funcao_permissoes').select('*').then(ok),
          sb.from('perfis').select('*').order('nome').then(ok),
          sb.rpc('usuarios_pendentes').then(ok),
        ]);
        blocos.push(blocoCodigo(cfg?.valor || ''), blocoPendentes(pend, funcoes), blocoUsuarios(perfis, funcoes, session), blocoFuncoes(funcoes, perms));
      }
      blocos.push(blocoSenha());
      area.replaceChildren(h('div', { class: 'form-stack', style: { gap: '16px', maxWidth: '980px' } }, blocos));
    } catch (e) { area.replaceChildren(alertBox(e.message)); }
  }

  function blocoCodigo(atual) {
    const code = input({ value: atual, inputMode: 'numeric', style: { maxWidth: '200px' } });
    const link = `${location.origin}${location.pathname}#/`;
    return card({ title: 'Código da equipe', desc: 'Pedido uma vez em cada celular para usar os formulários (cozinha, balcão, estoque, lista). O canal de denúncias não pede código.' },
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap' } },
        field('Código atual', code),
        h('button', { class: 'btn', onClick: async () => {
          if (!/^[A-Za-z0-9]{4,20}$/.test(code.value.trim())) return toast('Use de 4 a 20 letras ou números.', 'error');
          try { ok(await sb.from('config').update({ valor: code.value.trim() }).eq('chave', 'codigo_equipe')); toast('Código salvo. Os celulares vão pedir o novo código.', 'ok'); } catch (e) { toast(e.message, 'error'); }
        } }, 'Salvar código')),
      h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '13.5px' } }, 'Link para a equipe: ', h('b', {}, link)));
  }

  function blocoPendentes(pend, funcoes) {
    if (!pend.length) return card({ title: 'Novos usuários', desc: 'Quem criar conta em "Criar conta" aparece aqui para você liberar.' }, h('div', { class: 'empty' }, 'Nenhum pedido de acesso no momento.'));
    const outras = funcoes.filter((f) => f.id !== 'admin');
    return card({ title: 'Novos usuários aguardando liberação', desc: 'Escolha a função de cada pessoa.' },
      pend.map((u) => {
        const nome = input({ value: u.email.split('@')[0], placeholder: 'Nome' });
        const fun = select([{ value: '', label: 'Escolha a função' }, ...funcoes.map((f) => ({ value: f.id, label: f.nome }))]);
        return h('div', { style: { display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr auto', gap: '10px', alignItems: 'end', padding: '8px 0', borderBottom: '1px solid #efeadf' } },
          h('div', {}, h('b', {}, u.email), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `Criou em ${new Date(u.criado_em).toLocaleDateString('pt-BR')}`)),
          field('Nome', nome), field('Função', fun),
          h('button', { class: 'btn', onClick: async () => {
            if (!fun.value) return toast(outras.length ? 'Escolha a função.' : 'Crie uma função primeiro (logo abaixo).', 'error');
            try { ok(await sb.from('perfis').insert({ user_id: u.user_id, email: u.email, nome: nome.value.trim() || u.email, funcao_id: fun.value })); toast('Acesso liberado.', 'ok'); carregar(); } catch (e) { toast(e.message, 'error'); }
          } }, 'Liberar'));
      }));
  }

  function blocoUsuarios(perfis, funcoes, sess) {
    const nomeF = new Map(funcoes.map((f) => [f.id, f.nome]));
    return card({ title: 'Usuários com acesso' }, table([
      { label: 'Nome', key: 'nome' }, { label: 'E-mail', key: 'email' },
      { label: 'Função', render: (p) => {
        if (p.email === sess.user.email) return nomeF.get(p.funcao_id);
        const s = select(funcoes.map((f) => ({ value: f.id, label: f.nome })), { onChange: async (e) => {
          try { ok(await sb.from('perfis').update({ funcao_id: e.target.value }).eq('user_id', p.user_id)); toast('Função alterada.', 'ok'); } catch (ex) { toast(ex.message, 'error'); }
        } });
        s.value = p.funcao_id; return s;
      } },
      { label: 'Situação', render: (p) => (p.email === sess.user.email ? h('span', { class: 'muted' }, 'você') : h('button', { class: `btn small ${p.ativo ? 'danger-text' : ''}`, onClick: async () => {
        try { ok(await sb.from('perfis').update({ ativo: !p.ativo }).eq('user_id', p.user_id)); toast(p.ativo ? 'Acesso bloqueado.' : 'Acesso reativado.', 'ok'); carregar(); } catch (e) { toast(e.message, 'error'); }
      } }, p.ativo ? 'Bloquear' : 'Reativar')) },
    ], perfis, { maxHeight: false }));
  }

  function blocoFuncoes(funcoes, perms) {
    const editaveis = funcoes.filter((f) => f.id !== 'admin');
    const nova = input({ placeholder: 'Ex.: Líder, Produção, Atendimento' });
    const lista = editaveis.map((f) => {
      const minhas = new Map(perms.filter((p) => p.funcao_id === f.id).map((p) => [p.modulo, p]));
      const linhas = MODULOS.map(([mod, label]) => {
        const p = minhas.get(mod);
        const nivel = select([{ value: '', label: 'Sem acesso' }, { value: 'ver', label: 'Só ver' }, { value: 'editar', label: 'Ver e editar' }], { onChange: async (e) => {
          try {
            if (!e.target.value) ok(await sb.from('funcao_permissoes').delete().eq('funcao_id', f.id).eq('modulo', mod));
            else ok(await sb.from('funcao_permissoes').upsert({ funcao_id: f.id, modulo: mod, ver: true, editar: e.target.value === 'editar' }));
            toast(`${f.nome}: ${label} atualizado.`, 'ok');
          } catch (ex) { toast(ex.message, 'error'); }
        } });
        nivel.value = p ? (p.editar ? 'editar' : 'ver') : '';
        return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '4px 0' } }, h('span', {}, label), h('div', { style: { width: '160px' } }, nivel));
      });
      return h('details', { class: 'card', style: { padding: '12px 16px' } },
        h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, f.nome, h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '8px' } }, `${minhas.size} módulo(s)`)),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: '28px', marginTop: '10px' } }, linhas),
        h('button', { class: 'btn small danger-text', style: { marginTop: '10px' }, onClick: async () => {
          if (!confirmar(`Excluir a função ${f.nome}?`)) return;
          try { ok(await sb.from('funcoes').delete().eq('id', f.id)); toast('Função excluída.', 'ok'); carregar(); } catch (e) { toast(/foreign|violates/.test(e.message) ? 'Há usuários com essa função. Troque a função deles antes.' : e.message, 'error'); }
        } }, icon('trash'), 'Excluir função'));
    });
    return card({ title: 'Funções e permissões', desc: 'O Administrador vê tudo. Para os demais, defina módulo por módulo o que a função pode ver e editar.' },
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'end', marginBottom: '14px' } },
        field('Nova função', nova),
        h('button', { class: 'btn', onClick: async () => {
          const nome = nova.value.trim(); if (!nome) return;
          const id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
          try { ok(await sb.from('funcoes').insert({ id, nome })); toast('Função criada. Agora marque os acessos.', 'ok'); carregar(); } catch (e) { toast(/duplicate/.test(e.message) ? 'Já existe uma função com esse nome.' : e.message, 'error'); }
        } }, icon('plus'), 'Criar')),
      lista.length ? h('div', { class: 'form-stack', style: { gap: '10px' } }, lista) : h('div', { class: 'empty' }, 'Nenhuma função criada ainda.'));
  }

  function blocoSenha() {
    const nova = input({ type: 'password', autocomplete: 'new-password', minLength: 8 });
    const nova2 = input({ type: 'password', autocomplete: 'new-password', minLength: 8 });
    return card({ title: 'Minha senha' },
      h('div', { class: 'form-row' }, field('Nova senha (mín. 8)', nova), field('Repita', nova2)),
      h('button', { class: 'btn', style: { marginTop: '8px' }, onClick: async () => {
        if (nova.value.length < 8) return toast('A senha precisa ter 8 caracteres ou mais.', 'error');
        if (nova.value !== nova2.value) return toast('As senhas não conferem.', 'error');
        const { error } = await sb.auth.updateUser({ password: nova.value });
        if (error) return toast(error.message, 'error');
        nova.value = ''; nova2.value = ''; toast('Senha alterada.', 'ok');
      } }, 'Alterar senha'));
  }

  carregar();
}

// Confirmação sem janela do navegador (não trava a tela).
function confirmar(msg) { return window.__confirmOk === msg ? (window.__confirmOk = null, true) : (window.__confirmOk = msg, toast(`${msg} Clique de novo para confirmar.`, 'warn'), false); }
