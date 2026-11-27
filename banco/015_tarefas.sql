-- 015: Tarefas da equipe. Gestor/líder cria e designa; o colaborador vê e marca como feita no celular.

create table if not exists tarefas (
  id              bigint generated always as identity primary key,
  titulo          text not null,
  descricao       text,
  loja            text references lojas(id),               -- null = as duas
  funcionario_id  bigint references funcionarios(id),      -- null = qualquer um da loja/setor
  setor           text,                                    -- Cozinha, Balcão, Limpeza... (opcional)
  recorrencia     text not null default 'UNICA' check (recorrencia in ('UNICA','DIARIA','SEMANAL','MENSAL')),
  dias_semana     int[] not null default '{}',             -- 0=domingo ... 6=sábado (SEMANAL)
  dia_mes         int,                                      -- MENSAL
  inicio          date not null default current_date,
  prazo           date,                                     -- UNICA: data limite
  hora            text,                                     -- até que horas
  prioridade      text not null default 'NORMAL' check (prioridade in ('NORMAL','ALTA','URGENTE')),
  ativa           boolean not null default true,
  criado_por      uuid default auth.uid(),
  criado_por_nome text,
  criado_em       timestamptz not null default now()
);
create table if not exists tarefa_execucoes (
  id          bigint generated always as identity primary key,
  tarefa_id   bigint not null references tarefas(id) on delete cascade,
  data        date not null,
  feita_em    timestamptz not null default now(),
  feita_por   text,
  observacao  text,
  unique (tarefa_id, data)
);
create index if not exists tarefa_exec_data on tarefa_execucoes (data);

alter table tarefas enable row level security;
alter table tarefa_execucoes enable row level security;
drop policy if exists ler on tarefas; drop policy if exists gravar on tarefas;
create policy ler on tarefas for select to authenticated using (posso('tarefas'));
create policy gravar on tarefas for all to authenticated using (posso('tarefas', true)) with check (posso('tarefas', true));
drop policy if exists ler on tarefa_execucoes; drop policy if exists gravar on tarefa_execucoes;
create policy ler on tarefa_execucoes for select to authenticated using (posso('tarefas'));
create policy gravar on tarefa_execucoes for all to authenticated using (posso('tarefas', true)) with check (posso('tarefas', true));

create or replace function _tarefa_nome_autor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.criado_por_nome is null then new.criado_por_nome := _quem(); end if;
  return new;
end $$;
drop trigger if exists tarefa_autor on tarefas;
create trigger tarefa_autor before insert on tarefas for each row execute function _tarefa_nome_autor();

-- A tarefa vale para o dia d?
create or replace function tarefa_no_dia(t tarefas, d date) returns boolean language sql immutable as $$
  select t.ativa and d >= t.inicio and case t.recorrencia
    when 'UNICA'   then d = coalesce(t.prazo, t.inicio)
    when 'DIARIA'  then true
    when 'SEMANAL' then extract(dow from d)::int = any(t.dias_semana)
    when 'MENSAL'  then extract(day from d)::int = coalesce(t.dia_mes, extract(day from t.inicio)::int)
  end;
$$;

-- Quadro do dia (gestão e formulário usam a mesma lógica). Únicas atrasadas continuam aparecendo até serem feitas.
create or replace function _tarefas_do_dia(p_data date, p_loja text default null)
returns table (id bigint, titulo text, descricao text, loja text, funcionario_id bigint, responsavel text, setor text,
               recorrencia text, hora text, prioridade text, data_ref date, atrasada boolean, feita boolean,
               feita_por text, feita_em timestamptz, observacao text)
language sql stable security definer set search_path = public as $$
  select t.id, t.titulo, t.descricao, t.loja, t.funcionario_id, f.nome, t.setor, t.recorrencia, t.hora, t.prioridade,
         case when t.recorrencia = 'UNICA' then coalesce(t.prazo, t.inicio) else p_data end,
         t.recorrencia = 'UNICA' and coalesce(t.prazo, t.inicio) < p_data,
         e.id is not null, e.feita_por, e.feita_em, e.observacao
  from tarefas t
  left join funcionarios f on f.id = t.funcionario_id
  left join tarefa_execucoes e on e.tarefa_id = t.id
        and e.data = case when t.recorrencia = 'UNICA' then coalesce(t.prazo, t.inicio) else p_data end
  where t.ativa
    and (p_loja is null or t.loja is null or t.loja = p_loja)
    and (tarefa_no_dia(t, p_data)
         or (t.recorrencia = 'UNICA' and coalesce(t.prazo, t.inicio) < p_data and e.id is null and p_data = current_date))
  order by e.id is not null, case t.prioridade when 'URGENTE' then 0 when 'ALTA' then 1 else 2 end, t.hora nulls last, t.titulo;
$$;
revoke execute on function _tarefas_do_dia(date, text) from public, anon, authenticated;

-- Quadro para a gestão (precisa da permissão de tarefas)
create or replace function tarefas_do_dia(p_data date, p_loja text default null)
returns table (id bigint, titulo text, descricao text, loja text, funcionario_id bigint, responsavel text, setor text,
               recorrencia text, hora text, prioridade text, data_ref date, atrasada boolean, feita boolean,
               feita_por text, feita_em timestamptz, observacao text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not posso('tarefas') then raise exception 'Sem acesso às tarefas'; end if;
  return query select * from _tarefas_do_dia(p_data, p_loja);
end $$;
grant execute on function tarefas_do_dia(date, text) to authenticated;

-- Formulário da equipe: lista de pessoas da loja
create or replace function form_equipe(p_codigo text, p_loja text)
returns table (id bigint, nome text, cargo text) language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select f.id, f.nome, f.cargo from funcionarios f
   where f.ativo and (f.loja = _loja(p_loja) or _loja(p_loja) is null) order by f.nome;
end $$;

-- Minhas tarefas de hoje: as da pessoa + as da loja sem responsável
create or replace function form_minhas_tarefas(p_codigo text, p_loja text, p_funcionario bigint)
returns table (id bigint, titulo text, descricao text, responsavel text, setor text, hora text, prioridade text,
               data_ref date, atrasada boolean, feita boolean, feita_por text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  return query select x.id, x.titulo, x.descricao, x.responsavel, x.setor, x.hora, x.prioridade, x.data_ref, x.atrasada, x.feita, x.feita_por
    from _tarefas_do_dia(current_date, _loja(p_loja)) x
   where x.funcionario_id = p_funcionario or x.funcionario_id is null;
end $$;

create or replace function form_concluir_tarefa(p_codigo text, p_tarefa bigint, p_data date, p_nome text, p_obs text, p_desfazer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _codigo_ok(p_codigo);
  if p_desfazer then
    delete from tarefa_execucoes where tarefa_id = p_tarefa and data = p_data and feita_em > now() - interval '12 hours';
    return;
  end if;
  insert into tarefa_execucoes (tarefa_id, data, feita_por, observacao)
  values (p_tarefa, coalesce(p_data, current_date), nullif(trim(p_nome), ''), nullif(trim(p_obs), ''))
  on conflict (tarefa_id, data) do nothing;
end $$;

grant execute on function form_equipe(text, text), form_minhas_tarefas(text, text, bigint),
  form_concluir_tarefa(text, bigint, date, text, text, boolean) to anon, authenticated;

-- Avisos: tarefa nova (para a gestão saber quem designou o quê) e tarefa concluída
create or replace function _atv_tarefa_exec() returns trigger language plpgsql security definer set search_path = public as $$
declare t tarefas; v_resp text;
begin
  select * into t from tarefas where id = new.tarefa_id;
  select nome into v_resp from funcionarios where id = t.funcionario_id;
  perform _atv_somar('tarefas', t.loja, coalesce(new.feita_por, v_resp), 'Tarefas concluídas', array[t.titulo], null, '/gestao/tarefas',
                     case when t.prioridade = 'URGENTE' then 'atencao' else 'info' end);
  return new;
end $$;
drop trigger if exists atv_tarefa_exec on tarefa_execucoes;
create trigger atv_tarefa_exec after insert on tarefa_execucoes for each row execute function _atv_tarefa_exec();

create or replace function _atv_tarefa_nova() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into atividades (modulo, loja, autor, titulo, detalhe, link, nivel)
  values ('tarefas', new.loja, new.criado_por_nome, 'Tarefa designada: ' || new.titulo,
          coalesce((select nome from funcionarios where id = new.funcionario_id), coalesce(new.setor, 'Equipe da loja')) || ' · ' ||
          case new.recorrencia when 'UNICA' then 'até ' || to_char(coalesce(new.prazo, new.inicio), 'DD/MM') when 'DIARIA' then 'todo dia'
            when 'SEMANAL' then 'toda semana' else 'todo mês' end,
          '/gestao/tarefas', case when new.prioridade = 'URGENTE' then 'atencao' else 'info' end);
  return new;
end $$;
drop trigger if exists atv_tarefa_nova on tarefas;
create trigger atv_tarefa_nova after insert on tarefas for each row execute function _atv_tarefa_nova();
