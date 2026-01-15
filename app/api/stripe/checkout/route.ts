import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

type CheckoutPayload = {
  providerId: string;
  startsAt: string;
  endsAt: string;
  notes?: string | null;
};

const toAmountInPence = (amount: number) => Math.round(amount * 100);

export async function POST(request: Request) {
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: "Missing STRIPE_SECRET_KEY." },
      { status: 500 },
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2024-06-20",
  });

  const tokenHeader = request.headers.get("authorization") ?? "";
  const token = tokenHeader.startsWith("Bearer ")
    ? tokenHeader.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json(
      { error: "Missing authentication token." },
      { status: 401 },
    );
  }

  const payload = (await request.json()) as CheckoutPayload;

  if (!payload?.providerId || !payload?.startsAt || !payload?.endsAt) {
    return NextResponse.json(
      { error: "Missing provider or appointment time details." },
      { status: 400 },
    );
  }

  const start = new Date(payload.startsAt);
  const end = new Date(payload.endsAt);
  const durationMinutes = Math.round(
    (end.getTime() - start.getTime()) / 60000,
  );

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return NextResponse.json(
      { error: "Invalid appointment duration." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );

  if (userError || !userData.user) {
    return NextResponse.json(
      { error: "Invalid authentication token." },
      { status: 401 },
    );
  }

  const { data: provider, error: providerError } = await supabase
    .from("askmidwife_profiles")
    .select("id, display_name, role, hourly_pay_gbp")
    .eq("id", payload.providerId)
    .maybeSingle();

  if (providerError) {
    return NextResponse.json(
      { error: providerError.message },
      { status: 400 },
    );
  }

  if (!provider) {
    return NextResponse.json(
      { error: "Provider profile not found." },
      { status: 400 },
    );
  }

  if (provider.role !== "medical") {
    return NextResponse.json(
      { error: "Provider role is not medical." },
      { status: 400 },
    );
  }

  if (provider.hourly_pay_gbp == null || provider.hourly_pay_gbp < 0) {
    return NextResponse.json(
      { error: "Provider hourly rate is not configured." },
      { status: 400 },
    );
  }

  const hourlyRate = Number(provider.hourly_pay_gbp);
  const grossAmount = Number(
    ((hourlyRate * durationMinutes) / 60).toFixed(2),
  );
  const platformFee = Number((grossAmount * 0.15).toFixed(2));
  const providerEarnings = Number((grossAmount - platformFee).toFixed(2));

  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    return NextResponse.json(
      { error: "Unable to compute appointment price." },
      { status: 400 },
    );
  }

  const { data: appointmentData, error: appointmentError } = await supabase
    .from("askmidwife_appointments")
    .insert({
      patient_id: userData.user.id,
      provider_id: provider.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: "requested",
      notes: payload.notes ?? null,
    })
    .select("id")
    .maybeSingle();

  if (appointmentError || !appointmentData?.id) {
    return NextResponse.json(
      { error: "Failed to create appointment." },
      { status: 500 },
    );
  }

  const { error: paymentError } = await supabase
    .from("askmidwife_appointment_payments")
    .insert({
      appointment_id: appointmentData.id,
      patient_id: userData.user.id,
      provider_id: provider.id,
      currency: "GBP",
      hourly_rate_gbp: hourlyRate,
      duration_minutes: durationMinutes,
      gross_amount_gbp: grossAmount,
      platform_fee_gbp: platformFee,
      provider_earnings_gbp: providerEarnings,
      status: "pending",
    });

  if (paymentError) {
    return NextResponse.json(
      { error: "Failed to create payment record." },
      { status: 500 },
    );
  }

  const origin =
    request.headers.get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    success_url: `${origin}/profile?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/profile?payment=cancel`,
    client_reference_id: userData.user.id,
    metadata: {
      appointment_id: appointmentData.id,
      patient_id: userData.user.id,
      provider_id: provider.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      duration_minutes: durationMinutes.toString(),
      hourly_rate_gbp: hourlyRate.toFixed(2),
      notes: payload.notes ?? "",
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: toAmountInPence(grossAmount),
          product_data: {
            name: "Ask Midwife consultation",
            description: `${
              provider.display_name ?? "Medical professional"
            } · ${durationMinutes} minutes`,
          },
        },
      },
    ],
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe checkout session failed to initialize." },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
