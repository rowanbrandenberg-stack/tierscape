-- These helpers only answer "is the signed in user in this company". Signed out visitors have no use for them.
-- Signed in users keep access because the row level security policies call them.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.can_manage_billing(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.can_manage_billing(uuid) to authenticated;
