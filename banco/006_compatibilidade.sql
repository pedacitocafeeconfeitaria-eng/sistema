-- Funções extras para as telas atuais (formulários e gestão de usuários).

-- Bancos para o formulário de movimentação
create or replace function form_bancos(p_codigo text) returns setof text
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select nome from contas_bancarias where ativo order by nome;
end $$;

-- Remover item (ou todos os comprados, com p_id nulo) da lista de compras
create or replace function form_lista_remover(p_codigo text, p_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  if p_id is null then delete from lista_compras where comprado;
  else delete from lista_compras where id = p_id; end if;
end $$;

-- Movimentação de estoque com pagamento (mesmas regras do sistema atual).
-- p = {data, loja, tipo: ENTRADA|SAÍDA, nome, observacao,
--      itens: [{produto, quantidade, valorUnitario}],
--      pagamento: {forma, fornecedor, banco, parcelas: [{valor, vencimento}]}}
create or replace function form_movimentacao_v2(p_codigo text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; ins insumos; v_tipo text; v_loja text; v_vu numeric; v_total numeric := 0; v_obs text;
        v_conta bigint; parc jsonb; i int := 0; n_parc int; v_forn text;
begin
  perform _codigo_ok(p_codigo);
  v_loja := _loja(p->>'loja');
  v_tipo := case when upper(p->>'tipo') = 'ENTRADA' then 'ENTRADA' else 'SAIDA' end;
  if v_loja is null or coalesce(trim(p->>'nome'),'') = '' then raise exception 'Informe loja e nome'; end if;
  if jsonb_array_length(coalesce(p->'itens','[]')) = 0 then raise exception 'Adicione ao menos um produto.'; end if;
  v_obs := concat_ws(' · ', nullif(trim(p->>'observacao'),''),
                     case when v_tipo = 'ENTRADA' then 'Pagamento: ' || coalesce(p#>>'{pagamento,forma}','—') end);
  for it in select * from jsonb_array_elements(p->'itens') loop
    select * into ins from insumos where upper(nome) = upper(it->>'produto') limit 1;
    if ins.id is null then raise exception 'Produto não cadastrado: %', it->>'produto'; end if;
    if coalesce((it->>'quantidade')::numeric,0) <= 0 then raise exception 'Quantidade deve ser maior que zero.'; end if;
    v_vu := case when v_tipo = 'ENTRADA' then (it->>'valorUnitario')::numeric else ins.custo_unitario end;
    if v_tipo = 'ENTRADA' and coalesce(v_vu,0) <= 0 then raise exception 'Informe o valor unitário de cada produto.'; end if;
    insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, observacao, responsavel)
    values ((p->>'data')::date, v_loja, ins.id, v_tipo, (it->>'quantidade')::numeric, v_vu, 'formulario', v_obs, upper(trim(p->>'nome')));
    if v_tipo = 'ENTRADA' then
      update insumos set custo_unitario = v_vu, custo_atualizado = now() where id = ins.id;
    end if;
    v_total := v_total + (it->>'quantidade')::numeric * coalesce(v_vu,0);
  end loop;

  if v_tipo = 'ENTRADA' and p#>>'{pagamento,forma}' = 'Boleto' then
    v_forn := upper(trim(p#>>'{pagamento,fornecedor}'));
    if coalesce(v_forn,'') = '' then raise exception 'Informe o fornecedor.'; end if;
    select id into v_conta from contas_bancarias where upper(nome) = upper(trim(p#>>'{pagamento,banco}'));
    n_parc := jsonb_array_length(coalesce(p#>'{pagamento,parcelas}','[]'));
    if n_parc = 0 then raise exception 'Informe a quantidade de parcelas.'; end if;
    for parc in select * from jsonb_array_elements(p#>'{pagamento,parcelas}') loop
      i := i + 1;
      insert into lancamentos (loja, tipo, categoria, subcategoria, descricao, valor, competencia, vencimento, status,
                               forma_pagamento, conta_id, parcela, origem)
      values (v_loja, 'DESPESA', 'FORNECEDOR', 'INSUMO', v_forn || case when n_parc > 1 then format(' (%s/%s)', i, n_parc) else '' end,
              (parc->>'valor')::numeric, (p->>'data')::date, (parc->>'vencimento')::date, 'PENDENTE', 'Boleto', v_conta,
              format('%s/%s', i, n_parc), 'estoque');
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'total', round(v_total,2), 'boletos', i);
end $$;

-- Usuários que criaram conta e ainda não foram liberados (só admin vê)
create or replace function usuarios_pendentes()
returns table (user_id uuid, email text, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eu_admin() then raise exception 'Somente administradores'; end if;
  return query select u.id, u.email::text, u.created_at from auth.users u
    where not exists (select 1 from perfis p where p.user_id = u.id) order by u.created_at desc;
end $$;

-- Áreas (módulos) que o usuário logado pode ver
create or replace function minhas_areas()
returns table (modulo text, editar boolean)
language sql stable security definer set search_path = public as $$
  select fp.modulo, fp.editar from perfis pf join funcao_permissoes fp on fp.funcao_id = pf.funcao_id
  where pf.user_id = auth.uid() and pf.ativo and (fp.ver or fp.editar);
$$;

revoke all on function usuarios_pendentes() from public, anon;
grant execute on function usuarios_pendentes(), minhas_areas() to authenticated;
grant execute on function form_bancos(text), form_lista_remover(text,bigint), form_movimentacao_v2(text,jsonb) to anon, authenticated;

alter table denuncias add column if not exists responsavel text;
alter table denuncias alter column status set default 'Aberto';
update denuncias set status = 'Aberto' where status = 'NOVA';
