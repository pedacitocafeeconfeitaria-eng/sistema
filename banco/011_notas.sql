-- =====================================================================
-- Notas fiscais: entrada por XML (NF-e), foto ou e-mail.
-- Cada nota: fornecedor (cria se não existir), itens, entrada no estoque
-- dos itens já vinculados a um insumo, e contas a pagar pelas duplicatas.
-- =====================================================================
alter table notas_fiscais add column if not exists status text not null default 'OK';   -- OK | PENDENTE_VINCULO
alter table notas_fiscais add column if not exists serie text;
alter table notas_fiscais add column if not exists origem text default 'manual';        -- xml | foto | email | manual | pedido
alter table notas_fiscais add column if not exists email_id text;
alter table notas_fiscais add column if not exists cnpj_destinatario text;
alter table nota_itens add column if not exists codigo_fornecedor text;
alter table nota_itens add column if not exists fator numeric(14,4) not null default 1;
alter table nota_itens add column if not exists estoque_lancado boolean not null default false;
alter table nota_itens add column if not exists ncm text;
alter table insumo_correspondencia add column if not exists unidade_nota text;

insert into config (chave, valor) values ('cnpj_lojas', '{}'::jsonb) on conflict (chave) do nothing;

-- Lança no estoque um item já vinculado
create or replace function _lancar_item(p_item bigint) returns void
language plpgsql security definer set search_path = public as $$
declare it nota_itens; nf notas_fiscais; qtd numeric; custo numeric;
begin
  select * into it from nota_itens where id = p_item;
  if it.insumo_id is null or it.estoque_lancado then return; end if;
  select * into nf from notas_fiscais where id = it.nota_id;
  qtd := it.quantidade * coalesce(it.fator, 1);
  custo := case when qtd > 0 then it.valor_total / qtd end;
  insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, origem_id, observacao)
  values (coalesce(nf.data_emissao, nf.data_entrada), nf.loja, it.insumo_id, 'ENTRADA', qtd, custo, 'nota', nf.id,
          'NF ' || coalesce(nf.numero, '') || ' · ' || it.descricao);
  if custo > 0 then update insumos set custo_unitario = round(custo, 4), custo_atualizado = now() where id = it.insumo_id; end if;
  update nota_itens set estoque_lancado = true where id = p_item;
end $$;

-- p = {chave, numero, serie, data_emissao, valor_total, loja?, cnpj_destinatario?, origem, email_id?, observacao?,
--      fornecedor: {cnpj, nome, telefone?, email?},
--      itens: [{codigo, descricao, ncm, quantidade, unidade, valor_unit, valor_total}],
--      duplicatas: [{numero, vencimento, valor}], forma_pagamento?, pago?}
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

-- Vincula um item da nota a um insumo (e lembra para as próximas notas desse fornecedor)
create or replace function vincular_item_nota(p_item bigint, p_insumo bigint, p_fator numeric, p_lembrar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it nota_itens; v_forn bigint; pend int; outro record; v_fator numeric := coalesce(nullif(p_fator, 0), 1); n_outros int := 0;
begin
  if not posso('notas', true) and not posso('compras', true) then raise exception 'Sem permissão'; end if;
  select * into it from nota_itens where id = p_item;
  if it.estoque_lancado then raise exception 'Este item já entrou no estoque.'; end if;
  update nota_itens set insumo_id = p_insumo, fator = v_fator where id = p_item;
  perform _lancar_item(p_item);
  select fornecedor_id into v_forn from notas_fiscais where id = it.nota_id;
  if p_lembrar then
    insert into insumo_correspondencia (fornecedor_id, nome_na_nota, insumo_id, fator, unidade_nota)
    values (v_forn, it.descricao, p_insumo, v_fator, it.unidade)
    on conflict (fornecedor_id, nome_na_nota) do update set insumo_id = excluded.insumo_id, fator = excluded.fator;
    -- o mesmo item em outras notas pendentes desse fornecedor
    for outro in select ni.id, ni.nota_id from nota_itens ni join notas_fiscais nf on nf.id = ni.nota_id
                 where ni.insumo_id is null and not ni.estoque_lancado and nf.fornecedor_id = v_forn and upper(ni.descricao) = upper(it.descricao) loop
      update nota_itens set insumo_id = p_insumo, fator = v_fator where id = outro.id;
      perform _lancar_item(outro.id);
      update notas_fiscais set status = case when exists (select 1 from nota_itens where nota_id = outro.nota_id and insumo_id is null and not estoque_lancado)
        then 'PENDENTE_VINCULO' else 'OK' end where id = outro.nota_id;
      n_outros := n_outros + 1;
    end loop;
  end if;
  select count(*) into pend from nota_itens where nota_id = it.nota_id and insumo_id is null and not estoque_lancado;
  update notas_fiscais set status = case when pend > 0 then 'PENDENTE_VINCULO' else 'OK' end where id = it.nota_id;
  return jsonb_build_object('ok', true, 'pendentes_na_nota', pend, 'outras_notas_vinculadas', n_outros);
end $$;

-- Item que não vai para o estoque (ex.: frete, serviço, produto de revenda controlado no Raffinato)
create or replace function ignorar_item_nota(p_item bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_nota bigint; pend int;
begin
  if not posso('notas', true) and not posso('compras', true) then raise exception 'Sem permissão'; end if;
  update nota_itens set estoque_lancado = true where id = p_item and insumo_id is null returning nota_id into v_nota;
  select count(*) into pend from nota_itens where nota_id = v_nota and insumo_id is null and not estoque_lancado;
  update notas_fiscais set status = case when pend > 0 then 'PENDENTE_VINCULO' else 'OK' end where id = v_nota;
end $$;

revoke all on function _lancar_item(bigint) from public, anon, authenticated;
grant execute on function registrar_nota(jsonb), vincular_item_nota(bigint,bigint,numeric,boolean), ignorar_item_nota(bigint) to authenticated;
