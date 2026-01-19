import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type UpdatePayload = {
  appointmentId: string;
  startsAt: string;
  endsAt: string;
  status: "requested" | "proposed" | "confirmed" | "cancelled" | "completed";
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

  const payload = (await request.json()) as UpdatePayload;

  if (!payload?.appointmentId || !payload?.startsAt || !payload?.endsAt) {
    return NextResponse.json(
      { error: "Missing appointment details." },
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

  const { data, error } = await supabase
    .from("askmidwife_appointments")
    .update({
      starts_at: payload.startsAt,
      ends_at: payload.endsAt,
      status: payload.status,
    })
    .eq("id", payload.appointmentId)
    .select(
      "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update appointment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ appointment: data });
}
