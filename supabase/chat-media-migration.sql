-- Social Cyrus: ارسال عکس، فایل و پیام صوتی در دایرکت
-- این Migration را بعد از SQLهای قبلی اجرا کنید. اجرای مجدد آن امن است.

alter table public.messages
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint;

-- رسانه‌های دایرکت خصوصی هستند؛ فایل‌ها فقط با Signed URL کوتاه‌مدت نمایش داده می‌شوند.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-media', 'chat-media', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- مسیر فایل: {conversation_id}/{sender_user_id}/{random_file_name}
drop policy if exists "Chat members can read conversation media" on storage.objects;
create policy "Chat members can read conversation media"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.cyrus_is_conversation_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Members upload their own chat media" on storage.objects;
create policy "Members upload their own chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.cyrus_is_conversation_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "Users delete their own chat media" on storage.objects;
create policy "Users delete their own chat media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-media'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.cyrus_is_conversation_member(((storage.foldername(name))[1])::uuid)
);

grant select, insert on public.messages to authenticated;

-- برای نمایش تغییرات پیام‌های رسانه‌ای در لحظه، جدول messages باید در Realtime باشد.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'Publication supabase_realtime پیدا نشد؛ از Database > Publications آن را فعال کنید.';
end;
$$;
