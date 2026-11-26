-- =====================================================================
-- PEDACITO ERP · Formulários da equipe (sem login, com código da equipe)
-- e criação automática do primeiro administrador.
-- =====================================================================

-- O primeiro usuário cadastrado vira Administrador automaticamente.
-- Os próximos ficam sem perfil até o administrador liberar na tela de Configurações.
create or replace function novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from perfis) then
    insert into perfis (user_id, nome, email, funcao_id)
    values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)), new.email, 'admin');
  end if;
  return new;
end $$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
for each row execute function novo_usuario();

-- Confere o código da equipe (usado por todos os formulários públicos)
create or replace function _codigo_ok(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_codigo,'') <> (select valor #>> '{}' from config where chave = 'codigo_equipe') then
    raise exception 'Código da equipe inválido' using errcode = '28000';
  end if;
end $$;

create or replace function _loja(p text) returns text language sql immutable as $$
  select case
    when upper(unaccent(coalesce(p,''))) like 'VILLA%' then 'VILLA'
    when upper(unaccent(coalesce(p,''))) like 'SOUZA%' then 'SOUZA_CRUZ'
    else null end;
$$;

-- Listas para os formulários
create or replace function form_produtos(p_codigo text, p_loja text default null)
returns table (id bigint, nome text, tipo text, preco numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query
    select pr.id, pr.nome, pr.tipo, pr.preco from produtos pr
    where (p_loja is null)
       or (_loja(p_loja) = 'VILLA' and pr.ativo_villa)
       or (_loja(p_loja) = 'SOUZA_CRUZ' and pr.ativo_souza)
    order by pr.tipo, pr.nome;
end $$;

create or replace function form_insumos(p_codigo text)
returns table (id bigint, nome text, categoria text, unidade text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select i.id, i.nome, i.categoria, i.unidade from insumos i where i.ativo order by i.categoria, i.nome;
end $$;

-- Produção (cozinha). p_itens = [{produto_id, quantidade, observacao}]
create or replace function form_producao(p_codigo text, p_data date, p_loja text, p_turno text, p_nome text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; pr produtos;
begin
  perform _codigo_ok(p_codigo);
  if _loja(p_loja) is null or coalesce(trim(p_nome),'') = '' then raise exception 'Informe loja e nome'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pr from produtos where id = (it->>'produto_id')::bigint;
    if pr.id is null then raise exception 'Produto não encontrado'; end if;
    insert into producao_registros (data, loja, turno, responsavel, produto_id, produto_nome, tipo, quantidade, valor, observacao)
    values (p_data, _loja(p_loja), p_turno, trim(p_nome), pr.id, pr.nome, pr.tipo,
            (it->>'quantidade')::numeric, round(coalesce(pr.preco,0) * (it->>'quantidade')::numeric, 2),
            nullif(it->>'observacao',''));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Desperdício (cozinha ou balcão). p_itens = [{produto_id | insumo_id | nome, quantidade, motivo, valor?}]
create or replace function form_desperdicio(p_codigo text, p_origem text, p_data date, p_loja text, p_turno text, p_nome text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; pr produtos; ins insumos; v numeric;
begin
  perform _codigo_ok(p_codigo);
  if _loja(p_loja) is null or coalesce(trim(p_nome),'') = '' then raise exception 'Informe loja e nome'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce(trim(it->>'motivo'),'') = '' then raise exception 'Informe o motivo de cada item'; end if;
    pr := null; ins := null;
    if it ? 'produto_id' then select * into pr from produtos where id = (it->>'produto_id')::bigint; end if;
    if it ? 'insumo_id'  then select * into ins from insumos  where id = (it->>'insumo_id')::bigint; end if;
    v := coalesce((it->>'valor')::numeric,
                  coalesce(pr.preco, ins.custo_unitario, 0) * (it->>'quantidade')::numeric);
    insert into desperdicio_registros (origem, data, loja, turno, responsavel, produto_id, insumo_id, item_nome, tipo, quantidade, motivo, valor, foto_url)
    values (upper(p_origem), p_data, _loja(p_loja), p_turno, trim(p_nome), pr.id, ins.id,
            coalesce(pr.nome, ins.nome, it->>'nome'), pr.tipo, (it->>'quantidade')::numeric,
            it->>'motivo', round(v,2), nullif(it->>'foto_url',''));
    -- desperdício de insumo também baixa o estoque
    if ins.id is not null then
      insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, observacao, responsavel)
      values (p_data, _loja(p_loja), ins.id, 'PERDA', (it->>'quantidade')::numeric, ins.custo_unitario, 'desperdicio', it->>'motivo', trim(p_nome));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Relatório do balcão (observações e faltas)
create or replace function form_balcao(p_codigo text, p_data date, p_loja text, p_turno text, p_nome text,
                                       p_observacoes text, p_teve_falta boolean, p_produtos_falta text)
returns bigint language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform _codigo_ok(p_codigo);
  insert into balcao_relatorios (data, loja, turno, responsavel, observacoes, teve_falta, produtos_falta)
  values (p_data, _loja(p_loja), p_turno, trim(p_nome), p_observacoes, p_teve_falta, p_produtos_falta)
  returning id into novo;
  return novo;
end $$;

-- Movimentação de estoque feita pela equipe. p_itens = [{insumo_id, quantidade, custo_unit?}]
create or replace function form_movimentacao(p_codigo text, p_data date, p_loja text, p_tipo text, p_nome text, p_obs text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0;
begin
  perform _codigo_ok(p_codigo);
  if upper(p_tipo) not in ('ENTRADA','SAIDA') then raise exception 'Tipo inválido'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, observacao, responsavel)
    values (p_data, _loja(p_loja), (it->>'insumo_id')::bigint, upper(p_tipo), (it->>'quantidade')::numeric,
            nullif(it->>'custo_unit','')::numeric, 'formulario', p_obs, trim(p_nome));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lista de compras compartilhada
create or replace function form_lista(p_codigo text)
returns setof lista_compras language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select * from lista_compras where not comprado or criado_em > now() - interval '2 days' order by comprado, criado_em desc;
end $$;

create or replace function form_lista_add(p_codigo text, p_loja text, p_item text, p_qtd text, p_nome text)
returns bigint language plpgsql security definer set search_path = public as $$
declare novo bigint;
begin
  perform _codigo_ok(p_codigo);
  insert into lista_compras (loja, item, quantidade, pedido_por) values (_loja(p_loja), trim(p_item), p_qtd, p_nome) returning id into novo;
  return novo;
end $$;

create or replace function form_lista_marcar(p_codigo text, p_id bigint, p_comprado boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  update lista_compras set comprado = p_comprado where id = p_id;
end $$;

-- Canal de denúncias: não exige código da equipe (precisa ser acessível sempre)
create or replace function form_denuncia(p_tipo text, p_categoria text, p_descricao text, p_envolvidos text,
                                         p_data_fato date, p_loja text, p_anonima boolean, p_contato text)
returns text language plpgsql security definer set search_path = public as $$
declare prot text; grav text := 'Média';
begin
  if coalesce(trim(p_descricao),'') = '' then raise exception 'Descreva o ocorrido'; end if;
  if unaccent(lower(p_descricao)) ~ '(ameaca|grito|agressao|assedio sexual|violencia|todo dia|sempre|toda vez|de novo)' then
    grav := 'Alta';
  end if;
  prot := 'DEN-' || to_char(now() at time zone 'America/Sao_Paulo','YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text),1,5));
  insert into denuncias (protocolo, tipo, categoria, descricao, envolvidos, data_fato, loja, anonima, contato, gravidade)
  values (prot, p_tipo, p_categoria, left(p_descricao, 5000), p_envolvidos, p_data_fato, p_loja, coalesce(p_anonima,true),
          case when coalesce(p_anonima,true) then null else p_contato end, grav);
  return prot;
end $$;

-- Quem pode chamar o quê
revoke all on function _codigo_ok(text) from public, anon, authenticated;
grant execute on function form_produtos(text,text), form_insumos(text), form_producao(text,date,text,text,text,jsonb),
  form_desperdicio(text,text,date,text,text,text,jsonb), form_balcao(text,date,text,text,text,text,boolean,text),
  form_movimentacao(text,date,text,text,text,text,jsonb), form_lista(text), form_lista_add(text,text,text,text,text),
  form_lista_marcar(text,bigint,boolean), form_denuncia(text,text,text,text,date,text,boolean,text)
  to anon, authenticated;
