-- Social Cyrus: وضعیت آنلاین و رسید خواندن پیام‌ها
-- این Migration را بعد از profile-dm-migration.sql اجرا کن. اجرای دوباره امن است.

alter table public.messages add column if not exists read_at timestamptz;

-- کاربر فقط می‌تواند زمان خوانده‌شدن پیام‌هایی را که دریافت کرده ثبت کند.
grant update (read_at) on public.messages to authenticated;

drop policy if exists "Recipients can mark messages as read" on public.messages;
create policy "Recipients can mark messages as read"
on public.messages for update to authenticated
using (sender_id <> auth.uid() and public.cyrus_is_conversation_member(conversation_id))
with check (sender_id <> auth.uid() and public.cyrus_is_conversation_member(conversation_id));

-- برای نمایش وضعیت دیده‌شدن پیام‌ها، تغییر read_at باید از Realtime ارسال شود.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  raise notice 'Publication supabase_realtime is unavailable; enable Realtime for messages in Supabase Dashboard.';
end;
$$;
