-- 019: Vendas diárias do Raffinato (faturamento, nº de vendas, ticket médio, formas de pagamento, itens vendidos).
alter table vendas add column if not exists grupo text;

create table if not exists vendas_dia (
  data          date not null,
  loja          text not null references lojas(id),
  total         numeric(14,2) not null default 0,     -- líquido (depois de descontos)
  bruto         numeric(14,2) not null default 0,
  desconto      numeric(14,2) not null default 0,
  qtd_vendas    int not null default 0,
  ticket_medio  numeric(12,2) not null default 0,
  origens       jsonb not null default '{}',          -- {"Venda Mesa":{"q":66,"v":4290.74}, ...}
  pagamentos    jsonb not null default '{}',          -- {"POS":4323.84,"Dinheiro":726.10, ...}
  itens         int not null default 0,
  origem        text not null default 'raffinato',
  atualizado_em timestamptz not null default now(),
  primary key (data, loja)
);
alter table vendas_dia enable row level security;
drop policy if exists ler on vendas_dia;
create policy ler on vendas_dia for select to authenticated using (posso('faturamento') or posso('dashboard') or posso('financeiro'));

-- p = {data:'AAAA-MM-DD', loja, total, bruto, desconto, qtd_vendas, ticket, origens{}, pagto{}, itens:[[nome, qtd, valor, grupo]], avisar:bool}
create or replace function importar_vendas_dia(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_data date := (p->>'data')::date; v_loja text := _loja(p->>'loja'); it jsonb; n int := 0; v_rec text := 'existente';
begin
  if not (eu_admin() or posso('faturamento', true) or posso('financeiro', true)) then raise exception 'Sem permissão'; end if;
  if v_data is null or v_loja is null then raise exception 'Informe data e loja'; end if;
  insert into vendas_dia (data, loja, total, bruto, desconto, qtd_vendas, ticket_medio, origens, pagamentos, itens, atualizado_em)
  values (v_data, v_loja, coalesce((p->>'total')::numeric, 0), coalesce((p->>'bruto')::numeric, 0), coalesce((p->>'desconto')::numeric, 0),
          coalesce((p->>'qtd_vendas')::int, 0), coalesce((p->>'ticket')::numeric, 0), coalesce(p->'origens', '{}'), coalesce(p->'pagto', '{}'),
          jsonb_array_length(coalesce(p->'itens', '[]')), now())
  on conflict (data, loja) do update set total = excluded.total, bruto = excluded.bruto, desconto = excluded.desconto, qtd_vendas = excluded.qtd_vendas,
    ticket_medio = excluded.ticket_medio, origens = excluded.origens, pagamentos = excluded.pagamentos, itens = excluded.itens, atualizado_em = now();
  -- itens vendidos (substitui a importação anterior do mesmo dia)
  delete from vendas where data = v_data and loja = v_loja and importacao_id = 'raffinato';
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    insert into vendas (data, loja, produto_id, produto_nome, quantidade, valor_total, grupo, importacao_id)
    values (v_data, v_loja, (select id from produtos where upper(nome) = upper(it->>0) limit 1), it->>0, (it->>1)::numeric, (it->>2)::numeric, nullif(it->>3, ''), 'raffinato');
    n := n + 1;
  end loop;
  -- receita do dia no financeiro (só se a planilha/lançamento manual ainda não lançou o faturamento desse dia)
  if coalesce((p->>'total')::numeric, 0) > 0 then
    if exists (select 1 from lancamentos where loja = v_loja and tipo = 'RECEITA' and categoria = 'FATURAMENTO' and vencimento = v_data and origem = 'raffinato') then
      update lancamentos set valor = (p->>'total')::numeric where loja = v_loja and tipo = 'RECEITA' and categoria = 'FATURAMENTO' and vencimento = v_data and origem = 'raffinato';
      v_rec := 'atualizada';
    elsif not exists (select 1 from lancamentos where loja = v_loja and tipo = 'RECEITA' and categoria = 'FATURAMENTO' and vencimento = v_data and status <> 'CANCELADO') then
      insert into lancamentos (loja, tipo, categoria, descricao, valor, competencia, vencimento, pagamento, status, origem)
      values (v_loja, 'RECEITA', 'FATURAMENTO', 'FATURAMENTO (Raffinato)', (p->>'total')::numeric, v_data, v_data, v_data, 'PAGO', 'raffinato');
      v_rec := 'lancada';
    end if;
  end if;
  if coalesce((p->>'avisar')::boolean, false) then
    insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel, total)
    values ('financeiro', v_loja, 'Raffinato (automático)', 'Vendas de ' || to_char(v_data, 'DD/MM'),
            _brl((p->>'total')::numeric) || ' · ' || coalesce(p->>'qtd_vendas', '0') || ' vendas · ticket ' || _brl((p->>'ticket')::numeric), '/gestao/vendas', 'info', (p->>'total')::numeric);
  end if;
  return jsonb_build_object('ok', true, 'loja', v_loja, 'data', v_data, 'itens', n, 'receita', v_rec);
end $$;
grant execute on function importar_vendas_dia(jsonb) to authenticated;
