-- =====================================================================
-- Nota fiscal por foto: a equipe fotografa a nota no sistema, a foto fica
-- na fila (notas_fotos) e o Claude lê e lança pela registrar_nota_foto,
-- que usa a mesma registrar_nota do XML (estoque + contas a pagar).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('notas', 'notas', false, 20971520)
on conflict (id) do nothing;

drop policy if exists notas_ler on storage.objects;
drop policy if exists notas_gravar on storage.objects;
drop policy if exists notas_apagar on storage.objects;
create policy notas_ler on storage.objects for select to authenticated
  using (bucket_id = 'notas' and (public.posso('notas') or public.posso('compras')));
create policy notas_gravar on storage.objects for insert to authenticated
  with check (bucket_id = 'notas' and (public.posso('notas', true) or public.posso('compras', true)));
create policy notas_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'notas' and (public.posso('notas', true) or public.posso('compras', true)));

create table if not exists notas_fotos (
  id            bigint generated always as identity primary key,
  loja          text references lojas(id),               -- opcional: o CNPJ da nota também resolve
  arquivos      text[] not null,                          -- caminhos no bucket 'notas' (uma foto por página)
  observacao    text,
  status        text not null default 'AGUARDANDO' check (status in ('AGUARDANDO','LANCADA','DUPLICADA','ERRO')),
  mensagem      text,                                     -- o que o Claude encontrou (erro, dúvida)
  nota_id       bigint references notas_fiscais(id) on delete set null,
  enviado_por   uuid default auth.uid(),
  enviado_em    timestamptz not null default now(),
  processado_em timestamptz
);
alter table notas_fotos enable row level security;
drop policy if exists ler on notas_fotos;
drop policy if exists gravar on notas_fotos;
create policy ler on notas_fotos for select to authenticated using (posso('notas') or posso('compras'));
create policy gravar on notas_fotos for all to authenticated
  using (posso('notas', true) or posso('compras', true)) with check (posso('notas', true) or posso('compras', true));

-- Lança a nota lida da foto e dá baixa na fila. p = mesmo formato da registrar_nota.
create or replace function registrar_nota_foto(p_foto bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f notas_fotos; r jsonb; v_nota bigint;
begin
  if not posso('notas', true) and not posso('compras', true) then raise exception 'Sem permissão para lançar notas'; end if;
  select * into f from notas_fotos where id = p_foto for update;
  if f.id is null then raise exception 'Foto % não encontrada', p_foto; end if;
  if f.status = 'LANCADA' then return jsonb_build_object('ok', false, 'mensagem', 'Esta foto já foi lançada.', 'nota_id', f.nota_id); end if;
  p := p || jsonb_build_object('origem', 'foto');
  if f.loja is not null and coalesce(p->>'loja', '') = '' then p := p || jsonb_build_object('loja', f.loja); end if;
  r := registrar_nota(p);
  if coalesce((r->>'duplicada')::boolean, false) then
    select id into v_nota from notas_fiscais where chave_acesso = p->>'chave';
    update notas_fotos set status = 'DUPLICADA', nota_id = v_nota, processado_em = now(), mensagem = 'Esta nota já estava no sistema.' where id = p_foto;
  else
    v_nota := (r->>'nota_id')::bigint;
    update notas_fotos set status = 'LANCADA', nota_id = v_nota, processado_em = now(), mensagem = null where id = p_foto;
    update notas_fiscais set arquivo_url = f.arquivos[1] where id = v_nota;
  end if;
  return r || jsonb_build_object('foto_id', p_foto);
end $$;

grant execute on function registrar_nota_foto(bigint, jsonb) to authenticated;
