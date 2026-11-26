-- =====================================================================
-- Módulos novos: contratos, compras completo, gestão de pessoas, categorias financeiras.
-- =====================================================================

-- ---------- Financeiro: categorias padronizadas ----------
create table if not exists categorias_financeiras (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('RECEITA','DESPESA')),
  nome       text not null,
  subcategorias text[] not null default '{}',
  ativo      boolean not null default true,
  unique (tipo, nome)
);
insert into categorias_financeiras (tipo, nome, subcategorias)
select tipo, categoria, coalesce(array_agg(distinct subcategoria) filter (where subcategoria is not null), '{}')
from lancamentos group by tipo, categoria
on conflict (tipo, nome) do nothing;
alter table lancamentos add column if not exists observacao text;
alter table lancamentos add column if not exists criado_por uuid default auth.uid();
alter table lancamentos add column if not exists contrato_id bigint;

-- ---------- Contratos ----------
create table if not exists contratos (
  id             bigint generated always as identity primary key,
  titulo         text not null,
  tipo           text not null default 'Fornecedor',   -- Fornecedor, Cliente, Funcionário, Aluguel, Empréstimo, Serviço, Sociedade, Outro
  parte          text,                                 -- com quem é o contrato
  empresa        text,                                 -- qual CNPJ/loja da Pedacito assina
  numero         text,
  data_assinatura date,
  data_inicio    date,
  data_fim       date,
  valor          numeric(14,2),
  periodicidade  text,                                 -- Único, Mensal, Anual...
  renovacao_auto boolean not null default false,
  aviso_dias     int not null default 30,
  status         text not null default 'Vigente',      -- Vigente, A vencer, Encerrado, Rascunho
  fornecedor_id  bigint references fornecedores(id),
  funcionario_id bigint references funcionarios(id),
  arquivo_path   text,
  arquivo_nome   text,
  observacao     text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);

-- ---------- Compras ----------
alter table fornecedores add column if not exists categoria text;
alter table fornecedores add column if not exists email text;
alter table fornecedores add column if not exists whatsapp text;
alter table fornecedores add column if not exists dias_entrega text;       -- ex.: seg, qua, sex
alter table fornecedores add column if not exists pedido_minimo numeric(12,2);
alter table fornecedores add column if not exists forma_pagto text;
alter table fornecedores add column if not exists pix text;
alter table fornecedores add column if not exists avaliacao int check (avaliacao between 1 and 5);

alter table pedidos_compra add column if not exists numero text;
alter table pedidos_compra add column if not exists valor_previsto numeric(12,2);
alter table pedidos_compra add column if not exists recebido_em timestamptz;
alter table pedidos_compra add column if not exists recebido_por text;
alter table pedido_compra_itens add column if not exists qtd_recebida numeric(14,3);
alter table pedido_compra_itens add column if not exists preco_real numeric(14,4);

create table if not exists cotacoes (
  id             bigint generated always as identity primary key,
  insumo_id      bigint not null references insumos(id) on delete cascade,
  fornecedor_id  bigint not null references fornecedores(id) on delete cascade,
  preco          numeric(14,4) not null,
  unidade        text,
  data           date not null default current_date,
  validade       date,
  observacao     text,
  criado_em      timestamptz not null default now()
);
create index if not exists cotacoes_insumo on cotacoes (insumo_id, data desc);

-- Histórico de preços: entradas de estoque + cotações
create or replace view precos_historico with (security_invoker = true) as
  select m.insumo_id, m.data, m.custo_unit as preco, null::bigint as fornecedor_id, 'compra' as origem
  from estoque_movimentos m where m.tipo = 'ENTRADA' and m.custo_unit is not null
  union all
  select c.insumo_id, c.data, c.preco, c.fornecedor_id, 'cotacao' from cotacoes c;

-- Receber um pedido: dá entrada no estoque, atualiza custo e gera contas a pagar
create or replace function receber_pedido(p_pedido bigint, p_itens jsonb, p_nf text, p_parcelas jsonb, p_forma text, p_conta bigint, p_responsavel text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ped pedidos_compra; it jsonb; total numeric := 0; parc jsonb; i int := 0; n int; forn text; v_nota bigint;
begin
  if not posso('compras', true) then raise exception 'Sem permissão para compras'; end if;
  select * into ped from pedidos_compra where id = p_pedido for update;
  if ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if ped.status in ('RECEBIDO','CANCELADO') then raise exception 'Pedido já %', lower(ped.status); end if;
  select nome into forn from fornecedores where id = ped.fornecedor_id;

  insert into notas_fiscais (loja, fornecedor_id, pedido_id, numero, data_entrada, valor_total, tipo_doc)
  values (ped.loja, ped.fornecedor_id, ped.id, nullif(p_nf,''), current_date, 0, case when coalesce(p_nf,'') = '' then 'PEDIDO' else 'NF-e' end)
  returning id into v_nota;

  for it in select * from jsonb_array_elements(p_itens) loop
    continue when coalesce((it->>'qtd')::numeric, 0) <= 0;
    update pedido_compra_itens set qtd_recebida = (it->>'qtd')::numeric, preco_real = (it->>'preco')::numeric
     where id = (it->>'item_id')::bigint and pedido_id = ped.id;
    insert into estoque_movimentos (data, loja, insumo_id, tipo, quantidade, custo_unit, origem, origem_id, responsavel, observacao)
    select current_date, ped.loja, pi.insumo_id, 'ENTRADA', (it->>'qtd')::numeric, (it->>'preco')::numeric, 'pedido', ped.id, p_responsavel,
           'Pedido ' || coalesce(ped.numero, ped.id::text)
    from pedido_compra_itens pi where pi.id = (it->>'item_id')::bigint;
    insert into nota_itens (nota_id, descricao, insumo_id, quantidade, valor_unit, valor_total)
    select v_nota, i2.nome, pi.insumo_id, (it->>'qtd')::numeric, (it->>'preco')::numeric, round((it->>'qtd')::numeric * (it->>'preco')::numeric, 2)
    from pedido_compra_itens pi join insumos i2 on i2.id = pi.insumo_id where pi.id = (it->>'item_id')::bigint;
    update insumos set custo_unitario = (it->>'preco')::numeric, custo_atualizado = now()
     where id = (select insumo_id from pedido_compra_itens where id = (it->>'item_id')::bigint) and (it->>'preco')::numeric > 0;
    total := total + (it->>'qtd')::numeric * coalesce((it->>'preco')::numeric, 0);
  end loop;
  update notas_fiscais set valor_total = round(total, 2) where id = v_nota;

  n := jsonb_array_length(coalesce(p_parcelas, '[]'));
  for parc in select * from jsonb_array_elements(coalesce(p_parcelas, '[]')) loop
    i := i + 1;
    insert into lancamentos (loja, tipo, categoria, subcategoria, descricao, fornecedor_id, nota_id, valor, competencia, vencimento,
                             status, forma_pagamento, conta_id, parcela, origem, pagamento)
    values (ped.loja, 'DESPESA', 'FORNECEDOR', 'INSUMO', upper(coalesce(forn, 'FORNECEDOR')) || case when n > 1 then format(' (%s/%s)', i, n) else '' end,
            ped.fornecedor_id, v_nota, (parc->>'valor')::numeric, current_date, (parc->>'vencimento')::date,
            case when (parc->>'pago')::boolean then 'PAGO' else 'PENDENTE' end, p_forma, p_conta, format('%s/%s', i, n), 'compras',
            case when (parc->>'pago')::boolean then current_date end);
  end loop;

  update pedidos_compra set status = case when exists (
      select 1 from pedido_compra_itens where pedido_id = ped.id and coalesce(qtd_recebida,0) < quantidade) then 'RECEBIDO_PARCIAL' else 'RECEBIDO' end,
    recebido_em = now(), recebido_por = p_responsavel where id = ped.id;
  return jsonb_build_object('ok', true, 'total', round(total,2), 'parcelas', i, 'nota_id', v_nota);
end $$;
grant execute on function receber_pedido(bigint,jsonb,text,jsonb,text,bigint,text) to authenticated;

-- ---------- Gestão de pessoas ----------
alter table funcionarios add column if not exists telefone text;
alter table funcionarios add column if not exists email text;
alter table funcionarios add column if not exists data_nascimento date;
alter table funcionarios add column if not exists data_admissao date;
alter table funcionarios add column if not exists data_demissao date;
alter table funcionarios add column if not exists turno text;
alter table funcionarios add column if not exists carga_horaria text;
alter table funcionarios add column if not exists vale_transporte numeric(10,2);
alter table funcionarios add column if not exists outros_beneficios numeric(10,2);
alter table funcionarios add column if not exists observacao text;
alter table funcionarios add column if not exists criado_em timestamptz default now();

create table if not exists ocorrencias (
  id             bigint generated always as identity primary key,
  funcionario_id bigint not null references funcionarios(id) on delete cascade,
  data           date not null default current_date,
  tipo           text not null,          -- Falta, Atraso, Atestado, Advertência, Suspensão, Elogio, Feedback, Treinamento, Outro
  descricao      text,
  dias           numeric(5,1),
  registrado_por text,
  arquivo_path   text,
  arquivo_nome   text,
  criado_em      timestamptz not null default now()
);

create table if not exists ferias (
  id             bigint generated always as identity primary key,
  funcionario_id bigint not null references funcionarios(id) on delete cascade,
  periodo_aquisitivo text,
  inicio         date not null,
  fim            date not null,
  status         text not null default 'Programada',   -- Programada, Em andamento, Concluída, Cancelada
  observacao     text
);

create table if not exists documentos_pessoas (
  id             bigint generated always as identity primary key,
  funcionario_id bigint not null references funcionarios(id) on delete cascade,
  tipo           text not null,          -- Contrato de trabalho, RG/CPF, ASO, Certificado, Termo, Outro
  titulo         text,
  validade       date,
  arquivo_path   text not null,
  arquivo_nome   text,
  criado_em      timestamptz not null default now()
);

-- ---------- Segurança dos módulos novos ----------
do $$
declare r record;
begin
  for r in select * from (values
    ('categorias_financeiras','financeiro'), ('contratos','contratos'), ('cotacoes','compras'),
    ('ocorrencias','rh'), ('ferias','rh'), ('documentos_pessoas','rh')
  ) as t(tabela, modulo)
  loop
    execute format('alter table %I enable row level security', r.tabela);
    execute format('drop policy if exists ler on %I', r.tabela);
    execute format('drop policy if exists gravar on %I', r.tabela);
    execute format('create policy ler on %I for select to authenticated using (posso(%L))', r.tabela, r.modulo);
    execute format('create policy gravar on %I for all to authenticated using (posso(%L, true)) with check (posso(%L, true))', r.tabela, r.modulo, r.modulo);
  end loop;
end $$;

-- ---------- Arquivos (contratos e documentos de pessoas): privados ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('contratos', 'contratos', false, 20971520), ('pessoas', 'pessoas', false, 20971520)
on conflict (id) do nothing;

drop policy if exists contratos_ler on storage.objects;
drop policy if exists contratos_gravar on storage.objects;
drop policy if exists contratos_apagar on storage.objects;
drop policy if exists pessoas_ler on storage.objects;
drop policy if exists pessoas_gravar on storage.objects;
drop policy if exists pessoas_apagar on storage.objects;
create policy contratos_ler on storage.objects for select to authenticated using (bucket_id = 'contratos' and public.posso('contratos'));
create policy contratos_gravar on storage.objects for insert to authenticated with check (bucket_id = 'contratos' and public.posso('contratos', true));
create policy contratos_apagar on storage.objects for delete to authenticated using (bucket_id = 'contratos' and public.posso('contratos', true));
create policy pessoas_ler on storage.objects for select to authenticated using (bucket_id = 'pessoas' and public.posso('rh'));
create policy pessoas_gravar on storage.objects for insert to authenticated with check (bucket_id = 'pessoas' and public.posso('rh', true));
create policy pessoas_apagar on storage.objects for delete to authenticated using (bucket_id = 'pessoas' and public.posso('rh', true));

select 'ok' as resultado, (select count(*) from categorias_financeiras) categorias, (select count(*) from storage.buckets where id in ('contratos','pessoas')) buckets;
