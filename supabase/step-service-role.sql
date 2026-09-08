-- S333XHUB — privileges for the server-side role.
--
-- The Edge Functions (stripe-payment-intent, stripe-webhook, rc-webhook)
-- talk to the database as service_role, using the sb_secret key. A
-- standard Supabase project hands that role every privilege on the public
-- schema out of the box; this new-generation project does not, so the
-- checkout function was refused with
--   42501: permission denied for table shows
-- even though it held the right key. Earlier steps only granted the role
-- the ticket tables it was written alongside.
--
-- Give service_role what a standard project gives it: everything in
-- public, for the tables and functions that exist now AND for any made
-- later, so this never has to be repeated per table. The role is only
-- ever used from server code holding the secret key; it already bypasses
-- row-level security, so no new exposure is created for fans or artists.
-- Safe to run more than once.

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute        on all functions in schema public to service_role;

-- ...and for every table / sequence / function created from here on.
alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
