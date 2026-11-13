-- Finish the 038 backfill.
--
-- 038 stated the rule for an existing paid account as "the end of its last
-- approved pass when that is later, otherwise one month from this migration".
-- The expression it used returned `now()` when the last pass had already
-- ended, so those accounts were dropped to the free tier on the spot instead
-- of getting the month the migration promised. An account whose only history
-- was a redeemed code did get the month, which is the opposite of what was
-- intended.
--
-- This gives the stated window to every account that bought a pass and whose
-- window is now absent or past. A live window is never shortened, and the
-- update is idempotent.
update public.profiles p
   set paid_until = now() + interval '30 days'
 where p.has_paid = true
   and (p.paid_until is null or p.paid_until <= now())
   and exists (
     select 1
       from public.payment_requests r
      where r.owner = p.id
        and r.status = 'approved'
        and r.plan in ('pass-15', 'pass-30')
   );
