import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paypalClientId = process.env.PAYPAL_CLIENT_ID;
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
const paypalApiBase =
  process.env.PAYPAL_API_BASE ??
  (process.env.NODE_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com");
const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID;

type PaypalVerifyResponse = {
  verification_status: "SUCCESS" | "FAILURE";
};

type PaypalWebhookEvent = {
  event_type: string;
  resource?: {
    payout_item_id?: string;
    payout_item?: {
      sender_item_id?: string;
    };
    sender_item_id?: string;
    amount?: {
      value?: string;
      currency?: string;
    };
  };
};

const successEvents = new Set([
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.COMPLETED",
  "PAYOUTS-ITEM.SUCCEEDED",
]);

const failureEvents = new Set([
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYOUTS-ITEM.FAILED",
  "PAYOUTS-ITEM.DENIED",
  "PAYOUTS-ITEM.RETURNED",
]);

async function getPaypalAccessToken() {
  if (!paypalClientId || !paypalClientSecret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET.");
  }

  const response = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${paypalClientId}:${paypalClientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    throw new Error("Failed to authenticate with PayPal.");
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("PayPal token missing.");
  }

  return json.access_token;
}

async function verifyWebhookSignature(rawBody: string, request: Request) {
  if (!paypalWebhookId) {
    throw new Error("Missing PAYPAL_WEBHOOK_ID.");
  }

  const transmissionId = request.headers.get("paypal-transmission-id");
  const transmissionTime = request.headers.get("paypal-transmission-time");
  const certUrl = request.headers.get("paypal-cert-url");
  const authAlgo = request.headers.get("paypal-auth-algo");
  const transmissionSig = request.headers.get("paypal-transmission-sig");

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    throw new Error("Missing PayPal signature headers.");
  }

  const accessToken = await getPaypalAccessToken();
  const verifyResponse = await fetch(
    `${paypalApiBase}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transmission_id: transmissionId,
        transmission_time: transmissionTime,
        cert_url: certUrl,
        auth_algo: authAlgo,
        transmission_sig: transmissionSig,
        webhook_id: paypalWebhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    },
  );

  if (!verifyResponse.ok) {
    throw new Error("Failed to verify PayPal webhook signature.");
  }

  const verifyJson = (await verifyResponse.json()) as PaypalVerifyResponse;
  if (verifyJson.verification_status !== "SUCCESS") {
    throw new Error("PayPal webhook signature verification failed.");
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    await verifyWebhookSignature(rawBody, request);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }

  const event = JSON.parse(rawBody) as PaypalWebhookEvent;
  const eventType = event.event_type ?? "";

  if (!successEvents.has(eventType) && !failureEvents.has(eventType)) {
    return NextResponse.json({ received: true });
  }

  const senderItemId =
    event.resource?.payout_item?.sender_item_id ??
    event.resource?.sender_item_id ??
    null;

  if (!senderItemId) {
    return NextResponse.json(
      { error: "Missing sender item id." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: requestRow } = await supabase
    .from("askmidwife_payout_requests")
    .select("id, provider_id, amount_gbp, status")
    .eq("id", senderItemId)
    .maybeSingle();

  if (!requestRow) {
    return NextResponse.json({ received: true });
  }

  const normalizedStatus = successEvents.has(eventType) ? "paid" : "failed";
  const payoutStatus = normalizedStatus === "paid" ? "paid" : "failed";

  const { data: providerProfile } = await supabase
    .from("askmidwife_profiles")
    .select("id, role")
    .eq("id", requestRow.provider_id)
    .maybeSingle();

  const { data: paymentRow } = await supabase
    .from("askmidwife_payout_payments")
    .select("id")
    .eq("request_id", senderItemId)
    .eq("payout_provider", "paypal")
    .maybeSingle();

  const payoutReference = event.resource?.payout_item_id ?? null;
  const payoutAmount = event.resource?.amount?.value
    ? Number(event.resource.amount.value)
    : Number(requestRow.amount_gbp);

  if (paymentRow?.id) {
    await supabase
      .from("askmidwife_payout_payments")
      .update({
        status: payoutStatus,
        payout_reference: payoutReference,
        processed_at: new Date().toISOString(),
      })
      .eq("id", paymentRow.id);
  } else {
    await supabase.from("askmidwife_payout_payments").insert({
      request_id: senderItemId,
      provider_id: requestRow.provider_id,
      amount_gbp: payoutAmount,
      payout_provider: "paypal",
      payout_reference: payoutReference,
      status: payoutStatus,
      processed_at: new Date().toISOString(),
    });
  }

  await supabase
    .from("askmidwife_payout_requests")
    .update({ status: normalizedStatus })
    .eq("id", senderItemId);

  await supabase
    .from("askmidwife_appointment_payments")
    .update({
      payout_request_id: senderItemId,
      payout_status: payoutStatus,
      payout_paid_at:
        payoutStatus === "paid" ? new Date().toISOString() : null,
    })
    .eq("provider_id", requestRow.provider_id)
    .eq("status", "paid")
    .or(
      payoutStatus === "paid"
        ? "payout_status.is.null,payout_status.eq.pending"
        : "payout_status.is.null",
    );

  if (providerProfile?.role === "admin" && payoutStatus === "paid") {
    await supabase
      .from("askmidwife_platform_fees")
      .update({
        payout_request_id: senderItemId,
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .is("payout_request_id", null)
      .eq("status", "earned");
  }

  return NextResponse.json({ received: true });
}
