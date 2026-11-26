// Lê o XML de uma NF-e (o arquivo que o fornecedor manda por e-mail) e devolve os dados da nota.
export function lerNFe(xmlTexto) {
  const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Arquivo XML inválido.');
  const q = (el, tag) => el?.getElementsByTagName(tag)[0];
  const t = (el, tag) => q(el, tag)?.textContent?.trim() || null;
  const inf = q(doc, 'infNFe');
  if (!inf) throw new Error('Este XML não é de uma NF-e.');
  const ide = q(inf, 'ide'), emit = q(inf, 'emit'), dest = q(inf, 'dest');
  const num = (s) => (s == null ? null : Number(s));
  const itens = [...inf.getElementsByTagName('det')].map((d) => {
    const p = q(d, 'prod');
    return { codigo: t(p, 'cProd'), descricao: t(p, 'xProd'), ncm: t(p, 'NCM'), quantidade: num(t(p, 'qCom')), unidade: t(p, 'uCom'),
      valor_unit: num(t(p, 'vUnCom')), valor_total: num(t(p, 'vProd')) };
  });
  const duplicatas = [...inf.getElementsByTagName('dup')].map((d) => ({ numero: t(d, 'nDup'), vencimento: t(d, 'dVenc'), valor: num(t(d, 'vDup')) }));
  const tPag = t(q(inf, 'pag'), 'tPag');
  const FORMAS = { '01': 'Dinheiro', '03': 'Cartão', '04': 'Débito', '15': 'Boleto', '17': 'Pix', '90': 'Sem pagamento' };
  const emissao = (t(ide, 'dhEmi') || t(ide, 'dEmi') || '').slice(0, 10) || null;
  const total = num(t(q(inf, 'ICMSTot'), 'vNF'));
  return {
    chave: (inf.getAttribute('Id') || '').replace(/^NFe/, '') || null,
    numero: t(ide, 'nNF'), serie: t(ide, 'serie'), data_emissao: emissao, valor_total: total,
    cnpj_destinatario: t(dest, 'CNPJ') || t(dest, 'CPF'),
    fornecedor: { cnpj: t(emit, 'CNPJ'), nome: t(emit, 'xFant') || t(emit, 'xNome'), razao: t(emit, 'xNome'), telefone: t(q(emit, 'enderEmit'), 'fone') },
    itens,
    // Sem duplicatas no XML: uma parcela à vista na data de emissão
    duplicatas: duplicatas.length ? duplicatas : (total ? [{ numero: '1', vencimento: emissao, valor: total }] : []),
    forma_pagamento: duplicatas.length ? 'Boleto' : (FORMAS[tPag] || 'À vista'),
    pago: !duplicatas.length && ['01', '03', '04', '17'].includes(tPag),
    origem: 'xml',
  };
}
