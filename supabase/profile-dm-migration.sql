-- ============================================================
-- پروفایل عمومی کاربران + دایرکت خصوصی Social Cyrus
-- این بخش را هم اجرا کن؛ اجرای دوباره آن امن است.
-- ============================================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create or replace function public.cyrus_is_conversation_member(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members cm where cm.conversation_id = p_conversation and cm.user_id = auth.uid());
$$;
revoke all on function public.cyrus_is_conversation_member(uuid) from public;
grant execute on function public.cyrus_is_conversation_member(uuid) to authenticated;

drop policy if exists "Members can view their conversations" on public.conversations;
create policy "Members can view their conversations" on public.conversations for select to authenticated
using (public.cyrus_is_conversation_member(id));

drop policy if exists "Conversation participants can view members" on public.conversation_members;
create policy "Conversation participants can view members" on public.conversation_members for select to authenticated
using (public.cyrus_is_conversation_member(conversation_id));

drop policy if exists "Participants can read messages" on public.messages;
create policy "Participants can read messages" on public.messages for select to authenticated
using (public.cyrus_is_conversation_member(conversation_id));

drop policy if exists "Participants can send messages as themselves" on public.messages;
create policy "Participants can send messages as themselves" on public.messages for insert to authenticated
with check (sender_id = auth.uid() and public.cyrus_is_conversation_member(conversation_id));

grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant insert on public.messages to authenticated;

create or replace function public.cyrus_get_or_create_conversation(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conversation uuid;
begin
  if v_me is null then raise exception 'برای شروع گفتگو باید وارد حساب شوی.'; end if;
  if p_other_user is null or p_other_user = v_me then raise exception 'شناسه کاربر مقصد معتبر نیست.'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_other_user) then raise exception 'کاربر پیدا نشد.'; end if;

  select c.id into v_conversation
  from public.conversations c
  where exists (select 1 from public.conversation_members a where a.conversation_id = c.id and a.user_id = v_me)
    and exists (select 1 from public.conversation_members b where b.conversation_id = c.id and b.user_id = p_other_user)
    and (select count(*) from public.conversation_members x where x.conversation_id = c.id) = 2
  order by c.created_at desc limit 1;

  if v_conversation is null then
    insert into public.conversations default values returning id into v_conversation;
    insert into public.conversation_members(conversation_id,user_id)
    values (v_conversation,v_me),(v_conversation,p_other_user);
  end if;
  return v_conversation;
end;
$$;
revoke all on function public.cyrus_get_or_create_conversation(uuid) from public;
grant execute on function public.cyrus_get_or_create_conversation(uuid) to authenticated;

-- فعال‌سازی Realtime برای پیام‌ها
 do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime is unavailable; enable Realtime for messages in Supabase Dashboard.';
end;
$$;
