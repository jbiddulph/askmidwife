"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AuthMode = "sign-in" | "sign-up";

type ProfileRole = "medical" | "client" | "admin";

type Appointment = {
  id: string;
  patient_id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  status: "requested" | "proposed" | "confirmed" | "cancelled" | "completed";
};

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: ProfileRole;
};

type Status = {
  type: "idle" | "error" | "success" | "loading";
  message?: string;
};

export default function Home() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<ProfileRole | null>(null);
  const [upcomingAppointments, setUpcomingAppointments] = useState<
    Appointment[]
  >([]);
  const [appointmentLookup, setAppointmentLookup] = useState<
    Record<string, Profile>
  >({});
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUserEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      if (!mounted) return;
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!userId) {
      setUserRole(null);
      return;
    }

    const loadRole = async () => {
      const { data, error } = await supabase
        .from("askmidwife_profiles")
        .select("id, email, display_name, role")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        return;
      }

      if (!data?.role) {
        setUserRole(null);
        return;
      }

      setUserRole(data.role as ProfileRole);
    };

    loadRole();
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId || !userRole) {
      setUpcomingAppointments([]);
      return;
    }

    const loadAppointments = async () => {
      setLoadingAppointments(true);
      const nowIso = new Date().toISOString();
      const baseQuery = supabase
        .from("askmidwife_appointments")
        .select("id, patient_id, provider_id, starts_at, ends_at, status")
        .in("status", ["requested", "proposed", "confirmed"])
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(5);

      const { data, error } =
        userRole === "medical"
          ? await baseQuery.eq("provider_id", userId)
          : await baseQuery.eq("patient_id", userId);

      if (error) {
        setLoadingAppointments(false);
        return;
      }

      const appointmentsData = data ?? [];
      setUpcomingAppointments(appointmentsData);

      const counterpartIds = Array.from(
        new Set(
          appointmentsData.map((appointment) =>
            userRole === "medical"
              ? appointment.patient_id
              : appointment.provider_id,
          ),
        ),
      );

      if (counterpartIds.length) {
        const { data: profileData } = await supabase
          .from("askmidwife_profiles")
          .select("id, email, display_name, role")
          .in("id", counterpartIds);

        if (profileData) {
          setAppointmentLookup((prev) => {
            const next = { ...prev };
            profileData.forEach((profile) => {
              next[profile.id] = profile;
            });
            return next;
          });
        }
      }

      setLoadingAppointments(false);
    };

    loadAppointments();
  }, [supabase, userId, userRole]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus({ type: "loading" });

    if (!email || !password) {
      setStatus({ type: "error", message: "Email and password are required." });
      return;
    }

    if (mode === "sign-up") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setStatus({ type: "error", message: error.message });
        return;
      }
      setStatus({
        type: "success",
        message:
          "Check your inbox to confirm your account, then sign in to continue.",
      });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }

    setStatus({ type: "success", message: "Signed in successfully." });
  };

  const handleSignOut = async () => {
    setStatus({ type: "loading" });
    const { error } = await supabase.auth.signOut();
    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }
    setStatus({ type: "success", message: "Signed out." });
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-12 text-zinc-900">
      <div className="pointer-events-none absolute left-[-10%] top-[-20%] h-[320px] w-[320px] rounded-full bg-emerald-200/60 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-amber-200/70 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-10 lg:flex-row lg:gap-16">
        <section className="flex flex-1 flex-col justify-between gap-10 rounded-[32px] border border-zinc-200/70 bg-white/80 p-10 shadow-[0_25px_80px_-60px_rgba(15,23,42,0.35)] backdrop-blur">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
              Ask Midwife
            </div>
            <h1 className="text-balance font-[var(--font-display)] text-4xl font-semibold leading-tight text-zinc-900 lg:text-5xl">
              A calm, clinical space for pregnancy care and professional
              consults.
            </h1>
            <p className="max-w-xl text-base text-zinc-600 lg:text-lg">
              Sign in to manage your care, track upcoming appointments, and
              connect with licensed doctors or nurses who know your journey.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "Verified clinicians",
                detail: "Medical professionals with real-world experience.",
              },
              {
                title: "Private records",
                detail: "Protected by Supabase authentication and policies.",
              },
              {
                title: "Flexible scheduling",
                detail: "Book around your time zone and availability.",
              },
              {
                title: "Care notes",
                detail: "Keep every consultation in one secure place.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-zinc-200/70 bg-white px-5 py-4"
              >
                <p className="text-sm font-semibold text-zinc-900">
                  {item.title}
                </p>
                <p className="mt-2 text-sm text-zinc-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex w-full max-w-xl flex-col gap-6">
          {!userEmail && (
            <div className="rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-55px_rgba(15,23,42,0.4)]">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                  Access portal
                </p>
                <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                  {mode === "sign-in" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="text-sm text-zinc-500">
                  Secure sign in or create an account in seconds.
                </p>
              </div>

              <div className="mt-6 flex gap-2 rounded-full border border-zinc-200 bg-zinc-50 p-1">
                <button
                  type="button"
                  className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    mode === "sign-in"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-zinc-600"
                  }`}
                  onClick={() => setMode("sign-in")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    mode === "sign-up"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-zinc-600"
                  }`}
                  onClick={() => setMode("sign-up")}
                >
                  Sign up
                </button>
              </div>

              <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  Email address
                  <input
                    type="email"
                    name="email"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  Password
                  <input
                    type="password"
                    name="password"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                    autoComplete={
                      mode === "sign-in" ? "current-password" : "new-password"
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>

                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  disabled={status.type === "loading"}
                >
                  {mode === "sign-in" ? "Sign in" : "Create account"}
                </button>

                {status.type !== "idle" && status.message && (
                  <p
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      status.type === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {status.message}
                  </p>
                )}
              </form>
            </div>
          )}

          <div className="rounded-[28px] border border-zinc-200/70 bg-white p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                  Current session
                </p>
                <p className="mt-2 text-lg font-semibold text-zinc-900">
                  {userEmail ?? "Not signed in"}
                </p>
                <p className="text-sm text-zinc-500">
                  {userEmail
                    ? "You can now manage your profile and bookings."
                    : "Sign in to unlock scheduling and consultations."}
                </p>
              </div>
            </div>
            {userEmail && !userRole && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Finish setting up your profile to choose a role and start booking
                consultations.
              </div>
            )}
            {userEmail && userRole && (
              <div className="mt-6 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Upcoming meetings
                </p>
                {loadingAppointments ? (
                  <p className="text-sm text-zinc-500">Loading meetings…</p>
                ) : upcomingAppointments.length ? (
                  <div className="space-y-3">
                    {upcomingAppointments.map((appointment) => {
                      const counterpartId =
                        userRole === "medical"
                          ? appointment.patient_id
                          : appointment.provider_id;
                      const counterpart = appointmentLookup[counterpartId];
                      const canConnect = appointment.status === "confirmed";

                      return (
                        <div
                          key={appointment.id}
                          className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-zinc-900">
                            {counterpart?.display_name ||
                              counterpart?.email ||
                              "Consultation"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {new Date(appointment.starts_at).toLocaleString(
                              "en-GB",
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              },
                            )}{" "}
                            –{" "}
                            {new Date(appointment.ends_at).toLocaleTimeString(
                              "en-GB",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                            {appointment.status}
                          </p>
                          {canConnect && (
                            <Link
                              className="mt-3 inline-flex items-center rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                              href={`/appointments/${appointment.id}/connect`}
                            >
                              Connect now
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">
                    No upcoming meetings yet.
                  </p>
                )}
              </div>
            )}
            {userEmail && (
              <div className="mt-5 flex flex-wrap gap-3">
                {userRole === "client" && (
                  <Link
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    href="/profile#booking-calendar"
                  >
                    Book a consultation
                  </Link>
                )}
                <Link
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                  href="/profile"
                >
                  Manage profile
                </Link>
                <button
                  type="button"
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                  onClick={handleSignOut}
                  disabled={status.type === "loading"}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
