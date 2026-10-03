-- The unclosed-day job is for pg_cron only; nobody should be able to call it through the API.
revoke execute on function public.flag_unclosed_days() from public, anon, authenticated;
