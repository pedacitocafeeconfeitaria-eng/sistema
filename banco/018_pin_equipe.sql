-- =====================================================================
-- PIN pessoal da equipe.
-- O aparelho continua precisando do código da equipe (uma vez). Além dele,
-- cada colaborador se identifica com nome + PIN; o sistema abre uma sessão
-- que vale até as 4h do dia seguinte. Os formulários mandam o código como
-- "CODIGO|TOKEN", então as funções form_* não mudam de assinatura: a
-- _codigo_ok confere a sessão e guarda quem é, e os gatilhos abaixo gravam
-- o nome e o funcionario_id em cada registro direto no servidor.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- PINs e sessões: RLS ligado e sem políticas → ninguém lê pela API, só as funções abaixo.
create table if not exists funcionario_pins (
  funcionario_id  bigint primary key references funcionarios(id) on delete cascade,
  pin_hash        text not null,
  definido_em     timestamptz not null default now(),
  tentativas      int not null default 0,
  bloqueado_ate   timestamptz
);
alter table funcionario_pins enable row level security;

create table if not exists sessoes_equipe (
  token           uuid primary key default gen_random_uuid(),
  funcionario_id  bigint not null references funcionarios(id) on delete cascade,
  criado_em       timestamptz not null default now(),
  expira_em       timestamptz not null
);
alter table sessoes_equipe enable row level security;
create index if not exists sessoes_equipe_func on sessoes_equipe (funcionario_id);

insert into config (chave, valor) values ('exigir_pin', 'false'::jsonb) on conflict (chave) do nothing;

-- Só o código da equipe (sem PIN): usado na tela de entrada
create or replace function _codigo_base_ok(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(split_part(p_codigo, '|', 1), '') <> (select valor #>> '{}' from config where chave = 'codigo_equipe') then
    raise exception 'Código da equipe inválido' using errcode = '28000';
  end if;
end $$;

-- Código da equipe + sessão do PIN ("CODIGO|TOKEN")
create or replace function _codigo_ok(p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_tok text := nullif(split_part(coalesce(p_codigo, ''), '|', 2), ''); v_id bigint; v_nome text;
begin
  perform _codigo_base_ok(p_codigo);
  if v_tok is not null then
    select f.id, f.nome into v_id, v_nome from sessoes_equipe s join funcionarios f on f.id = s.funcionario_id
     where s.token::text = v_tok and s.expira_em > now() and f.ativo;
    if v_id is null then raise exception 'Seu acesso expirou. Digite seu PIN novamente.' using errcode = '28000'; end if;
    perform set_config('pedacito.func_id', v_id::text, true);
    perform set_config('pedacito.func_nome', v_nome, true);
  elsif coalesce((select (valor #>> '{}')::boolean from config where chave = 'exigir_pin'), false) then
    raise exception 'Identifique-se com seu PIN.' using errcode = '28000';
  end if;
end $$;

create or replace function _func_sessao() returns bigint language sql stable as $$
  select nullif(current_setting('pedacito.func_id', true), '')::bigint;
$$;

-- Quem está agindo: usuário da gestão (login) ou colaborador identificado pelo PIN
create or replace function _quem() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nome from perfis where user_id = auth.uid()), nullif(current_setting('pedacito.func_nome', true), ''));
$$;

-- Lista de nomes para a tela de entrada (pede só o código da equipe)
create or replace function form_equipe(p_codigo text, p_loja text)
returns table (id bigint, nome text, cargo text) language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_base_ok(p_codigo);
  return query select f.id, f.nome, f.cargo from funcionarios f
   where f.ativo and (f.loja = _loja(p_loja) or _loja(p_loja) is null) order by f.nome;
end $$;

create or replace function form_config_equipe(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _codigo_base_ok(p_codigo);
  return jsonb_build_object('exigir_pin', coalesce((select (valor #>> '{}')::boolean from config where chave = 'exigir_pin'), false));
end $$;

-- Entrar com nome + PIN. 5 erros seguidos bloqueiam aquela pessoa por 15 minutos.
create or replace function equipe_entrar(p_codigo text, p_funcionario bigint, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f funcionarios; p funcionario_pins; v_tok uuid; v_exp timestamptz;
begin
  perform _codigo_base_ok(p_codigo);
  select * into f from funcionarios where id = p_funcionario and ativo;
  if f.id is null then raise exception 'Colaborador não encontrado.'; end if;
  select * into p from funcionario_pins where funcionario_id = f.id for update;
  if p.funcionario_id is null then raise exception 'Você ainda não tem PIN. Peça para a gestão cadastrar.'; end if;
  if p.bloqueado_ate > now() then
    raise exception 'Muitas tentativas erradas. Tente de novo em % minuto(s).', ceil(extract(epoch from p.bloqueado_ate - now()) / 60)::int;
  end if;
  if p.pin_hash <> crypt(coalesce(p_pin, ''), p.pin_hash) then
    -- não usa raise aqui: o erro desfaria a contagem de tentativas
    update funcionario_pins set tentativas = case when tentativas + 1 >= 5 then 0 else tentativas + 1 end,
      bloqueado_ate = case when tentativas + 1 >= 5 then now() + interval '15 minutes' end
     where funcionario_id = f.id;
    return jsonb_build_object('ok', false, 'erro', case when p.tentativas + 1 >= 5
      then 'PIN incorreto. Acesso bloqueado por 15 minutos.' else format('PIN incorreto. Restam %s tentativa(s).', 5 - (p.tentativas + 1)) end);
  end if;
  update funcionario_pins set tentativas = 0, bloqueado_ate = null where funcionario_id = f.id;
  v_exp := ((date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '4 hours') + interval '1 day 4 hours') at time zone 'America/Sao_Paulo');
  delete from sessoes_equipe where expira_em < now() - interval '7 days';
  insert into sessoes_equipe (funcionario_id, expira_em) values (f.id, v_exp) returning token into v_tok;
  return jsonb_build_object('ok', true, 'token', v_tok, 'funcionario_id', f.id, 'nome', f.nome, 'expira', v_exp,
    'loja', case f.loja when 'VILLA' then 'Villa Schlosser' when 'SOUZA_CRUZ' then 'Souza Cruz' end);
end $$;

create or replace function equipe_sair(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from sessoes_equipe where token::text = p_token;
$$;

-- Gestão: definir / remover PIN e ver quem já tem
create or replace function definir_pin(p_funcionario bigint, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not eu_admin() and not posso('rh', true) then raise exception 'Sem permissão para definir PIN'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números.'; end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('1234', '12345', '123456', '4321', '654321') then raise exception 'PIN muito fácil. Escolha outro.'; end if;
  insert into funcionario_pins (funcionario_id, pin_hash) values (p_funcionario, crypt(p_pin, gen_salt('bf', 8)))
  on conflict (funcionario_id) do update set pin_hash = excluded.pin_hash, definido_em = now(), tentativas = 0, bloqueado_ate = null;
  delete from sessoes_equipe where funcionario_id = p_funcionario;  -- quem estava logado com o PIN antigo precisa entrar de novo
end $$;

create or replace function remover_pin(p_funcionario bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eu_admin() and not posso('rh', true) then raise exception 'Sem permissão'; end if;
  delete from funcionario_pins where funcionario_id = p_funcionario;
  delete from sessoes_equipe where funcionario_id = p_funcionario;
end $$;

create or replace function pins_equipe() returns table (funcionario_id bigint, tem_pin boolean, definido_em timestamptz, bloqueado boolean, ultimo_acesso timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not eu_admin() and not posso('rh') then raise exception 'Sem permissão'; end if;
  return query select f.id, p.funcionario_id is not null, p.definido_em, coalesce(p.bloqueado_ate > now(), false),
    (select max(s.criado_em) from sessoes_equipe s where s.funcionario_id = f.id)
    from funcionarios f left join funcionario_pins p on p.funcionario_id = f.id where f.ativo;
end $$;

-- Minhas tarefas: com sessão, mostra sempre as da pessoa identificada
create or replace function form_minhas_tarefas(p_codigo text, p_loja text, p_funcionario bigint)
returns table (id bigint, titulo text, descricao text, responsavel text, setor text, hora text, prioridade text,
               data_ref date, atrasada boolean, feita boolean, feita_por text)
language plpgsql security definer set search_path = public as $$
declare v_f bigint;
begin
  perform _codigo_ok(p_codigo);
  v_f := coalesce(_func_sessao(), p_funcionario);
  return query select x.id, x.titulo, x.descricao, x.responsavel, x.setor, x.hora, x.prioridade, x.data_ref, x.atrasada, x.feita, x.feita_por
    from _tarefas_do_dia(current_date, _loja(p_loja)) x
   where x.funcionario_id = v_f or x.funcionario_id is null;
end $$;

-- Quem fez: gravado pelo servidor a partir da sessão do PIN (não dá para assinar por outra pessoa)
create or replace function _carimbar_quem() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id bigint := _func_sessao(); v_nome text := nullif(current_setting('pedacito.func_nome', true), '');
begin
  if v_id is null then return new; end if;
  return jsonb_populate_record(new, jsonb_build_object(tg_argv[0], v_nome, 'funcionario_id', v_id));
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('producao_registros', 'responsavel'), ('desperdicio_registros', 'responsavel'), ('estoque_movimentos', 'responsavel'),
    ('balcao_relatorios', 'responsavel'), ('contagens', 'responsavel'), ('lista_compras', 'pedido_por'),
    ('tarefa_execucoes', 'feita_por'), ('encomendas', 'atendente')) as x(tabela, coluna)
  loop
    execute format('alter table %I add column if not exists funcionario_id bigint references funcionarios(id) on delete set null', t.tabela);
    execute format('drop trigger if exists carimbar_quem on %I', t.tabela);
    execute format('create trigger carimbar_quem before insert on %I for each row execute function _carimbar_quem(%L)', t.tabela, t.coluna);
  end loop;
end $$;

revoke all on function _codigo_base_ok(text), _carimbar_quem(), definir_pin(bigint, text), remover_pin(bigint), pins_equipe() from public, anon;
grant execute on function form_equipe(text, text), form_config_equipe(text), equipe_entrar(text, bigint, text), equipe_sair(text),
  form_minhas_tarefas(text, text, bigint) to anon, authenticated;
grant execute on function definir_pin(bigint, text), remover_pin(bigint), pins_equipe() to authenticated;

select 'ok' as resultado, (select count(*) from funcionarios where ativo) colaboradores_ativos;
