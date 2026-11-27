-- =====================================================================
-- Impostos das notas fiscais: o que vem destacado no XML da NF-e.
-- São valores que já estão DENTRO do preço da nota (ICMS, PIS, COFINS,
-- IBS/CBS), exceto ST, FCP-ST e IPI, que o fornecedor soma por cima.
-- tributos_aprox = carga aproximada de tributos (Lei da Transparência),
-- quando o fornecedor informa.
-- =====================================================================
alter table notas_fiscais add column if not exists icms numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists icms_st numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists fcp_st numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists ipi numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists pis numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists cofins numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists ibs numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists cbs numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists tributos_aprox numeric(14,2);
alter table notas_fiscais add column if not exists frete numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists outras_despesas numeric(14,2) not null default 0;
alter table notas_fiscais add column if not exists impostos_informados boolean not null default false;
alter table notas_fiscais add column if not exists impostos_total numeric(14,2)
  generated always as (icms + icms_st + fcp_st + ipi + pis + cofins + ibs + cbs) stored;

create or replace function _gravar_impostos_nota(p_nota bigint, i jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notas_fiscais set
    icms = coalesce((i->>'icms')::numeric, 0),
    icms_st = coalesce((i->>'icms_st')::numeric, 0),
    fcp_st = coalesce((i->>'fcp_st')::numeric, 0),
    ipi = coalesce((i->>'ipi')::numeric, 0),
    pis = coalesce((i->>'pis')::numeric, 0),
    cofins = coalesce((i->>'cofins')::numeric, 0),
    ibs = coalesce((i->>'ibs')::numeric, 0),
    cbs = coalesce((i->>'cbs')::numeric, 0),
    tributos_aprox = nullif(i->>'tributos_aprox', '')::numeric,
    frete = coalesce((i->>'frete')::numeric, 0),
    outras_despesas = coalesce((i->>'outras')::numeric, 0),
    impostos_informados = true
  where id = p_nota;
end $$;
revoke all on function _gravar_impostos_nota(bigint, jsonb) from public, anon, authenticated;

-- p = {chave, numero, serie, data_emissao, valor_total, loja?, cnpj_destinatario?, origem, email_id?, observacao?,
--      fornecedor: {cnpj, nome, telefone?, email?},
--      itens: [{codigo, descricao, ncm, quantidade, unidade, valor_unit, valor_total}],
--      duplicatas: [{numero, vencimento, valor}], forma_pagamento?, pago?,
--      impostos?: {icms, icms_st, fcp_st, ipi, pis, cofins, ibs, cbs, tributos_aprox, frete, outras}}
create or replace function registrar_nota(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_forn bigint; v_nota bigint; v_loja text; it jsonb; d jsonb; corr insumo_correspondencia;
        n_ok int := 0; n_pend int := 0; n_dup int := 0; total_dup int; v_item bigint; v_cnpj text;
begin
  if not posso('notas', true) and not posso('compras', true) then raise exception 'Sem permissão para lançar notas'; end if;
  if p->>'chave' is not null and exists (select 1 from notas_fiscais where chave_acesso = p->>'chave') then
    return jsonb_build_object('ok', false, 'duplicada', true, 'mensagem', 'Esta nota já foi lançada.');
  end if;
  -- loja: pelo CNPJ do destinatário (aprendido) ou informada
  v_cnpj := regexp_replace(coalesce(p->>'cnpj_destinatario', ''), '\D', '', 'g');
  v_loja := coalesce(nullif(p->>'loja', ''), (select valor->>v_cnpj from config where chave = 'cnpj_lojas'));
  if v_loja is null then raise exception 'Informe a loja da nota (Villa ou Souza Cruz).'; end if;
  v_loja := _loja(v_loja);
  if v_cnpj <> '' then
    update config set valor = valor || jsonb_build_object(v_cnpj, v_loja) where chave = 'cnpj_lojas';
  end if;
  -- fornecedor
  select id into v_forn from fornecedores
   where regexp_replace(coalesce(cnpj,''), '\D', '', 'g') = regexp_replace(coalesce(p#>>'{fornecedor,cnpj}',''), '\D', '', 'g')
     and coalesce(p#>>'{fornecedor,cnpj}','') <> '' limit 1;
  if v_forn is null then select id into v_forn from fornecedores where upper(nome) = upper(p#>>'{fornecedor,nome}') limit 1; end if;
  if v_forn is null then
    insert into fornecedores (nome, cnpj, telefone, email, ativo, observacao)
    values (coalesce(p#>>'{fornecedor,nome}', 'Fornecedor sem nome'), p#>>'{fornecedor,cnpj}', p#>>'{fornecedor,telefone}', p#>>'{fornecedor,email}', true, 'Cadastrado automaticamente por nota fiscal')
    returning id into v_forn;
  end if;
  insert into notas_fiscais (loja, fornecedor_id, numero, serie, chave_acesso, data_emissao, data_entrada, valor_total, tipo_doc, origem, email_id, cnpj_destinatario, observacao)
  values (v_loja, v_forn, p->>'numero', p->>'serie', nullif(p->>'chave',''), nullif(p->>'data_emissao','')::date, current_date,
          coalesce((p->>'valor_total')::numeric, 0), coalesce(p->>'tipo_doc', 'NF-e'), coalesce(p->>'origem','manual'), p->>'email_id', nullif(v_cnpj,''), p->>'observacao')
  returning id into v_nota;
  -- impostos destacados no XML
  if p ? 'impostos' then perform _gravar_impostos_nota(v_nota, p->'impostos'); end if;
  -- itens
  for it in select * from jsonb_array_elements(coalesce(p->'itens','[]')) loop
    select * into corr from insumo_correspondencia
     where (fornecedor_id = v_forn or fornecedor_id is null) and upper(nome_na_nota) = upper(trim(it->>'descricao'))
     order by fornecedor_id nulls last limit 1;
    insert into nota_itens (nota_id, descricao, codigo_fornecedor, ncm, insumo_id, quantidade, unidade, valor_unit, valor_total, fator)
    values (v_nota, trim(it->>'descricao'), it->>'codigo', it->>'ncm', corr.insumo_id, (it->>'quantidade')::numeric, it->>'unidade',
            nullif(it->>'valor_unit','')::numeric, coalesce(nullif(it->>'valor_total','')::numeric, (it->>'quantidade')::numeric * (it->>'valor_unit')::numeric),
            coalesce(corr.fator, 1))
    returning id into v_item;
    if corr.insumo_id is not null then perform _lancar_item(v_item); n_ok := n_ok + 1; else n_pend := n_pend + 1; end if;
  end loop;
  update notas_fiscais set status = case when n_pend > 0 then 'PENDENTE_VINCULO' else 'OK' end where id = v_nota;
  -- contas a pagar
  total_dup := jsonb_array_length(coalesce(p->'duplicatas','[]'));
  for d in select * from jsonb_array_elements(coalesce(p->'duplicatas','[]')) loop
    n_dup := n_dup + 1;
    insert into lancamentos (loja, tipo, categoria, subcategoria, descricao, fornecedor_id, nota_id, valor, competencia, vencimento, status,
                             forma_pagamento, parcela, origem, pagamento)
    values (v_loja, 'DESPESA', 'FORNECEDOR', 'INSUMO',
            upper((select nome from fornecedores where id = v_forn)) || ' NF ' || coalesce(p->>'numero','') || case when total_dup > 1 then format(' (%s/%s)', n_dup, total_dup) else '' end,
            v_forn, v_nota, (d->>'valor')::numeric, nullif(p->>'data_emissao','')::date, (d->>'vencimento')::date,
            case when coalesce((p->>'pago')::boolean, false) then 'PAGO' else 'PENDENTE' end,
            coalesce(p->>'forma_pagamento', 'Boleto'), format('%s/%s', n_dup, total_dup), 'nota',
            case when coalesce((p->>'pago')::boolean, false) then nullif(p->>'data_emissao','')::date end);
  end loop;
  return jsonb_build_object('ok', true, 'nota_id', v_nota, 'itens_lancados', n_ok, 'itens_pendentes', n_pend, 'parcelas', n_dup, 'loja', v_loja);
end $$;

grant execute on function registrar_nota(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Preenche as notas importadas antes desta mudança (valores dos XML).
-- ---------------------------------------------------------------------
select _gravar_impostos_nota(id, x.i) from notas_fiscais nf join (values
  ('42261104145478000160550010002498051178593177', '{"icms":48.30,"pis":2.60,"cofins":12.00,"ibs":0.35,"cbs":3.05,"outras":2.50}'::jsonb),
  ('42261104145478000160550010002498131331454877', '{"icms":9.60,"pis":0.52,"cofins":2.40,"ibs":0.07,"cbs":0.61}'::jsonb),
  ('42261161141542000179550010000020141451047981', '{}'::jsonb),
  ('42261107757491000169550020000118711507569800', '{"icms":46.97,"ibs":0.13,"cbs":1.25}'::jsonb),
  ('42261101435328001841550010000105121000055144', '{"icms":63.41,"tributos_aprox":99.54}'::jsonb),
  ('42261182900713000176550010053113541901991235', '{"icms":159.91,"tributos_aprox":333.50,"frete":14.90,"outras":7.29}'::jsonb)
) as x(chave, i) on nf.chave_acesso = x.chave;
