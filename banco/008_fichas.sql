-- =====================================================================
-- Fichas técnicas: estrutura, custo automático (CMV) e importação da
-- planilha Pedacito_Gestao_Compras. O JSON vem no fim (008_dados).
-- =====================================================================
alter table produtos add column if not exists aparece_formularios boolean not null default true;
alter table produtos add column if not exists categoria_cardapio text;
alter table fichas_tecnicas add column if not exists rendimento_unidade text not null default 'UN';
alter table fichas_tecnicas add column if not exists rendimento_texto text;
alter table fichas_tecnicas add column if not exists observacao text;
alter table insumos add column if not exists uso text not null default 'estoque';  -- estoque | receita | ambos

-- Os formulários da equipe só mostram produtos marcados para aparecer
create or replace function form_produtos(p_codigo text, p_loja text default null)
returns table (id bigint, nome text, tipo text, preco numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query
    select pr.id, pr.nome, pr.tipo, pr.preco from produtos pr
    where pr.aparece_formularios and ((p_loja is null)
       or (_loja(p_loja) = 'VILLA' and pr.ativo_villa)
       or (_loja(p_loja) = 'SOUZA_CRUZ' and pr.ativo_souza))
    order by pr.tipo, pr.nome;
end $$;

-- Custo de cada ficha = soma (quantidade × custo do insumo), mais sub-receitas
-- (custo da sub-receita ÷ rendimento × quantidade usada).
create or replace view fichas_custo with (security_invoker = true) as
with recursive base as (
  select f.produto_id, coalesce(sum(fi.quantidade * coalesce(i.custo_unitario, 0)), 0) as custo_insumos,
         count(*) filter (where fi.insumo_id is not null and i.custo_unitario is null) as sem_custo
  from fichas_tecnicas f left join ficha_itens fi on fi.produto_id = f.produto_id and fi.insumo_id is not null
  left join insumos i on i.id = fi.insumo_id group by f.produto_id
), arvore as (
  select produto_id, custo_insumos as custo, 0 as nivel from base
  union all
  select fi.produto_id, a.custo / nullif(ft.rendimento, 0) * fi.quantidade, a.nivel + 1
  from ficha_itens fi join arvore a on a.produto_id = fi.subproduto_id
  join fichas_tecnicas ft on ft.produto_id = fi.subproduto_id where a.nivel < 5
)
select p.id as produto_id, p.nome, p.tipo, p.preco, ft.rendimento, ft.rendimento_unidade, ft.rendimento_texto,
       round(sum(a.custo)::numeric, 4) as custo_total,
       round((sum(a.custo) / nullif(ft.rendimento, 0))::numeric, 4) as custo_unidade,
       case when p.preco > 0 then round((sum(a.custo) / nullif(ft.rendimento, 0) / p.preco * 100)::numeric, 1) end as cmv_pct,
       (select sem_custo from base b where b.produto_id = p.id) as itens_sem_custo,
       (select count(*) from ficha_itens x where x.produto_id = p.id) as n_itens
from fichas_tecnicas ft join produtos p on p.id = ft.produto_id
join arvore a on a.produto_id = ft.produto_id
group by p.id, ft.produto_id;

create or replace function importar_fichas(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; it jsonb; v_prod bigint; v_ins bigint; v_qtd numeric; n_ins int := 0; n_fic int := 0; n_lin int := 0;
        nome_ins text; existente insumos; un text;
begin
  if not eu_admin() and current_user not in ('postgres', 'supabase_admin') then raise exception 'Somente administradores'; end if;
  -- 1) insumos de receita (custo por g/ml/un)
  for x in select * from jsonb_array_elements(d->'insumos') loop
    nome_ins := trim(x->>0); un := x->>2;
    select * into existente from insumos where upper(nome) = upper(nome_ins);
    if existente.id is not null then
      if (existente.unidade = 'KG' and un = 'G') or (existente.unidade = 'L' and un = 'ML') or existente.unidade = un then
        update insumos set uso = 'ambos', custo_unitario = coalesce(custo_unitario,
          case when existente.unidade = un then (x->>3)::numeric else (x->>3)::numeric * 1000 end) where id = existente.id;
        continue;
      end if;
      nome_ins := nome_ins || ' (receita)';
    end if;
    insert into insumos (nome, categoria, unidade, custo_unitario, custo_atualizado, uso)
    values (nome_ins, x->>1, un, nullif(x->>3,'')::numeric, now(), 'receita')
    on conflict (nome) do nothing;
    n_ins := n_ins + 1;
  end loop;
  -- 2) produtos + fichas
  for x in select * from jsonb_array_elements(d->'fichas') loop
    select id into v_prod from produtos where upper(nome) = upper(x->>0);
    if v_prod is null then
      insert into produtos (nome, tipo, preco, ativo_villa, ativo_souza, aparece_formularios, categoria_cardapio)
      values (x->>0, x->>1, nullif(x->>2,'')::numeric, (x->>5)::boolean and not (x->>7)::boolean, (x->>6)::boolean and not (x->>7)::boolean, false, x->>1)
      returning id into v_prod;
    elsif (x->>2) is not null then
      update produtos set preco = coalesce(preco, (x->>2)::numeric) where id = v_prod;
    end if;
    insert into fichas_tecnicas (produto_id, rendimento, rendimento_unidade, rendimento_texto)
    values (v_prod, (x->>3)::numeric, x->>4, x->>8)
    on conflict (produto_id) do update set rendimento = excluded.rendimento, rendimento_unidade = excluded.rendimento_unidade,
      rendimento_texto = excluded.rendimento_texto, atualizado_em = now();
    delete from ficha_itens where produto_id = v_prod;
    n_fic := n_fic + 1;
    for it in select * from jsonb_array_elements(x->9) loop
      continue when upper(it->>0) = upper(x->>0);              -- linha que aponta para o próprio produto
      v_qtd := coalesce((it->>1)::numeric, 0);
      select id, unidade into v_ins, un from insumos where upper(nome) = upper(it->>0) and uso in ('receita','ambos') order by uso = 'receita' desc limit 1;
      if v_ins is null then select id, unidade into v_ins, un from insumos where upper(nome) = upper((it->>0) || ' (receita)'); end if;
      if v_ins is null then
        insert into insumos (nome, categoria, unidade, uso) values (trim(it->>0), 'Sem cadastro', 'G', 'receita')
        on conflict (nome) do update set uso = insumos.uso returning id, unidade into v_ins, un;
      end if;
      if un in ('KG', 'L') then v_qtd := v_qtd / 1000; end if;  -- ficha em g/ml, estoque em kg/l
      insert into ficha_itens (produto_id, insumo_id, quantidade) values (v_prod, v_ins, v_qtd);
      n_lin := n_lin + 1;
    end loop;
  end loop;
  return jsonb_build_object('insumos_novos', n_ins, 'fichas', n_fic, 'linhas', n_lin);
end $$;
revoke all on function importar_fichas(jsonb) from public, anon, authenticated;
