import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

const toGbpAmount = (amountInMinor: number | null | undefined) =>
  Number(((amountInMinor ?? 0) / 100).toFixed(2));

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id." },
      { status: 400 },
    );
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent", "payment_intent.charges.data.balance_transaction"],
  });

  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment is not marked as paid." },
      { status: 400 },
    );
  }

  if (session.currency?.toLowerCase() !== "gbp") {
    return NextResponse.json(
      { error: "Unsupported currency in checkout session." },
      { status: 400 },
    );
  }

  const metadata = session.metadata ?? {};
  const appointmentId = metadata.appointment_id;

  if (!appointmentId) {
    return NextResponse.json(
      { error: "Missing appointment_id in session metadata." },
      { status: 400 },
    );
  }

  const paymentIntent =
    typeof session.payment_intent === "object" ? session.payment_intent : null;
  const paymentIntentId = paymentIntent?.id ?? null;
  const charge = paymentIntent?.charges?.data?.[0];
  const balanceTransaction =
    typeof charge?.balance_transaction === "object"
      ? charge.balance_transaction
      : null;

  const stripeFeeGbp =
    balanceTransaction && "fee" in balanceTransaction
      ? toGbpAmount(balanceTransaction.fee)
      : null;
  const stripeNetGbp =
    balanceTransaction && "net" in balanceTransaction
      ? toGbpAmount(balanceTransaction.net)
      : null;

  const supabase = createSupabaseServerClient();
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
