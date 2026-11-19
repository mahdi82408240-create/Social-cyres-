-- Social Cyrus Stories: run once in Supabase SQL Editor.
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists stories_active_created_idx on public.stories(expires_at, created_at desc);
alter table public.stories enable row level security;
drop policy if exists "Active stories are viewable by everyone" on public.stories;
create policy "Active stories are viewable by everyone" on public.stories for select to anon, authenticated using (expires_at > now());
drop policy if exists "Users can publish their own stories" on public.stories;
create policy "Users can publish their own stories" on public.stories for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own stories" on public.stories;
create policy "Users can delete their own stories" on public.stories for delete to authenticated using (auth.uid() = user_id);
grant select on public.stories to anon, authenticated;
grant insert, delete on public.stories to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-media','story-media',true,52428800,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public=true, file_size_limit=52428800,
allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'];
drop policy if exists "Story media is publicly readable" on storage.objects;
create policy "Story media is publicly readable" on storage.objects for select using (bucket_id='story-media');
drop policy if exists "Users upload their own story media" on storage.objects;
create policy "Users upload their own story media" on storage.objects for insert to authenticated with check (bucket_id='story-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users delete their own story media" on storage.objects;
create policy "Users delete their own story media" on storage.objects for delete to authenticated using (bucket_id='story-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- Optional cleanup: expired rows are hidden by RLS/query immediately; this function can be scheduled with pg_cron if enabled.
create or replace function public.delete_expired_cyrus_stories()
returns void language sql security definer set search_path = '' as $$
  delete from public.stories where expires_at <= now();
$$;
