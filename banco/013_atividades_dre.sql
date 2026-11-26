-- =====================================================================
-- Notificações (atividades) e agrupamento do DRE
-- =====================================================================

-- ---------- DRE: cada categoria financeira cai num grupo do DRE ----------
alter table categorias_financeiras add column if not exists grupo_dre text;
update categorias_financeiras set grupo_dre = case
  when tipo = 'RECEITA' then 'RECEITA'
  when upper(nome) like 'IMPOSTO%' then 'DEDUCOES'
  when upper(nome) in ('FORNECEDOR', 'INSUMO', 'MATERIA PRIMA', 'MATÉRIA-PRIMA') then 'CMV'
  when upper(nome) like 'FUNCION%' or upper(nome) like 'FOLHA%' then 'PESSOAL'
  when upper(nome) like 'PRO%LABORE' then 'PROLABORE'
  when upper(nome) like 'EMPR%STIMO%' or upper(nome) like 'DESPESA BANC%' or upper(nome) like 'JUROS%' then 'FINANCEIRO'
  when upper(nome) like 'AQUISI%' or upper(nome) like 'INVESTIMENTO%' then 'INVESTIMENTOS'
  else 'OPERACIONAL' end
where grupo_dre is null;

-- ---------- Atividades (o que cada pessoa fez) ----------
create table if not exists atividades (
  id         bigint generated always as identity primary key,
  criado_em  timestamptz not null default now(),
  modulo     text not null,
  loja       text,
  autor      text,
  titulo     text not null,
  detalhe    text,
  link       text,
  nivel      text not null default 'info'      -- info | atencao | alerta
);
create index if not exists atividades_data on atividades (criado_em desc);
alter table atividades enable row level security;
drop policy if exists ler on atividades;
create policy ler on atividades for select to authenticated using (posso(modulo));

create table if not exists atividades_leitura (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  lido_ate timestamptz not null default now()
);
alter table atividades_leitura enable row level security;
drop policy if exists proprio on atividades_leitura;
create policy proprio on atividades_leitura for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function _lojanome(l text) returns text language sql immutable as $$
  select case l when 'VILLA' then 'Villa' when 'SOUZA_CRUZ' then 'Souza Cruz' else coalesce(l, '') end;
$$;
create or replace function _quem() returns text language sql stable security definer set search_path = public as $$
  select nome from perfis where user_id = auth.uid();
$$;
create or replace function _brl(v numeric) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v,0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

-- Junta num aviso só tudo o que chega no mesmo envio (mesma transação)
alter table atividades add column if not exists n_itens int not null default 0;
alter table atividades add column if not exists total numeric(14,2);
alter table atividades add column if not exists itens text[] not null default '{}';
create or replace function _atv_somar(p_modulo text, p_loja text, p_autor text, p_titulo text, p_itens text[], p_total numeric, p_link text, p_nivel text default 'info')
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_total numeric; v_itens text[]; v_n int;
begin
  select id into v_id from atividades where criado_em = now() and modulo = p_modulo and titulo = p_titulo
     and coalesce(loja,'') = coalesce(p_loja,'') and coalesce(autor,'') = coalesce(p_autor,'') limit 1;
  if v_id is null then
    insert into atividades (modulo, loja, autor, titulo, itens, n_itens, total, link, nivel)
    values (p_modulo, p_loja, p_autor, p_titulo, p_itens, coalesce(array_length(p_itens, 1), 0), p_total, p_link, p_nivel) returning id into v_id;
  else
    update atividades set itens = itens || p_itens, n_itens = n_itens + coalesce(array_length(p_itens, 1), 0),
      total = case when p_total is null then total else coalesce(total, 0) + p_total end,
      nivel = case when p_nivel = 'alerta' or nivel = 'alerta' then 'alerta' when p_nivel = 'atencao' or nivel = 'atencao' then 'atencao' else 'info' end
    where id = v_id;
  end if;
  select total, itens, n_itens into v_total, v_itens, v_n from atividades where id = v_id;
  update atividades set detalhe = concat_ws(' · ', v_n || ' item(ns)', case when v_total is not null then _brl(v_total) end,
      array_to_string(v_itens[1:8], ', ') || case when v_n > 8 then '…' else '' end) where id = v_id;
  if p_modulo = 'desperdicio' then
    update atividades set nivel = case when v_total >= 100 then 'alerta' when v_total >= 30 then 'atencao' else 'info' end where id = v_id;
  end if;
end $$;

-- Produção (um aviso por envio do formulário)
create or replace function _atv_producao() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select loja, responsavel, sum(valor) v, array_agg(quantidade::int || 'x ' || produto_nome) its from novos group by loja, responsavel loop
    perform _atv_somar('producao', r.loja, r.responsavel, 'Produção registrada', r.its, r.v, '/gestao/operacao/producao');
  end loop;
  return null;
end $$;
drop trigger if exists atv_producao on producao_registros;
create trigger atv_producao after insert on producao_registros referencing new table as novos for each statement execute function _atv_producao();

-- Desperdício
create or replace function _atv_desperdicio() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select loja, responsavel, origem, sum(valor) v, array_agg(quantidade::numeric(10,1) || ' ' || item_nome || coalesce(' – ' || motivo, '')) its
           from novos group by loja, responsavel, origem loop
    perform _atv_somar('desperdicio', r.loja, r.responsavel, 'Desperdício (' || lower(r.origem) || ')', r.its, r.v, '/gestao/operacao/desperdicio',
                       case when r.v >= 100 then 'alerta' when r.v >= 30 then 'atencao' else 'info' end);
  end loop;
  return null;
end $$;
drop trigger if exists atv_desperdicio on desperdicio_registros;
create trigger atv_desperdicio after insert on desperdicio_registros referencing new table as novos for each statement execute function _atv_desperdicio();

-- Relatório do balcão (só avisa quando houve falta ou observação)
create or replace function _atv_balcao() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel)
  select 'balcao', loja, responsavel, case when teve_falta then 'Balcão: faltou produto' else 'Relatório do balcão' end,
         concat_ws(' · ', case when teve_falta then 'Faltou: ' || coalesce(produtos_falta, '?') end, nullif(observacoes, '')), '/gestao/operacao/ambos',
         case when teve_falta then 'atencao' else 'info' end
  from novos;
  return null;
end $$;
drop trigger if exists atv_balcao on balcao_relatorios;
create trigger atv_balcao after insert on balcao_relatorios referencing new table as novos for each statement execute function _atv_balcao();

-- Estoque: entradas/saídas pelo formulário e contagens
create or replace function _atv_estoque() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select n.loja, max(n.responsavel) resp, n.origem, max(n.tipo) tipo, array_agg(i.nome order by i.nome) its
           from novos n join insumos i on i.id = n.insumo_id where n.origem in ('formulario', 'contagem') group by n.loja, n.origem loop
    perform _atv_somar('estoque', r.loja, r.resp, case r.origem when 'contagem' then 'Contagem de estoque' else 'Estoque: ' || lower(r.tipo) end, r.its, null, '/gestao/estoque');
  end loop;
  return null;
end $$;
drop trigger if exists atv_estoque on estoque_movimentos;
create trigger atv_estoque after insert on estoque_movimentos referencing new table as novos for each statement execute function _atv_estoque();

-- Lista de compras
create or replace function _atv_lista() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, loja, autor, titulo, detalhe, link)
  select 'compras', loja, pedido_por, 'Lista de compras', 'Adicionado: ' || item || coalesce(' (' || quantidade || ')', ''), '/lista' from novos;
  return null;
end $$;
drop trigger if exists atv_lista on lista_compras;
create trigger atv_lista after insert on lista_compras referencing new table as novos for each statement execute function _atv_lista();

-- Notas fiscais
create or replace function _atv_nota() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, loja, autor, titulo, detalhe, link)
  values ('notas', new.loja, coalesce(_quem(), case new.origem when 'email' then 'E-mail (automático)' else null end),
          'Nota fiscal recebida', (select nome from fornecedores where id = new.fornecedor_id) || ' · NF ' || coalesce(new.numero, '') || ' · ' || _brl(new.valor_total),
          '/gestao/notas');
  return new;
end $$;
drop trigger if exists atv_nota on notas_fiscais;
create trigger atv_nota after insert on notas_fiscais for each row execute function _atv_nota();

-- Pedidos de compra: enviado, recebido, cancelado
create or replace function _atv_pedido() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('ENVIADO', 'RECEBIDO', 'RECEBIDO_PARCIAL', 'CANCELADO') then
    insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel)
    values ('compras', new.loja, _quem(), 'Pedido ' || coalesce(new.numero, new.id::text) || ' ' ||
            case new.status when 'ENVIADO' then 'enviado' when 'RECEBIDO' then 'recebido' when 'RECEBIDO_PARCIAL' then 'recebido parcialmente' else 'cancelado' end,
            (select nome from fornecedores where id = new.fornecedor_id) || coalesce(' · ' || _brl(new.valor_previsto), '') || case when new.emergencial then ' · EMERGENCIAL' else '' end,
            '/gestao/compras/pedidos', case when new.emergencial then 'atencao' else 'info' end);
  end if;
  return new;
end $$;
drop trigger if exists atv_pedido on pedidos_compra;
create trigger atv_pedido after update on pedidos_compra for each row execute function _atv_pedido();

-- Lançamentos financeiros feitos no sistema (não os automáticos de nota/compra)
create or replace function _atv_lancamento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, loja, autor, titulo, detalhe, link)
  select 'financeiro', max(loja), _quem(), case max(tipo) when 'RECEITA' then 'Receita lançada' else 'Despesa lançada' end,
         max(regexp_replace(descricao, ' \(\d+/\d+\)$', '')) || ' · ' || _brl(sum(valor)) || case when count(*) > 1 then ' em ' || count(*) || ' parcelas' else '' end,
         '/gestao/lancamentos'
  from novos where origem = 'sistema' group by regexp_replace(descricao, ' \(\d+/\d+\)$', '') having count(*) > 0;
  return null;
end $$;
drop trigger if exists atv_lancamento on lancamentos;
create trigger atv_lancamento after insert on lancamentos referencing new table as novos for each statement execute function _atv_lancamento();

-- Gestão de pessoas: ocorrências
create or replace function _atv_ocorrencia() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, autor, loja, titulo, detalhe, link, nivel)
  select 'rh', _quem(), f.loja, 'Ocorrência: ' || lower(n.tipo), f.nome || coalesce(' · ' || n.descricao, ''), '/gestao/pessoas/ocorrencias',
         case when n.tipo in ('Advertência', 'Suspensão', 'Falta') then 'atencao' else 'info' end
  from novos n join funcionarios f on f.id = n.funcionario_id;
  return null;
end $$;
drop trigger if exists atv_ocorrencia on ocorrencias;
create trigger atv_ocorrencia after insert on ocorrencias referencing new table as novos for each statement execute function _atv_ocorrencia();

-- Denúncia nova (sem detalhes: o conteúdo fica só na tela de denúncias)
create or replace function _atv_denuncia() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, titulo, detalhe, link, nivel)
  values ('denuncias', 'Nova denúncia recebida', 'Protocolo ' || new.protocolo || ' · gravidade ' || coalesce(new.gravidade, '—'), '/gestao/denuncias', 'alerta');
  return new;
end $$;
drop trigger if exists atv_denuncia on denuncias;
create trigger atv_denuncia after insert on denuncias for each row execute function _atv_denuncia();

-- Conta nova esperando liberação
create or replace function _atv_usuario() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from perfis) then
    insert into atividades (modulo, titulo, detalhe, link, nivel)
    values ('config', 'Conta nova aguardando liberação', new.email, '/gestao/config', 'atencao');
  end if;
  return new;
end $$;
drop trigger if exists atv_usuario on auth.users;
create trigger atv_usuario after insert on auth.users for each row execute function _atv_usuario();

-- Avisos em tempo real no app
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table atividades'; exception when duplicate_object then null; end;
  end if;
end $$;
