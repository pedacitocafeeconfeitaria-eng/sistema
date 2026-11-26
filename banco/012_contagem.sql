-- Contagem de estoque (inventário): a equipe conta o que tem na loja e o sistema ajusta o saldo.
-- Pode ser feita pelo formulário da equipe (código) ou por quem tem acesso ao estoque.

create or replace function _fechar_contagem(p_loja text, p_nome text, p_itens jsonb, p_obs text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cont bigint; it jsonb; saldo_atual numeric; dif numeric; n int := 0; n_aj int := 0; v_ins insumos;
begin
  insert into contagens (data, loja, responsavel, status) values (current_date, p_loja, trim(p_nome), 'FECHADA') returning id into v_cont;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    continue when it->>'quantidade' is null or it->>'quantidade' = '';
    select * into v_ins from insumos where id = (it->>'insumo_id')::bigint;
    continue when v_ins.id is null;
    insert into contagem_itens (contagem_id, insumo_id, quantidade) values (v_cont, v_ins.id, (it->>'quantidade')::numeric)
    on conflict (contagem_id, insumo_id) do update set quantidade = excluded.quantidade;
    select coalesce(saldo, 0) into saldo_atual from estoque_saldo where insumo_id = v_ins.id and loja = p_loja;
    dif := (it->>'quantidade')::numeric - coalesce(saldo_atual, 0);
    if dif <> 0 then
      insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, origem_id, observacao, responsavel)
      values (current_date, p_loja, v_ins.id, 'AJUSTE', dif, v_ins.custo_unitario, 'contagem', v_cont,
              format('Contagem: sistema %s, contado %s', coalesce(saldo_atual, 0), it->>'quantidade') || coalesce(' · ' || nullif(p_obs, ''), ''), trim(p_nome));
      n_aj := n_aj + 1;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'contagem_id', v_cont, 'itens', n, 'ajustes', n_aj);
end $$;
revoke all on function _fechar_contagem(text,text,jsonb,text) from public, anon, authenticated;

-- Pela equipe (código da equipe)
create or replace function form_contagem(p_codigo text, p_loja text, p_nome text, p_itens jsonb, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  if _loja(p_loja) is null or coalesce(trim(p_nome), '') = '' then raise exception 'Informe loja e nome'; end if;
  return _fechar_contagem(_loja(p_loja), p_nome, p_itens, p_obs);
end $$;

-- Saldos atuais para a tela de contagem (mostra o que o sistema espera, para comparar)
create or replace function form_saldos(p_codigo text, p_loja text)
returns table (insumo_id bigint, nome text, categoria text, unidade text, saldo numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select s.insumo_id, s.nome, s.categoria, s.unidade, s.saldo from estoque_saldo s
    join insumos i on i.id = s.insumo_id where s.loja = _loja(p_loja) and i.uso <> 'receita' order by s.categoria, s.nome;
end $$;

grant execute on function form_contagem(text,text,text,jsonb,text), form_saldos(text,text) to anon, authenticated;
