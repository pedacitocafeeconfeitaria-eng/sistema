-- 014: Encomendas (bolos decorados e eventos), formulário do balcão e agenda da cozinha.

-- Número sequencial legível: E-0001
create sequence if not exists encomendas_num;
create or replace function _encomenda_numero() returns trigger language plpgsql as $$
begin
  if new.numero is null then new.numero := 'E-' || lpad(nextval('encomendas_num')::text, 4, '0'); end if;
  return new;
end $$;
drop trigger if exists encomenda_numero on encomendas;
create trigger encomenda_numero before insert on encomendas for each row execute function _encomenda_numero();

alter table encomendas add column if not exists pago_total boolean not null default false;
alter table encomendas add column if not exists atualizado_em timestamptz not null default now();
create index if not exists encomendas_entrega on encomendas (data_entrega, loja);

-- Itens de evento (preço a definir no cadastro)
insert into produtos (nome, tipo, e_evento, unidade_venda, aparece_formularios, categoria_cardapio)
select x, 'Evento', true, 'cento', false, 'Eventos'
from unnest(array['Mini croissant','Mini ciabatta','Mini brownie']) x
where not exists (select 1 from produtos p where upper(p.nome) = upper(x));

-- Catálogo para o formulário: itens de evento e bolos inteiros
create or replace function form_catalogo_encomenda(p_codigo text)
returns table (id bigint, nome text, tipo text, preco numeric, unidade text, e_evento boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select p.id, p.nome, p.tipo, p.preco, p.unidade_venda, p.e_evento from produtos p
   where p.e_evento or p.tipo ilike 'bolo%' or p.tipo ilike 'cuca%' or p.tipo ilike 'torta%'
   order by p.e_evento desc, p.nome;
end $$;

-- Nova encomenda pelo balcão. p = {tipo, loja, cliente_nome, cliente_fone, data_entrega, hora_entrega,
--   entrega_tipo, endereco, detalhes{}, total, sinal, observacao, atendente, itens:[{produto_id?, descricao, quantidade, preco_unit}]}
create or replace function form_encomenda(p_codigo text, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_num text; it jsonb; v_total numeric := 0;
begin
  perform _codigo_ok(p_codigo);
  if coalesce(trim(p->>'cliente_nome'), '') = '' then raise exception 'Informe o nome do cliente'; end if;
  if (p->>'data_entrega') is null then raise exception 'Informe a data de entrega'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    v_total := v_total + coalesce((it->>'quantidade')::numeric, 0) * coalesce((it->>'preco_unit')::numeric, 0);
  end loop;
  insert into encomendas (tipo, loja, cliente_nome, cliente_fone, data_entrega, hora_entrega, entrega_tipo, endereco,
                          detalhes, total, sinal, status, observacao, atendente, criado_por)
  values (coalesce(upper(p->>'tipo'), 'BOLO'), _loja(p->>'loja'), trim(p->>'cliente_nome'), nullif(trim(p->>'cliente_fone'), ''),
          (p->>'data_entrega')::date, nullif(p->>'hora_entrega', ''), coalesce(p->>'entrega_tipo', 'RETIRADA'), nullif(p->>'endereco', ''),
          coalesce(p->'detalhes', '{}'), coalesce(nullif(p->>'total', '')::numeric, v_total), coalesce(nullif(p->>'sinal', '')::numeric, 0),
          case when upper(coalesce(p->>'status', '')) = 'ORCAMENTO' then 'ORCAMENTO' else 'CONFIRMADO' end,
          nullif(p->>'observacao', ''), nullif(trim(p->>'atendente'), ''), auth.uid())
  returning id, numero into v_id, v_num;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    insert into encomenda_itens (encomenda_id, produto_id, descricao, quantidade, preco_unit)
    values (v_id, nullif(it->>'produto_id', '')::bigint, it->>'descricao', (it->>'quantidade')::numeric, coalesce(nullif(it->>'preco_unit', '')::numeric, 0));
  end loop;
  return v_num;
end $$;

-- Agenda da cozinha/balcão (sem telefone e sem valores)
create or replace function form_agenda_encomendas(p_codigo text, p_loja text, p_de date, p_ate date)
returns table (id bigint, numero text, tipo text, loja text, cliente_nome text, data_entrega date, hora_entrega text,
               entrega_tipo text, detalhes jsonb, status text, observacao text, itens jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select e.id, e.numero, e.tipo, e.loja, e.cliente_nome, e.data_entrega, e.hora_entrega, e.entrega_tipo,
      e.detalhes, e.status, e.observacao,
      coalesce((select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'quantidade', i.quantidade) order by i.id)
                from encomenda_itens i where i.encomenda_id = e.id), '[]')
    from encomendas e
   where e.data_entrega between p_de and p_ate and e.status not in ('CANCELADO', 'ORCAMENTO')
     and (p_loja is null or p_loja = '' or e.loja = _loja(p_loja))
   order by e.data_entrega, e.hora_entrega nulls last, e.id;
end $$;

-- Cozinha/balcão avançam o status (produção → pronto → entregue)
create or replace function form_encomenda_status(p_codigo text, p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  if upper(p_status) not in ('EM_PRODUCAO', 'PRONTO', 'ENTREGUE') then raise exception 'Status inválido'; end if;
  update encomendas set status = upper(p_status), atualizado_em = now() where id = p_id and status not in ('CANCELADO');
end $$;

grant execute on function form_catalogo_encomenda(text), form_encomenda(text, jsonb),
  form_agenda_encomendas(text, text, date, date), form_encomenda_status(text, bigint, text) to anon, authenticated;

-- Avisos para a gestão
create or replace function _atv_encomenda() returns trigger language plpgsql security definer set search_path = public as $$
declare v_desc text;
begin
  v_desc := new.cliente_nome || ' · entrega ' || to_char(new.data_entrega, 'DD/MM') || coalesce(' ' || new.hora_entrega, '') ||
            case when new.total > 0 then ' · ' || _brl(new.total) else '' end;
  if tg_op = 'INSERT' then
    insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel, total)
    values ('encomendas', new.loja, coalesce(_quem(), new.atendente),
            case when new.status = 'ORCAMENTO' then 'Orçamento ' else 'Nova encomenda ' end || new.numero ||
            case new.tipo when 'EVENTO' then ' (evento)' when 'BOLO' then ' (bolo)' else '' end,
            v_desc, '/gestao/encomendas?id=' || new.id, 'info', new.total);
  elsif new.status is distinct from old.status then
    insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel)
    values ('encomendas', new.loja, _quem(),
            'Encomenda ' || new.numero || ': ' || case new.status when 'CONFIRMADO' then 'confirmada' when 'EM_PRODUCAO' then 'em produção'
              when 'PRONTO' then 'pronta' when 'ENTREGUE' then 'entregue' when 'CANCELADO' then 'cancelada' else lower(new.status) end,
            v_desc, '/gestao/encomendas?id=' || new.id, case when new.status = 'CANCELADO' then 'atencao' else 'info' end);
  end if;
  return new;
end $$;
drop trigger if exists atv_encomenda on encomendas;
create trigger atv_encomenda after insert or update of status on encomendas for each row execute function _atv_encomenda();
