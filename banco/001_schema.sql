-- =====================================================================
-- PEDACITO ERP · Esquema do banco (Supabase / Postgres)
-- Rodar inteiro no SQL Editor do Supabase. Pode rodar de novo sem quebrar.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- 1. ACESSO: funções (cargos), permissões por módulo e perfis de usuário
-- ---------------------------------------------------------------------
-- Módulos do sistema (usados nas permissões):
--   dashboard, estoque, desperdicio, producao, balcao, compras, notas,
--   financeiro, faturamento, fichas, encomendas, cadastros, rh, denuncias, config

create table if not exists funcoes (
  id          text primary key,              -- ex.: 'admin', 'lider', 'producao'
  nome        text not null,
  descricao   text,
  criado_em   timestamptz not null default now()
);

create table if not exists funcao_permissoes (
  funcao_id   text not null references funcoes(id) on delete cascade,
  modulo      text not null,
  ver         boolean not null default true,
  editar      boolean not null default false,
  primary key (funcao_id, modulo)
);

create table if not exists perfis (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text unique,
  funcao_id   text not null references funcoes(id),
  lojas       text[] not null default array['VILLA','SOUZA_CRUZ'],
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Funções auxiliares usadas pelas regras de segurança (RLS)
create or replace function eu_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where user_id = auth.uid() and ativo and funcao_id = 'admin');
$$;

create or replace function posso(p_modulo text, p_editar boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select eu_admin() or exists (
    select 1 from perfis pf
    join funcao_permissoes fp on fp.funcao_id = pf.funcao_id
    where pf.user_id = auth.uid() and pf.ativo
      and fp.modulo = p_modulo
      and (fp.ver or fp.editar)
      and (not p_editar or fp.editar)
  );
$$;

-- ---------------------------------------------------------------------
-- 2. CADASTROS BÁSICOS
-- ---------------------------------------------------------------------
create table if not exists lojas (
  id    text primary key,          -- 'VILLA', 'SOUZA_CRUZ'
  nome  text not null
);

create table if not exists fornecedores (
  id            bigint generated always as identity primary key,
  nome          text not null,
  cnpj          text unique,
  telefone      text,
  contato       text,
  prazo_pagto   text,               -- ex.: '28 dias', 'semanal (segunda, PIX)'
  observacao    text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table if not exists insumos (
  id                bigint generated always as identity primary key,
  nome              text not null unique,
  categoria         text,
  unidade           text not null,          -- unidade de controle: g, ml, un, kg...
  estoque_minimo    numeric(14,3) not null default 0,
  custo_unitario    numeric(14,4),          -- custo de referência por unidade
  custo_atualizado  timestamptz,
  fornecedor_pref   bigint references fornecedores(id),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);

-- Como cada fornecedor escreve o item na nota → qual insumo é, e o fator de conversão
create table if not exists insumo_correspondencia (
  id             bigint generated always as identity primary key,
  fornecedor_id  bigint references fornecedores(id),
  nome_na_nota   text not null,
  insumo_id      bigint not null references insumos(id),
  fator          numeric(14,4) not null default 1,   -- 1 unidade da nota = fator × unidade do insumo
  unique (fornecedor_id, nome_na_nota)
);

-- Produtos de venda (o que sai no balcão / Raffinato / Goomer)
create table if not exists produtos (
  id                bigint generated always as identity primary key,
  nome              text not null unique,
  tipo              text not null,       -- Doce, Salgado, Bebida, Bolo Inteiro, Cuca Inteira, Evento...
  preco             numeric(12,2),
  codigo_raffinato  text,
  ativo_villa       boolean not null default true,
  ativo_souza       boolean not null default true,
  e_evento          boolean not null default false,   -- mini croissant, mini ciabatta, mini brownie...
  unidade_venda     text default 'un',                -- un, cento, kg, fatia
  criado_em         timestamptz not null default now()
);

-- Fichas técnicas: produto ← insumos (ou outro produto, ex.: massa base)
create table if not exists fichas_tecnicas (
  produto_id   bigint primary key references produtos(id) on delete cascade,
  rendimento   numeric(12,3) not null default 1,     -- quantas unidades de venda a receita rende
  modo_preparo text,
  atualizado_em timestamptz not null default now()
);

create table if not exists ficha_itens (
  id            bigint generated always as identity primary key,
  produto_id    bigint not null references fichas_tecnicas(produto_id) on delete cascade,
  insumo_id     bigint references insumos(id),
  subproduto_id bigint references produtos(id),
  quantidade    numeric(14,4) not null,
  check ((insumo_id is null) <> (subproduto_id is null))
);

-- ---------------------------------------------------------------------
-- 3. ESTOQUE
-- ---------------------------------------------------------------------
create table if not exists estoque_movimentos (
  id            bigint generated always as identity primary key,
  data          date not null default current_date,
  loja          text not null references lojas(id),
  insumo_id     bigint not null references insumos(id),
  tipo          text not null check (tipo in ('ENTRADA','SAIDA','PERDA','AJUSTE','TRANSFERENCIA')),
  quantidade    numeric(14,3) not null,      -- sempre positiva; o tipo diz o sinal (AJUSTE pode ser ±)
  custo_unit    numeric(14,4),
  origem        text,                        -- 'nota', 'contagem', 'producao', 'manual', 'legado'
  origem_id     bigint,
  observacao    text,
  responsavel   text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now()
);
create index if not exists estoque_mov_insumo on estoque_movimentos (insumo_id, loja);

create or replace view estoque_saldo with (security_invoker = true) as
select i.id as insumo_id, i.nome, i.categoria, i.unidade, l.id as loja,
       coalesce(sum(case m.tipo
            when 'ENTRADA' then m.quantidade
            when 'AJUSTE'  then m.quantidade
            else -m.quantidade end), 0) as saldo,
       i.estoque_minimo, i.custo_unitario,
       case
         when coalesce(sum(case m.tipo when 'ENTRADA' then m.quantidade when 'AJUSTE' then m.quantidade else -m.quantidade end),0) <= 0 then 'ZERADO'
         when coalesce(sum(case m.tipo when 'ENTRADA' then m.quantidade when 'AJUSTE' then m.quantidade else -m.quantidade end),0) <= i.estoque_minimo then 'CRITICO'
         else 'OK' end as status
from insumos i
cross join lojas l
left join estoque_movimentos m on m.insumo_id = i.id and m.loja = l.id
where i.ativo
group by i.id, l.id;

-- Contagem de estoque (inventário) — gera AJUSTES ao ser fechada
create table if not exists contagens (
  id           bigint generated always as identity primary key,
  data         date not null default current_date,
  loja         text not null references lojas(id),
  responsavel  text,
  status       text not null default 'ABERTA' check (status in ('ABERTA','FECHADA')),
  criado_em    timestamptz not null default now()
);
create table if not exists contagem_itens (
  contagem_id  bigint not null references contagens(id) on delete cascade,
  insumo_id    bigint not null references insumos(id),
  quantidade   numeric(14,3) not null,
  primary key (contagem_id, insumo_id)
);

-- ---------------------------------------------------------------------
-- 4. OPERAÇÃO: produção, desperdício, relatório do balcão, lista de compras
-- ---------------------------------------------------------------------
create table if not exists producao_registros (
  id           bigint generated always as identity primary key,
  data         date not null,
  loja         text not null references lojas(id),
  turno        text,
  responsavel  text,
  produto_id   bigint references produtos(id),
  produto_nome text not null,
  tipo         text,
  quantidade   numeric(12,3) not null,
  valor        numeric(12,2),
  observacao   text,
  criado_em    timestamptz not null default now()
);

create table if not exists desperdicio_registros (
  id           bigint generated always as identity primary key,
  origem       text not null check (origem in ('COZINHA','BALCAO')),
  data         date not null,
  loja         text not null references lojas(id),
  turno        text,
  responsavel  text,
  produto_id   bigint references produtos(id),
  insumo_id    bigint references insumos(id),
  item_nome    text not null,
  tipo         text,
  quantidade   numeric(12,3) not null,
  motivo       text,
  valor        numeric(12,2),
  foto_url     text,
  criado_em    timestamptz not null default now()
);

create table if not exists balcao_relatorios (
  id               bigint generated always as identity primary key,
  data             date not null,
  loja             text not null references lojas(id),
  turno            text,
  responsavel      text,
  observacoes      text,
  teve_falta       boolean,
  produtos_falta   text,
  criado_em        timestamptz not null default now()
);

create table if not exists lista_compras (
  id           bigint generated always as identity primary key,
  loja         text references lojas(id),
  item         text not null,
  quantidade   text,
  pedido_por   text,
  comprado     boolean not null default false,
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. COMPRAS: pedido → recebimento/nota → estoque + contas a pagar
-- ---------------------------------------------------------------------
create table if not exists pedidos_compra (
  id             bigint generated always as identity primary key,
  loja           text not null references lojas(id),
  fornecedor_id  bigint references fornecedores(id),
  data_pedido    date not null default current_date,
  previsao       date,
  status         text not null default 'RASCUNHO'
                 check (status in ('RASCUNHO','ENVIADO','RECEBIDO_PARCIAL','RECEBIDO','CANCELADO')),
  emergencial    boolean not null default false,
  observacao     text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create table if not exists pedido_compra_itens (
  id            bigint generated always as identity primary key,
  pedido_id     bigint not null references pedidos_compra(id) on delete cascade,
  insumo_id     bigint not null references insumos(id),
  quantidade    numeric(14,3) not null,
  preco_previsto numeric(14,4)
);

create table if not exists notas_fiscais (
  id             bigint generated always as identity primary key,
  loja           text not null references lojas(id),
  fornecedor_id  bigint references fornecedores(id),
  pedido_id      bigint references pedidos_compra(id),
  numero         text,
  chave_acesso   text unique,
  data_emissao   date,
  data_entrada   date not null default current_date,
  valor_total    numeric(12,2) not null,
  tipo_doc       text not null default 'NF-e' check (tipo_doc in ('NF-e','ROMANEIO','PEDIDO','RECIBO')),
  arquivo_url    text,
  lancada_raffinato boolean not null default false,
  observacao     text,
  criado_em      timestamptz not null default now()
);
create table if not exists nota_itens (
  id            bigint generated always as identity primary key,
  nota_id       bigint not null references notas_fiscais(id) on delete cascade,
  descricao     text not null,          -- como veio na nota
  insumo_id     bigint references insumos(id),
  quantidade    numeric(14,3) not null,
  unidade       text,
  valor_unit    numeric(14,4),
  valor_total   numeric(12,2)
);

-- ---------------------------------------------------------------------
-- 6. FINANCEIRO
-- ---------------------------------------------------------------------
create table if not exists contas_bancarias (
  id     bigint generated always as identity primary key,
  nome   text not null unique,          -- Viacredi, Sicoob, Caixa...
  ativo  boolean not null default true
);

create table if not exists lancamentos (
  id              bigint generated always as identity primary key,
  loja            text references lojas(id),        -- null = grupo
  tipo            text not null check (tipo in ('RECEITA','DESPESA')),
  categoria       text not null,
  subcategoria    text,
  descricao       text not null,
  fornecedor_id   bigint references fornecedores(id),
  nota_id         bigint references notas_fiscais(id),
  valor           numeric(12,2) not null,
  competencia     date,
  vencimento      date not null,
  pagamento       date,
  status          text not null default 'PENDENTE' check (status in ('PREVISTO','PENDENTE','PAGO','CANCELADO')),
  forma_pagamento text,
  conta_id        bigint references contas_bancarias(id),
  parcela         text,                              -- '2/3'
  origem          text default 'manual',             -- manual, nota, legado, raffinato
  criado_em       timestamptz not null default now()
);
create index if not exists lanc_venc on lancamentos (vencimento);

create table if not exists emprestimos (
  id               bigint generated always as identity primary key,
  nome             text not null,
  credor           text,
  valor_total      numeric(12,2),
  valor_parcela    numeric(12,2),
  n_parcelas       int,
  parcelas_pagas   int default 0,
  data_inicio      date,
  data_fim         date,
  status           text default 'ATIVO'
);

create table if not exists funcionarios (
  id            bigint generated always as identity primary key,
  nome          text not null,
  loja          text references lojas(id),
  cargo         text,
  salario       numeric(12,2),
  tipo          text,                -- CLT, PJ, diarista...
  custo_mensal  numeric(12,2),
  ativo         boolean not null default true
);

-- Faturamento: vendas por dia/produto importadas do Raffinato
create table if not exists vendas (
  id            bigint generated always as identity primary key,
  data          date not null,
  loja          text not null references lojas(id),
  produto_id    bigint references produtos(id),
  produto_nome  text not null,
  codigo_raffinato text,
  quantidade    numeric(12,3) not null,
  valor_total   numeric(12,2) not null,
  importacao_id text,
  criado_em     timestamptz not null default now()
);
create index if not exists vendas_data on vendas (data, loja);

-- ---------------------------------------------------------------------
-- 7. ENCOMENDAS: bolos decorados e eventos (mini croissant, ciabatta, brownie...)
-- ---------------------------------------------------------------------
create table if not exists encomendas (
  id              bigint generated always as identity primary key,
  numero          text unique,
  tipo            text not null check (tipo in ('BOLO','EVENTO','OUTRO')),
  loja            text not null references lojas(id),
  cliente_nome    text not null,
  cliente_fone    text,
  data_entrega    date not null,
  hora_entrega    text,
  entrega_tipo    text default 'RETIRADA',       -- RETIRADA / ENTREGA
  endereco        text,
  detalhes        jsonb not null default '{}',   -- massa, recheio, cobertura, tema, tamanho...
  total           numeric(12,2) not null default 0,
  sinal           numeric(12,2) not null default 0,
  status          text not null default 'CONFIRMADO'
                  check (status in ('ORCAMENTO','CONFIRMADO','EM_PRODUCAO','PRONTO','ENTREGUE','CANCELADO')),
  observacao      text,
  atendente       text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);
create table if not exists encomenda_itens (
  id            bigint generated always as identity primary key,
  encomenda_id  bigint not null references encomendas(id) on delete cascade,
  produto_id    bigint references produtos(id),
  descricao     text not null,
  quantidade    numeric(12,3) not null,
  preco_unit    numeric(12,2) not null default 0
);

-- ---------------------------------------------------------------------
-- 8. DENÚNCIAS (canal confidencial)
-- ---------------------------------------------------------------------
create table if not exists denuncias (
  id           bigint generated always as identity primary key,
  protocolo    text unique not null,
  tipo         text,
  categoria    text,
  descricao    text not null,
  envolvidos   text,
  data_fato    date,
  loja         text,
  anonima      boolean not null default true,
  contato      text,
  gravidade    text,
  status       text not null default 'NOVA',
  notas_admin  text,
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. CONFIGURAÇÕES (ex.: código da equipe para os formulários)
-- ---------------------------------------------------------------------
create table if not exists config (
  chave  text primary key,
  valor  jsonb not null
);

-- ---------------------------------------------------------------------
-- 10. SEGURANÇA (RLS): cada tabela só abre para quem tem o módulo
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('fornecedores','cadastros'), ('insumos','cadastros'), ('insumo_correspondencia','cadastros'),
    ('produtos','cadastros'), ('fichas_tecnicas','fichas'), ('ficha_itens','fichas'),
    ('estoque_movimentos','estoque'), ('contagens','estoque'), ('contagem_itens','estoque'),
    ('producao_registros','producao'), ('desperdicio_registros','desperdicio'),
    ('balcao_relatorios','balcao'), ('lista_compras','compras'),
    ('pedidos_compra','compras'), ('pedido_compra_itens','compras'),
    ('notas_fiscais','notas'), ('nota_itens','notas'),
    ('contas_bancarias','financeiro'), ('lancamentos','financeiro'), ('emprestimos','financeiro'),
    ('funcionarios','rh'), ('vendas','faturamento'),
    ('encomendas','encomendas'), ('encomenda_itens','encomendas'),
    ('denuncias','denuncias'), ('config','config')
  ) as t(tabela, modulo)
  loop
    execute format('alter table %I enable row level security', r.tabela);
    execute format('drop policy if exists ler on %I', r.tabela);
    execute format('drop policy if exists gravar on %I', r.tabela);
    execute format('create policy ler on %I for select to authenticated using (posso(%L))', r.tabela, r.modulo);
    execute format('create policy gravar on %I for all to authenticated using (posso(%L, true)) with check (posso(%L, true))', r.tabela, r.modulo, r.modulo);
  end loop;
end $$;

-- Lojas, funções e permissões podem ser lidas por quem está logado
alter table lojas enable row level security;
drop policy if exists ler on lojas;
create policy ler on lojas for select to authenticated using (true);
drop policy if exists gravar on lojas;
create policy gravar on lojas for all to authenticated using (eu_admin()) with check (eu_admin());

alter table funcoes enable row level security;
drop policy if exists ler on funcoes;
create policy ler on funcoes for select to authenticated using (true);
drop policy if exists gravar on funcoes;
create policy gravar on funcoes for all to authenticated using (eu_admin()) with check (eu_admin());

alter table funcao_permissoes enable row level security;
drop policy if exists ler on funcao_permissoes;
create policy ler on funcao_permissoes for select to authenticated using (true);
drop policy if exists gravar on funcao_permissoes;
create policy gravar on funcao_permissoes for all to authenticated using (eu_admin()) with check (eu_admin());

alter table perfis enable row level security;
drop policy if exists ler on perfis;
create policy ler on perfis for select to authenticated using (user_id = auth.uid() or eu_admin());
drop policy if exists gravar on perfis;
create policy gravar on perfis for all to authenticated using (eu_admin()) with check (eu_admin());

-- ---------------------------------------------------------------------
-- 11. DADOS INICIAIS
-- ---------------------------------------------------------------------
insert into lojas (id, nome) values ('VILLA','Villa Schlosser'), ('SOUZA_CRUZ','Souza Cruz')
on conflict (id) do nothing;

insert into funcoes (id, nome, descricao) values
  ('admin', 'Administrador', 'Acesso total (sócios)')
on conflict (id) do nothing;
-- As demais funções (líder, produção, atendimento...) serão criadas depois pela tela de Configurações.

insert into config (chave, valor) values ('codigo_equipe', '"000000"'::jsonb)
on conflict (chave) do nothing;
