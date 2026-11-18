-- ═══════════════════════════════════════════════════════════════
-- Terminal accuracy work (18 Nov 2026).
--  • flow_bias.sig — every signal's own score per row, BEFORE the absorption
--    discount: {"d":delta,"a":absorption,"o":oi,"w":whales,"b":book,
--    "f":funding crowding,"c":cohort}, each in [-1,1] or null (no data).
--    Lets us measure which inputs predict price instead of only the total.
--  • flow_bias.mid — book mid at write time (grading without bid/ask bounce).
--  • flow_heartbeat() — seconds since the newest bar from any recorder run.
--    The hourly backup run uses it to exit when a recorder is already live.
-- Backward compatible: old recorders that omit sig/mid insert nulls.
-- ═══════════════════════════════════════════════════════════════

alter table public.flow_bias add column if not exists sig jsonb;
alter table public.flow_bias add column if not exists mid double precision;

create or replace function public.flow_ingest(p_token text, p_bias jsonb, p_bars jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'private'
as $function$
declare v_b int; v_r int;
begin
  if p_token is null or p_token is distinct from (select token from private.track_config where id = 1) then
    raise exception 'unauthorized';
  end if;
  insert into flow_bias (t, coin, horizon, raw, score, direction, coverage, px, mid, sig)
  select (r->>'t')::timestamptz, r->>'coin', r->>'horizon', (r->>'raw')::int, (r->>'score')::int,
         r->>'direction', (r->>'coverage')::real, (r->>'px')::float8,
         nullif(r->>'mid', '')::float8, r->'sig'
  from jsonb_array_elements(coalesce(p_bias, '[]'::jsonb)) r
  on conflict (coin, horizon, t) do nothing;
  get diagnostics v_b = row_count;
  insert into flow_bars (t, coin, buy_usd, sell_usd, trades, o, h, l, c)
  select (r->>'t')::timestamptz, r->>'coin', (r->>'buy')::float8, (r->>'sell')::float8, (r->>'n')::int,
         (r->>'o')::float8, (r->>'h')::float8, (r->>'l')::float8, (r->>'c')::float8
  from jsonb_array_elements(coalesce(p_bars, '[]'::jsonb)) r
  on conflict (coin, t) do nothing;
  get diagnostics v_r = row_count;
  delete from flow_bias where t < now() - interval '45 days';
  delete from flow_bars where t < now() - interval '30 days';
  return jsonb_build_object('bias', v_b, 'bars', v_r);
end $function$;

create or replace function public.flow_heartbeat()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('age_s', extract(epoch from now() - max(t))::int - 60)
  from flow_bars;
$function$;
-- (- 60: a bar is stamped with its minute START and written after it closes.)

grant execute on function public.flow_heartbeat() to anon;
