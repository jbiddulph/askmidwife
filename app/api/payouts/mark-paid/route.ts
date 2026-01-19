import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type MarkPaidPayload = {
  requestId: string;
};

export async function POST(request: Request) {
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

  const payload = (await request.json()) as MarkPaidPayload;

  if (!payload?.requestId) {
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
    .eq("id", payload.requestId)
    .maybeSingle();

  if (requestError || !requestRow) {
    return NextResponse.json(
      { error: "Payout request not found." },
      { status: 404 },
    );
  }

  if (requestRow.status !== "pending") {
    return NextResponse.json(
      { error: "Payout request is not pending." },
      { status: 400 },
    );
  }

  const { error: updateError } = await supabase
    .from("askmidwife_payout_requests")
    .update({ status: "paid" })
    .eq("id", payload.requestId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update payout request." },
      { status: 500 },
    );
  }

  const { error: insertError } = await supabase
    .from("askmidwife_payout_payments")
    .insert({
      request_id: payload.requestId,
      provider_id: requestRow.provider_id,
      amount_gbp: requestRow.amount_gbp,
      payout_provider: "manual",
      payout_reference: null,
      status: "paid",
      processed_at: new Date().toISOString(),
    });

  if (insertError) {
    return NextResponse.json(
      { error: "Failed to record payout payment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "paid" });
}
