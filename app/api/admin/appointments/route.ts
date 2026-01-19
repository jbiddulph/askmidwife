import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const nowIso = new Date().toISOString();
  const { data: appointments, error: appointmentsError } = await supabase
    .from("askmidwife_appointments")
    .select(
      "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
    )
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true });

  if (appointmentsError) {
    return NextResponse.json(
      { error: appointmentsError.message },
      { status: 500 },
    );
  }

  const profileIds = Array.from(
    new Set(
      (appointments ?? []).flatMap((appointment) => [
        appointment.patient_id,
        appointment.provider_id,
      ]),
    ),
  );

  let profiles = [];
  if (profileIds.length) {
    const { data: profileData } = await supabase
      .from("askmidwife_profiles")
      .select("id, email, display_name, role")
      .in("id", profileIds);
    profiles = profileData ?? [];
  }

  return NextResponse.json({
    appointments: appointments ?? [],
    profiles,
  });
}
