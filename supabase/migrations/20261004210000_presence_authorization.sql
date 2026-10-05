drop policy if exists "FocusMate friends can read online presence"
  on realtime.messages;
drop policy if exists "FocusMate users can publish their own online presence"
  on realtime.messages;

create policy "FocusMate friends can read online presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (
      realtime.topic() = 'focusmate-presence:' || (select auth.uid())::text
      or exists (
        select 1
        from public.friendships as friendship
        where friendship.status = 'accepted'
          and (
            (
              friendship.requester_id = (select auth.uid())
              and realtime.topic() = 'focusmate-presence:' || friendship.recipient_id::text
            )
            or (
              friendship.recipient_id = (select auth.uid())
              and realtime.topic() = 'focusmate-presence:' || friendship.requester_id::text
            )
          )
      )
    )
  );

create policy "FocusMate users can publish their own online presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and realtime.topic() = 'focusmate-presence:' || (select auth.uid())::text
  );
