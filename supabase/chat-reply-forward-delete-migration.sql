-- Social Cyrus: Reply, Forward and Delete for direct messages
-- این Migration را بعد از SQLهای قبلی اجرا کنید. اجرای مجدد آن امن است.

alter table public.messages replica identity full;

alter table public.messages
  add column if not exists reply_to_id uuid null references public.messages(id) on delete set null,
  add column if not exists is_forwarded boolean not null default false;

create index if not exists messages_reply_to_idx on public.messages(reply_to_id);

-- فقط فرستنده می‌تواند پیام خودش را حذف کند؛ حذف واقعی پیام برای هر دو عضو گفتگو اعمال می‌شود.
drop policy if exists "Senders can delete their own messages" on public.messages;
create policy "Senders can delete their own messages"
on public.messages for delete to authenticated
using (
  sender_id = auth.uid()
  and public.cyrus_is_conversation_member(conversation_id)
);

grant delete on public.messages to authenticated;

-- اطمینان از فعال بودن Realtime برای رویداد حذف نیز با همان publication قبلی است.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'Publication supabase_realtime پیدا نشد؛ از Database > Publications آن را فعال کنید.';
end;
$$;
