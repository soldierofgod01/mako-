-- ═══════════════════════════════════════════════════════════════
-- Signal log: every time a coin ENTERS a screen (Squeeze setup, Crowded
-- longs, Long squeeze), record it and grade the forward return at 1h/4h/24h,
-- raw and in excess of the market (median liquid coin over the same window).
-- Runs inside market_ingest every 5 min. Events are never pruned
-- (market_snapshots is pruned at 7d, so grades are persisted on the row).
--
-- Definitions mirror src/lib/screener/build.ts PRESETS exactly, using strict
-- 4h history (no 1h/24h fallbacks):
--   squeeze        dir +1  OI 4h > +1%, price 4h < 0, funding8h < 0
--   crowded_longs  dir -1  funding8h > 0.03%, OI 4h >= 0
--   long_squeeze   dir -1  OI 4h > +1%, price 4h > 0, funding8h > 0.01% (above HL's neutral rate)
-- "Enters" = flagged now and not flagged in the previous 60 min (flicker guard).
-- Context logged for later relative-threshold analysis: funding percentile vs
-- the coin's own history, OI 4h change z-score vs its own 4h changes.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.signal_events (
  id bigserial primary key,
  t timestamptz not null,
  coin text not null,
  signal text not null,
  dir smallint not null,
  px double precision not null,
  f8 real,               -- funding, % per 8h
  oi_chg4h real,         -- %
  px_chg4h real,         -- %
  vol24h double precision,
  funding_pctile real,   -- 0..1 vs coin's own history (≤7d)
  oi_z real,             -- z-score of this 4h OI change vs coin's own 4h changes
  hist_h real,           -- hours of history behind the two context numbers
  ret_1h double precision, ret_4h double precision, ret_24h double precision,
  mkt_1h double precision, mkt_4h double precision, mkt_24h double precision,
  unique (coin, signal, t)
);
create index if not exists signal_events_t on public.signal_events (t);
alter table public.signal_events enable row level security;

create table if not exists public.signal_state (
  coin text not null,
  signal text not null,
  last_seen timestamptz not null,
  primary key (coin, signal)
);
alter table public.signal_state enable row level security;

-- Median return of liquid coins from p_t to p_t + p_h (fraction).
create or replace function public.signal_mkt_ret(p_t timestamptz, p_h interval)
returns double precision language sql stable set search_path = public as $$
  select percentile_cont(0.5) within group (order by b.px / a.px - 1)
  from market_snapshots a join market_snapshots b on b.coin = a.coin and b.t = p_t + p_h
  where a.t = p_t and a.volume24h >= 500000 and a.px > 0 and b.px > 0;
$$;

create or replace function public.signal_tick(p_t timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new int := 0; v_graded int := 0;
begin
  -- 1. Detect.
  create temp table if not exists _sig (coin text, signal text, dir smallint, px float8, f8 float8, oi4 float8, chg4 float8, vol float8) on commit drop;
  truncate _sig;
  insert into _sig
  select x.coin, s.signal, s.dir, x.px, x.f8, x.oi4, x.chg4, x.vol
  from (
    select c.coin, c.px, c.volume24h vol, c.funding_hourly * 800 f8,
           (c.oi / b.oi - 1) * 100 oi4, (c.px / b.px - 1) * 100 chg4
    from market_snapshots c join market_snapshots b on b.coin = c.coin and b.t = p_t - interval '4 hours'
    where c.t = p_t and c.volume24h >= 500000 and b.px > 0 and b.oi > 0 and c.funding_hourly is not null
  ) x
  cross join lateral (values
    ('squeeze'::text,        1::smallint, x.oi4 > 1  and x.chg4 < 0 and x.f8 < 0),
    ('crowded_longs'::text, -1::smallint, x.f8 > 0.03 and x.oi4 >= 0),
    ('long_squeeze'::text,  -1::smallint, x.oi4 > 1  and x.chg4 > 0 and x.f8 > 0.01)
  ) s(signal, dir, hit)
  where s.hit;

  insert into signal_events (t, coin, signal, dir, px, f8, oi_chg4h, px_chg4h, vol24h, funding_pctile, oi_z, hist_h)
  select p_t, g.coin, g.signal, g.dir, g.px, g.f8, g.oi4, g.chg4, g.vol, ctx.fp, ctx.z, ctx.hh
  from _sig g
  left join signal_state st on st.coin = g.coin and st.signal = g.signal
  cross join lateral (
    select
      (select avg((h.funding_hourly < g.f8 / 800)::int)::real from market_snapshots h
        where h.coin = g.coin and h.t <= p_t and h.t > p_t - interval '7 days') fp,
      (select ((ln(1 + g.oi4 / 100) - avg(d)) / nullif(stddev_samp(d), 0))::real from (
          select ln(a.oi / b.oi) d from market_snapshots a
          join market_snapshots b on b.coin = a.coin and b.t = a.t - interval '4 hours'
          where a.coin = g.coin and a.t < p_t and a.t > p_t - interval '7 days' and a.oi > 0 and b.oi > 0) q
        having count(*) >= 24) z,
      (select (extract(epoch from p_t - min(h.t)) / 3600)::real from market_snapshots h
        where h.coin = g.coin and h.t > p_t - interval '7 days') hh
  ) ctx
  where st.last_seen is null or st.last_seen < p_t - interval '60 minutes'
  on conflict do nothing;
  get diagnostics v_new = row_count;

  insert into signal_state (coin, signal, last_seen)
  select coin, signal, p_t from _sig
  on conflict (coin, signal) do update set last_seen = excluded.last_seen;

  -- 2. Grade anything whose horizon has now passed.
  update signal_events e set
    ret_1h  = coalesce(e.ret_1h,  (select s.px / e.px - 1 from market_snapshots s where s.coin = e.coin and s.t = e.t + interval '1 hour')),
    mkt_1h  = coalesce(e.mkt_1h,  signal_mkt_ret(e.t, interval '1 hour')),
    ret_4h  = case when e.t + interval '4 hours' <= p_t then coalesce(e.ret_4h, (select s.px / e.px - 1 from market_snapshots s where s.coin = e.coin and s.t = e.t + interval '4 hours')) end,
    mkt_4h  = case when e.t + interval '4 hours' <= p_t then coalesce(e.mkt_4h, signal_mkt_ret(e.t, interval '4 hours')) end,
    ret_24h = case when e.t + interval '24 hours' <= p_t then coalesce(e.ret_24h, (select s.px / e.px - 1 from market_snapshots s where s.coin = e.coin and s.t = e.t + interval '24 hours')) end,
    mkt_24h = case when e.t + interval '24 hours' <= p_t then coalesce(e.mkt_24h, signal_mkt_ret(e.t, interval '24 hours')) end
  where e.t + interval '1 hour' <= p_t
    and e.t > p_t - interval '7 days'
    and (e.ret_1h is null or (e.ret_4h is null and e.t + interval '4 hours' <= p_t)
                          or (e.ret_24h is null and e.t + interval '24 hours' <= p_t));
  get diagnostics v_graded = row_count;

  return jsonb_build_object('new', v_new, 'graded', v_graded);
end $$;
revoke all on function public.signal_tick(timestamptz) from public, anon, authenticated;

-- Hook into the 5-min ingest. A detector failure must never break ingest.
create or replace function public.market_ingest(p_token text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'private' as $function$
declare v_now timestamptz := date_trunc('minute', now()); v_ins int; v_del int; v_sig jsonb;
begin
  if p_token is null or p_token is distinct from (select token from private.track_config where id = 1) then
    raise exception 'unauthorized';
  end if;
  insert into market_snapshots (t, coin, px, oi, funding_hourly, premium, volume24h)
  select v_now, r->>'coin', (r->>'px')::float8, (r->>'oi')::float8, (r->>'funding')::float8,
         (r->>'premium')::float8, (r->>'vol')::float8
  from jsonb_array_elements(p_rows) r
  on conflict (coin, t) do nothing;
  get diagnostics v_ins = row_count;
  begin
    v_sig := signal_tick(v_now);
  exception when others then
    v_sig := jsonb_build_object('error', sqlerrm);
  end;
  delete from market_snapshots where t < now() - interval '7 days';
  get diagnostics v_del = row_count;
  return jsonb_build_object('inserted', v_ins, 'pruned', v_del, 'signals', v_sig);
end $function$;

-- Public read: hit rates per screen × horizon, raw and vs market.
create or replace function public.signal_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  with h as (
    select signal, dir, '1h' hz, ret_1h r, mkt_1h m from signal_events where ret_1h is not null and mkt_1h is not null
    union all select signal, dir, '4h', ret_4h, mkt_4h from signal_events where ret_4h is not null and mkt_4h is not null
    union all select signal, dir, '24h', ret_24h, mkt_24h from signal_events where ret_24h is not null and mkt_24h is not null
  ),
  agg as (
    select signal, hz, jsonb_build_object(
      'n', count(*),
      'hit_rate', avg((sign(r) = dir)::int),
      'edge_bps', avg(r * dir) * 10000,
      'ex_hit_rate', avg((sign(r - m) = dir)::int),
      'ex_edge_bps', avg((r - m) * dir) * 10000,
      'ex_median_bps', percentile_cont(0.5) within group (order by (r - m) * dir) * 10000
    ) b from h group by signal, hz
  )
  select jsonb_build_object(
    'since', (select min(t) from signal_events),
    'events', (select count(*) from signal_events),
    'by_signal', coalesce((select jsonb_object_agg(signal, x) from (
        select signal, jsonb_object_agg(hz, b) x from agg group by signal) y), '{}'::jsonb),
    'counts', coalesce((select jsonb_object_agg(signal, n) from (select signal, count(*) n from signal_events group by signal) c), '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.t desc) from (
        select t, coin, signal, dir, f8, oi_chg4h, px_chg4h, funding_pctile, oi_z, ret_1h, mkt_1h, ret_4h, mkt_4h
        from signal_events order by t desc limit 40) x), '[]'::jsonb)
  );
$$;
grant execute on function public.signal_stats() to anon, authenticated;
