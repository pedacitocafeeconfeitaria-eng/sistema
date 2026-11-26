// Utilidades de encomendas: status, comprovante do cliente, relatório da cozinha e WhatsApp.
import { brl, dataBR, diaSemana } from '../ui.js';

export const STATUS = { ORCAMENTO: 'Orçamento', CONFIRMADO: 'Confirmado', EM_PRODUCAO: 'Em produção', PRONTO: 'Pronto', ENTREGUE: 'Entregue', CANCELADO: 'Cancelado' };
export const TIPO = { BOLO: 'Bolo decorado', EVENTO: 'Evento', OUTRO: 'Outro' };
const LOJA = { VILLA: 'Pedacito Villa Schlosser', SOUZA_CRUZ: 'Pedacito Souza Cruz' };
const lojaNome = (l) => LOJA[l] || (/souza/i.test(l || '') ? LOJA.SOUZA_CRUZ : LOJA.VILLA);
const ROTULO = { tamanho: 'Tamanho', massa: 'Massa', recheio: 'Recheio', cobertura: 'Cobertura', tema: 'Tema / decoração', escrita: 'Escrita' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qtd = (q) => String(Number(q)).replace('.', ',');

export function linkWhats(fone, texto) {
  let n = String(fone || '').replace(/\D/g, '');
  if (n.length <= 11) n = `55${n}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

export function textoCliente(e) {
  const itens = (e.itens || []).map((i) => `• ${qtd(i.quantidade)}x ${i.descricao}`).join('\n');
  const det = Object.entries(e.detalhes || {}).filter(([, v]) => v).map(([k, v]) => `${ROTULO[k] || k}: ${v}`).join('\n');
  const falta = Math.max((Number(e.total) || 0) - (Number(e.sinal) || 0), 0);
  return [`Olá, ${e.cliente_nome}! Aqui é da ${lojaNome(e.loja)} 🧁`, `Sua encomenda *${e.numero}* está registrada:`, '',
    itens, det ? `\n${det}` : '', '',
    `📅 ${e.entrega_tipo === 'ENTREGA' ? 'Entrega' : 'Retirada'}: ${diaSemana(e.data_entrega)}, ${dataBR(e.data_entrega)}${e.hora_entrega ? ` às ${e.hora_entrega}` : ''}`,
    e.entrega_tipo === 'ENTREGA' && e.endereco ? `📍 ${e.endereco}` : '',
    Number(e.total) ? `💰 Total ${brl(e.total)} · sinal ${brl(e.sinal)} · falta ${brl(falta)}` : '',
    '', 'Obrigado pela preferência!'].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}

function janela(titulo, corpo) {
  const w = window.open('', '_blank');
  if (!w) { alert('Libere as janelas pop-up para imprimir.'); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:Nunito,Arial,sans-serif;color:#2f3a32;margin:24px;max-width:760px}h1{font-family:'Lilita One',Arial;color:#ff6b73;margin:0 0 4px;font-weight:400}
.muted{color:#6b756d;font-size:13px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{padding:6px 8px;border-bottom:1px solid #e5e9e5;text-align:left;font-size:14px}
th{background:#f3f5f3}.r{text-align:right}.box{border:1px solid #dfe5df;border-radius:10px;padding:12px 14px;margin:10px 0}.dia{background:#2f3a32;color:#fff;padding:6px 10px;border-radius:8px;margin-top:18px}
.enc{border:1px solid #cfd6cf;border-radius:10px;padding:10px 12px;margin:8px 0;page-break-inside:avoid}.obs{color:#c2410c;font-weight:700}
.tot td{font-weight:800}@media print{button{display:none}body{margin:10mm}}</style></head><body>${corpo}
<p><button onclick="print()">Imprimir / salvar PDF</button></p></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

export function comprovante(e) {
  const falta = Math.max((Number(e.total) || 0) - (Number(e.sinal) || 0), 0);
  const det = Object.entries(e.detalhes || {}).filter(([, v]) => v);
  janela(`Encomenda ${e.numero}`, `
    <h1>Pedacito Café e Confeitaria</h1><div class="muted">${esc(lojaNome(e.loja))}</div>
    <h2 style="margin:18px 0 4px">Encomenda ${esc(e.numero)} · ${esc(TIPO[e.tipo] || '')}</h2>
    <div class="box"><b>Cliente:</b> ${esc(e.cliente_nome)}${e.cliente_fone ? ` · ${esc(e.cliente_fone)}` : ''}<br>
    <b>${e.entrega_tipo === 'ENTREGA' ? 'Entrega' : 'Retirada'}:</b> ${esc(diaSemana(e.data_entrega))}, ${esc(dataBR(e.data_entrega))}${e.hora_entrega ? ` às ${esc(e.hora_entrega)}` : ''}
    ${e.entrega_tipo === 'ENTREGA' && e.endereco ? `<br><b>Endereço:</b> ${esc(e.endereco)}` : ''}</div>
    ${det.length ? `<div class="box">${det.map(([k, v]) => `<b>${esc(ROTULO[k] || k)}:</b> ${esc(v)}`).join('<br>')}</div>` : ''}
    <table><tr><th>Item</th><th class="r">Qtd</th><th class="r">Preço</th><th class="r">Subtotal</th></tr>
    ${(e.itens || []).map((i) => `<tr><td>${esc(i.descricao)}</td><td class="r">${qtd(i.quantidade)}</td><td class="r">${brl(i.preco_unit)}</td><td class="r">${brl(i.quantidade * i.preco_unit)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3" class="r">Total</td><td class="r">${brl(e.total)}</td></tr>
    <tr><td colspan="3" class="r">Sinal pago</td><td class="r">${brl(e.sinal)}</td></tr>
    <tr class="tot"><td colspan="3" class="r">Falta pagar</td><td class="r">${brl(falta)}</td></tr></table>
    ${e.observacao ? `<div class="box"><b>Observações:</b> ${esc(e.observacao)}</div>` : ''}
    <p class="muted">Atendido por ${esc(e.atendente || '—')} · emitido em ${new Date().toLocaleString('pt-BR')}</p>`);
}

export function relatorioCozinha(lista, titulo) {
  const dias = new Map(); lista.forEach((e) => { if (!dias.has(e.data_entrega)) dias.set(e.data_entrega, []); dias.get(e.data_entrega).push(e); });
  // Totais de produção por item (útil para eventos: quantos centos de cada mini)
  const somaItens = new Map(); lista.forEach((e) => (e.itens || []).forEach((i) => somaItens.set(i.descricao, (somaItens.get(i.descricao) || 0) + Number(i.quantidade))));
  janela(titulo, `<h1>${esc(titulo)}</h1><div class="muted">Gerado em ${new Date().toLocaleString('pt-BR')} · ${lista.length} encomenda(s)</div>
    ${somaItens.size ? `<table><tr><th>Produzir no período</th><th class="r">Qtd total</th></tr>${[...somaItens].sort().map(([d, q]) => `<tr><td>${esc(d)}</td><td class="r">${qtd(q)}</td></tr>`).join('')}</table>` : ''}
    ${[...dias].map(([d, encs]) => `<div class="dia"><b>${esc(diaSemana(d))}, ${esc(dataBR(d))}</b></div>${encs.map((e) => `
      <div class="enc"><b>${esc(e.hora_entrega || '--:--')} · ${esc(e.numero)} · ${esc(e.cliente_nome)}</b> <span class="muted">(${e.loja === 'VILLA' ? 'Villa' : 'Souza Cruz'} · ${e.entrega_tipo === 'ENTREGA' ? 'entrega' : 'retirada'})</span><br>
      ${(e.itens || []).map((i) => `${qtd(i.quantidade)}x ${esc(i.descricao)}`).join(' · ')}
      ${Object.entries(e.detalhes || {}).filter(([, v]) => v).map(([k, v]) => `<br>${esc(ROTULO[k] || k)}: <b>${esc(v)}</b>`).join('')}
      ${e.observacao ? `<br><span class="obs">⚠ ${esc(e.observacao)}</span>` : ''}</div>`).join('')}`).join('')}`);
}
