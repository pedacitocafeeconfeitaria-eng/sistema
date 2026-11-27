-- 018: Desfazer o vínculo de um item de nota (insumo errado ou "Não é estoque" por engano).
-- Tira a entrada do estoque, esquece a correspondência aprendida e devolve o item para "a vincular".
create or replace function desvincular_item_nota(p_item bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it nota_itens; nf notas_fiscais; v_mov bigint; pend int;
begin
  if not posso('notas', true) and not posso('compras', true) then raise exception 'Sem permissão'; end if;
  select * into it from nota_itens where id = p_item;
  if it.id is null then raise exception 'Item não encontrado'; end if;
  select * into nf from notas_fiscais where id = it.nota_id;
  if it.insumo_id is not null and it.estoque_lancado then
    select id into v_mov from estoque_movimentos
     where origem = 'nota' and origem_id = nf.id and insumo_id = it.insumo_id and tipo = 'ENTRADA'
     order by (observacao = 'NF ' || coalesce(nf.numero, '') || ' · ' || it.descricao) desc, id desc limit 1;
    if v_mov is not null then delete from estoque_movimentos where id = v_mov; end if;
    -- custo de referência volta a ser o da última entrada que sobrou
    update insumos set custo_unitario = coalesce((select custo_unit from estoque_movimentos
        where insumo_id = it.insumo_id and tipo = 'ENTRADA' and custo_unit > 0 order by data desc, id desc limit 1), custo_unitario)
     where id = it.insumo_id;
    -- o sistema não deve repetir o vínculo errado nas próximas notas
    delete from insumo_correspondencia
     where insumo_id = it.insumo_id and upper(nome_na_nota) = upper(it.descricao)
       and (fornecedor_id = nf.fornecedor_id or fornecedor_id is null);
  end if;
  update nota_itens set insumo_id = null, fator = 1, estoque_lancado = false where id = p_item;
  select count(*) into pend from nota_itens where nota_id = it.nota_id and insumo_id is null and not estoque_lancado;
  update notas_fiscais set status = case when pend > 0 then 'PENDENTE_VINCULO' else 'OK' end where id = it.nota_id;
  return jsonb_build_object('ok', true, 'pendentes_na_nota', pend);
end $$;
grant execute on function desvincular_item_nota(bigint) to authenticated;
