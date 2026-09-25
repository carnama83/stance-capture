-- Epic R — R-06: a collective opt-in can be withdrawn (US-R09/US-R10)
--
-- collective_action_optins had SELECT-own and INSERT-own policies only, so an
-- opt-in to the public "visible support" count could never be taken back.
-- This adds an owner-only DELETE policy. A withdrawal takes effect in the next
-- ledger publication: a published ledger is a snapshot, and its optin_count
-- is frozen at publish time.

DROP POLICY IF EXISTS "Users can delete their own opt-in" ON public.collective_action_optins;
CREATE POLICY "Users can delete their own opt-in" ON public.collective_action_optins
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Browser roles never need UPDATE or TRUNCATE on this table.
REVOKE UPDATE, TRUNCATE ON public.collective_action_optins FROM PUBLIC, anon, authenticated;
