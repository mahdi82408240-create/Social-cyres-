-- SOCIAL CYRUS — دیتابیس و سیاست‌های دسترسی + ساخت خودکار پروفایل
-- این نسخه را می‌توان در Supabase SQL Editor اجرا کرد.
-- فقط کلید anon/publishable در فرانت‌اند استفاده شود؛ service_role ممنوع.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
create unique index if not exists profiles_username_unique_idx on public.profiles(username) where username is not null;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  image_url text,
  created_at timestamptz not null default now(),
  constraint posts_content_or_image check (length(trim(content)) > 0 or image_url is not null)
);
create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- با ساخت کاربر در Auth، پروفایل او هم به شکل خودکار ساخته می‌شود.
create or replace function public.handle_new_cyrus_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_username text;
  v_name text;
begin
  v_base := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email, 'cyrus_user'), '@', 1)), '[^a-zA-Z0-9_.]', '', 'g'));
  v_base := left(coalesce(nullif(v_base, ''), 'cyrus_user'), 18);
  v_username := v_base || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  v_name := coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(coalesce(new.email, 'کاربر سایرس'), '@', 1), 'کاربر سایرس');
  insert into public.profiles (id, username, display_name, bio)
  values (new.id, v_username, v_name, '')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_cyrus on auth.users;
create trigger on_auth_user_created_cyrus
after insert on auth.users
for each row execute procedure public.handle_new_cyrus_user();

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;

drop policy if exists "Profiles are viewable by everyone" on public.profiles;
create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Posts are viewable by everyone" on public.posts;
create policy "Posts are viewable by everyone" on public.posts for select using (true);
drop policy if exists "Authenticated users can create posts" on public.posts;
create policy "Authenticated users can create posts" on public.posts for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update own posts" on public.posts;
create policy "Users can update own posts" on public.posts for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete own posts" on public.posts;
create policy "Users can delete own posts" on public.posts for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Likes are viewable by everyone" on public.likes;
create policy "Likes are viewable by everyone" on public.likes for select using (true);
drop policy if exists "Users can like as themselves" on public.likes;
create policy "Users can like as themselves" on public.likes for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can remove own likes" on public.likes;
create policy "Users can remove own likes" on public.likes for delete to authenticated using (auth.uid() = user_id);

grant select on public.profiles, public.posts, public.likes to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.posts to authenticated;
grant insert, delete on public.likes to authenticated;

-- Storage عکس پروفایل
insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Profile avatars are publicly readable" on storage.objects;
create policy "Profile avatars are publicly readable" on storage.objects for select using (bucket_id = 'profile-avatars');
drop policy if exists "Users upload their own profile avatar" on storage.objects;
create policy "Users upload their own profile avatar" on storage.objects for insert to authenticated with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update their own profile avatar" on storage.objects;
create policy "Users update their own profile avatar" on storage.objects for update to authenticated using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete their own profile avatar" on storage.objects;
create policy "Users delete their own profile avatar" on storage.objects for delete to authenticated using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- دیدگاه‌های آنلاین
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_created_idx on public.comments(post_id, created_at);
create index if not exists posts_created_at_idx on public.posts(created_at desc);

alter table public.comments enable row level security;
drop policy if exists "Comments are viewable by everyone" on public.comments;
create policy "Comments are viewable by everyone" on public.comments for select using (true);
drop policy if exists "Authenticated users can comment as themselves" on public.comments;
create policy "Authenticated users can comment as themselves" on public.comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments" on public.comments for delete to authenticated using (auth.uid() = user_id);
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

-- Storage عمومی برای تصاویر پست‌ها؛ آپلود فقط در پوشه شناسه همان کاربر
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Post images are publicly readable" on storage.objects;
create policy "Post images are publicly readable" on storage.objects for select using (bucket_id = 'post-images');
drop policy if exists "Users upload their own post images" on storage.objects;
create policy "Users upload their own post images" on storage.objects for insert to authenticated
with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users update their own post images" on storage.objects;
create policy "Users update their own post images" on storage.objects for update to authenticated
using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users delete their own post images" on storage.objects;
create policy "Users delete their own post images" on storage.objects for delete to authenticated
using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================
-- دنبال‌کردن کاربران و اعلان‌های آنلاین Social Cyrus
-- این بخش را نیز در SQL Editor اجرا کن.
-- ============================================================
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows(following_id);
create index if not exists follows_follower_idx on public.follows(follower_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('follow','like','comment')),
  post_id uuid references public.posts(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_no_self check (recipient_id <> actor_id)
);
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications(recipient_id) where read_at is null;

alter table public.follows enable row level security;
alter table public.notifications enable row level security;
drop policy if exists "Follows are publicly readable" on public.follows;
create policy "Follows are publicly readable" on public.follows for select using (true);
drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves" on public.follows for insert to authenticated with check (auth.uid() = follower_id and follower_id <> following_id);
drop policy if exists "Users can unfollow themselves" on public.follows;
create policy "Users can unfollow themselves" on public.follows for delete to authenticated using (auth.uid() = follower_id);
drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications" on public.notifications for select to authenticated using (auth.uid() = recipient_id);
drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read" on public.notifications for update to authenticated using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);
-- درج اعلان فقط توسط triggerهای امن دیتابیس انجام می‌شود؛ دسترسی مستقیم به INSERT داده نمی‌شود.
grant select, insert, delete on public.follows to authenticated;
revoke update on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.cyrus_notify_follow()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.follower_id <> new.following_id then
    insert into public.notifications(recipient_id, actor_id, type)
    values(new.following_id, new.follower_id, 'follow');
  end if;
  return new;
end;
$$;
drop trigger if exists cyrus_follow_notification on public.follows;
create trigger cyrus_follow_notification after insert on public.follows
for each row execute function public.cyrus_notify_follow();

create or replace function public.cyrus_notify_like()
returns trigger language plpgsql security definer set search_path = '' as $$
declare post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications(recipient_id, actor_id, type, post_id)
    values(post_owner, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists cyrus_like_notification on public.likes;
create trigger cyrus_like_notification after insert on public.likes
for each row execute function public.cyrus_notify_like();

create or replace function public.cyrus_notify_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications(recipient_id, actor_id, type, post_id)
    values(post_owner, new.user_id, 'comment', new.post_id);
  end if;
  return new;
end;
$$;
drop trigger if exists cyrus_comment_notification on public.comments;
create trigger cyrus_comment_notification after insert on public.comments
for each row execute function public.cyrus_notify_comment();

-- فعال‌سازی Realtime برای اعلان‌ها (بدون خطا در صورت فعال بودن قبلی)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime is not available; enable Realtime for notifications in Supabase Dashboard.';
end;
$$;

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
