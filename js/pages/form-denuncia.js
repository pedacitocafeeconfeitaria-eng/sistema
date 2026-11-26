// Canal confidencial de denúncias (substitui denunciapedacito.lovable.app).
import { api } from '../api.js';
import { h, card, field, input, select, textarea, radios, toast, alertBox, icon, hojeISO } from '../ui.js';
import { publicLayout, successCard } from './_public.js';

export async function render(root) {
  const body = publicLayout(root, { title: 'Canal Confidencial de Denúncias', subtitle: 'Um espaço seguro para registrar situações de assédio moral. Sua voz é ouvida com respeito, sigilo e responsabilidade.' });
  const inicial = () => ({ tipo: '', categoria: '', descricao: '', envolvidos: '', data: '', anonimo: 'sim', nome: '', contato: '' });
  let st = inicial();
  const content = h('div', { class: 'form-stack' });
  body.append(content,
    h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '12.5px' } }, 'Em caso de risco imediato à integridade física, procure imediatamente as autoridades competentes. Este canal é destinado ao registro interno de denúncias relacionadas ao ambiente de trabalho.'));

  function draw() {
    const cat = select([{ value: '', label: 'Selecione a categoria' }, 'Humilhação', 'Exposição', 'Pressão excessiva', 'Outro'], { onChange: (e) => (st.categoria = e.target.value) });
    cat.value = st.categoria;
    const contador = h('div', { class: 'muted', style: { fontSize: '12px', textAlign: 'right' } }, `${st.descricao.length}/3000`);
    const err = h('div');
    const btn = h('button', { class: 'btn block', type: 'button', onClick: async () => {
      err.replaceChildren();
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      try {
        const r = await api.post('/api/public/denuncia', st);
        const identificado = st.anonimo === 'nao';
        st = inicial();
        content.replaceChildren(successCard('Denúncia registrada com sucesso',
          `Sua denúncia foi recebida e será tratada com total confidencialidade.${identificado ? ' Caso necessário, entraremos em contato pelos dados informados.' : ''}`,
          draw,
          h('div', { class: 'card', style: { boxShadow: 'none', background: 'var(--sage-50)', width: '100%', maxWidth: '420px' } },
            h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Protocolo'),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
              h('span', { class: 'protocol' }, r.protocolo),
              h('button', { class: 'btn ghost small', onClick: () => { navigator.clipboard?.writeText(r.protocolo); toast('Protocolo copiado', 'ok'); } }, icon('copy'), 'Copiar')),
            h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Guarde este protocolo para acompanhamento futuro.'))));
      } catch (e) {
        err.append(alertBox(e.message));
        btn.disabled = false;
        btn.textContent = 'Enviar denúncia com segurança';
      }
    } }, icon('shield'), 'Enviar denúncia com segurança');

    content.replaceChildren(card({}, h('div', { class: 'form-stack', style: { gap: '20px' } },
      h('div', { class: 'radio-row' }, ['Tratamento confidencial', 'Anonimato opcional', 'Protocolo único'].map((t) => h('span', { class: 'badge' }, '✓ ', t))),
      field('Tipo de assédio *', radios('tipo', [{ value: 'Vertical', label: 'Vertical — liderança → funcionário' }, { value: 'Horizontal', label: 'Horizontal — entre colegas' }], st.tipo, (v) => (st.tipo = v))),
      field('Categoria *', cat),
      h('div', { class: 'field' }, h('span', {}, 'Descrição do ocorrido *'),
        textarea({ rows: 6, maxLength: 3000, value: st.descricao, placeholder: 'Descreva o que aconteceu com o máximo de detalhes que se sentir confortável...', onInput: (e) => { st.descricao = e.target.value; contador.textContent = `${st.descricao.length}/3000`; } }), contador),
      h('div', { class: 'form-row' },
        field('Pessoas envolvidas', input({ value: st.envolvidos, maxLength: 300, placeholder: 'Nomes ou cargos (opcional)', onInput: (e) => (st.envolvidos = e.target.value) })),
        field('Data do ocorrido *', input({ type: 'date', value: st.data, max: hojeISO(), onChange: (e) => (st.data = e.target.value) }))),
      h('div', { class: 'item-card', style: { background: 'var(--sage-50)', borderStyle: 'solid' } },
        h('b', {}, 'Deseja se identificar?'),
        radios('anon', [{ value: 'sim', label: 'Não, denúncia anônima' }, { value: 'nao', label: 'Sim, quero me identificar' }], st.anonimo, (v) => { st.anonimo = v; draw(); }),
        st.anonimo === 'nao' ? h('div', { class: 'form-row' },
          field('Nome *', input({ value: st.nome, maxLength: 120, onInput: (e) => (st.nome = e.target.value) })),
          field('Contato (WhatsApp ou e-mail) *', input({ value: st.contato, maxLength: 160, onInput: (e) => (st.contato = e.target.value) }))) : null),
      err, btn)));
  }
  draw();
}
