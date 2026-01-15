-- Track Stripe processing fees alongside platform fees.
alter table public.askmidwife_appointment_payments
  add column if not exists stripe_fee_gbp numeric(10, 2),
  add column if not exists stripe_net_gbp numeric(10, 2);

alter table public.askmidwife_appointment_payments
  drop constraint if exists askmidwife_appointment_payments_stripe_check;

alter table public.askmidwife_appointment_payments
  add constraint askmidwife_appointment_payments_stripe_check
    check (
      stripe_fee_gbp is null
      or stripe_net_gbp is null
      or stripe_net_gbp = gross_amount_gbp - stripe_fee_gbp
    );
