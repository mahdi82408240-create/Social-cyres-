-- Social Cyrus: مدیریت دیدگاه‌ها
-- این migration را جداگانه اجرا کنید؛ SQLهای قبلی را حذف نکنید.

-- هر کاربر فقط دیدگاه خودش را ویرایش می‌کند.
drop policy if exists "Users can update their own comments" on public.comments;
create policy "Users can update their own comments"
on public.comments for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- کاربر می‌تواند دیدگاه خودش یا دیدگاه زیر پست خودش را حذف کند.
drop policy if exists "Users or post owners can delete comments" on public.comments;
create policy "Users or post owners can delete comments"
on public.comments for delete to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.posts
    where posts.id = comments.post_id
      and posts.user_id = auth.uid()
  )
);

grant update, delete on public.comments to authenticated;
