import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paypalClientId = process.env.PAYPAL_CLIENT_ID;
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
const paypalApiBase =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

type PaypalPayload = {
  requestId: string;
};

type PaypalTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type PaypalPayoutResponse = {
  batch_header?: {
    payout_batch_id?: string;
    batch_status?: string;
  };
};

export async function POST(request: Request) {
  if (supabaseUrl) {
    const host = new URL(supabaseUrl).host;
    const projectRef = host.split(".")[0];
    console.log("[paypal payout] supabase host:", host);
    console.log("[paypal payout] supabase project ref:", projectRef);
  } else {
    console.log("[paypal payout] NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!paypalClientId || !paypalClientSecret) {
    return NextResponse.json(
      { error: "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET." },
      { status: 500 },
    );
  }

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

  const payload = (await request.json()) as PaypalPayload;

  const requestId = payload?.requestId?.trim();

  if (!requestId) {
    return NextResponse.json(
      { error: "Missing payout request id." },
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

  const { data: profile, error: profileError } = await supabase
    .from("askmidwife_profiles")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const { data: requestRow, error: requestError } = await supabase
    .from("askmidwife_payout_requests")
    .select("id, provider_id, amount_gbp, paypal_email, status")
    .eq("id", requestId)
    .maybeSingle();

  if (requestError || !requestRow) {
    const host = supabaseUrl ? new URL(supabaseUrl).host : null;
    const projectRef = host ? host.split(".")[0] : null;
    const { count } = await supabase
      .from("askmidwife_payout_requests")
      .select("id", { count: "exact", head: true });
    return NextResponse.json(
      {
        error: "Payout request not found.",
        projectRef,
        requestId,
        rowCount: count ?? 0,
      },
      { status: 404 },
    );
  }

  if (requestRow.status !== "pending") {
    return NextResponse.json(
      { error: "Payout request is not pending." },
      { status: 400 },
    );
  }

  if (!requestRow.paypal_email) {
    return NextResponse.json(
      { error: "PayPal email is missing for this request." },
      { status: 400 },
    );
  }

  const tokenResponse = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${paypalClientId}:${paypalClientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: "Failed to authenticate with PayPal." },
      { status: 502 },
    );
  }

  const tokenJson = (await tokenResponse.json()) as PaypalTokenResponse;

  const payoutResponse = await fetch(`${paypalApiBase}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: requestRow.id,
        email_subject: "Ask Midwife payout",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: {
            value: Number(requestRow.amount_gbp).toFixed(2),
            currency: "GBP",
          },
          receiver: requestRow.paypal_email,
          note: "Ask Midwife payout request",
          sender_item_id: requestRow.id,
        },
      ],
    }),
  });

  if (!payoutResponse.ok) {
    return NextResponse.json(
      { error: "Failed to initiate PayPal payout." },
      { status: 502 },
    );
  }

  const payoutJson = (await payoutResponse.json()) as PaypalPayoutResponse;
  const batchId = payoutJson.batch_header?.payout_batch_id ?? null;
  const batchStatus = payoutJson.batch_header?.batch_status ?? "PENDING";
  const normalizedStatus =
    batchStatus === "SUCCESS" ? "paid" : "pending";

  const { error: insertError } = await supabase
    .from("askmidwife_payout_payments")
    .insert({
      request_id: requestRow.id,
      provider_id: requestRow.provider_id,
      amount_gbp: requestRow.amount_gbp,
      payout_provider: "paypal",
      payout_reference: batchId,
      status: normalizedStatus,
      processed_at:
        normalizedStatus === "paid" ? new Date().toISOString() : null,
    });

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to record PayPal payout." },
      { status: 500 },
    );
  }

  if (normalizedStatus === "paid") {
    await supabase
      .from("askmidwife_payout_requests")
      .update({ status: "paid" })
      .eq("id", requestRow.id);
  }

  return NextResponse.json({ status: normalizedStatus });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
