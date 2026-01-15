import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeSecretKey || !stripeWebhookSecret) {
  throw new Error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

const toGbpAmount = (amountInMinor: number | null | undefined) =>
  Number(((amountInMinor ?? 0) / 100).toFixed(2));

export async function POST(request: Request) {
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 },
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      stripeWebhookSecret,
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Webhook signature verification failed." },
      { status: 400 },
    );
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = session.metadata ?? {};
  const appointmentId = metadata.appointment_id;
  const patientId = metadata.patient_id;
  const providerId = metadata.provider_id;
  const startsAt = metadata.starts_at;
  const endsAt = metadata.ends_at;
  const durationMinutes = Number(metadata.duration_minutes ?? "0");
  const hourlyRate = Number(metadata.hourly_rate_gbp ?? "0");
  const notes = metadata.notes || null;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  if (
    !appointmentId ||
    !patientId ||
    !providerId ||
    !startsAt ||
    !endsAt ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate <= 0
  ) {
    return NextResponse.json(
      { error: "Invalid metadata on checkout session." },
      { status: 400 },
    );
  }

  if (session.currency?.toLowerCase() !== "gbp") {
    return NextResponse.json(
      { error: "Unsupported currency in checkout session." },
      { status: 400 },
    );
  }

  const grossAmount = toGbpAmount(session.amount_total);
  const platformFee = Number((grossAmount * 0.15).toFixed(2));
  const providerEarnings = Number((grossAmount - platformFee).toFixed(2));
  let stripeFeeGbp: number | null = null;
  let stripeNetGbp: number | null = null;

  if (paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      {
        expand: ["charges.data.balance_transaction"],
      },
    );
    const charge = paymentIntent.charges.data[0];
    const balanceTransaction =
      typeof charge?.balance_transaction === "object"
        ? charge.balance_transaction
        : null;

    if (balanceTransaction && "fee" in balanceTransaction) {
      stripeFeeGbp = toGbpAmount(balanceTransaction.fee);
      stripeNetGbp = toGbpAmount(balanceTransaction.net);
    }
  }

  const supabase = createSupabaseServerClient();

  if (paymentIntentId) {
    const { data: existingPayment } = await supabase
      .from("askmidwife_appointment_payments")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();

    if (existingPayment?.id) {
      return NextResponse.json({ received: true });
    }
  }

  const { data: paymentRecord, error: paymentFetchError } = await supabase
    .from("askmidwife_appointment_payments")
    .select("id, status")
    .eq("appointment_id", appointmentId)
    .maybeSingle();

  if (paymentFetchError || !paymentRecord?.id) {
    return NextResponse.json(
      { error: "Payment record not found for appointment." },
      { status: 404 },
    );
  }

  if (paymentRecord.status === "paid") {
    return NextResponse.json({ received: true });
  }

  const { error: paymentError } = await supabase
    .from("askmidwife_appointment_payments")
    .update({
      stripe_fee_gbp: stripeFeeGbp,
      stripe_net_gbp: stripeNetGbp,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
    })
    .eq("id", paymentRecord.id);

  if (paymentError) {
    return NextResponse.json(
      { error: "Failed to update payment record." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
