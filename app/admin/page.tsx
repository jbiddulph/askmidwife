"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ProfileRole = "medical" | "client" | "admin";

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: ProfileRole;
  paypal_email?: string | null;
};

type PayoutRequest = {
  id: string;
  provider_id: string;
  amount_gbp: number;
  paypal_email: string | null;
  status: "pending" | "paid" | "rejected";
  created_at: string;
};

type PayoutPayment = {
  id: string;
  request_id: string | null;
  provider_id: string;
  amount_gbp: number;
  payout_provider: "manual" | "paypal";
  status: "pending" | "paid" | "failed";
  processed_at: string | null;
};

type PlatformFeeSummary = {
  earned: number;
  pending: number;
  paid: number;
};

type Status = {
  type: "idle" | "loading" | "error";
  message?: string;
};

type ActionStatus = {
  type: "idle" | "loading" | "error" | "success";
  message?: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<Status>({ type: "loading" });
  const [payoutsStatus, setPayoutsStatus] = useState<Status>({
    type: "idle",
  });
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [providerLookup, setProviderLookup] = useState<Record<string, Profile>>(
    {},
  );
  const [payoutActionStatus, setPayoutActionStatus] = useState<
    Record<string, ActionStatus>
  >({});
  const [paidPayouts, setPaidPayouts] = useState<PayoutPayment[]>([]);
  const [loadingPaidPayouts, setLoadingPaidPayouts] = useState(false);
  const [platformFees, setPlatformFees] = useState<PlatformFeeSummary>({
    earned: 0,
    pending: 0,
    paid: 0,
  });
  const [loadingPlatformFees, setLoadingPlatformFees] = useState(false);
  const [platformPayoutStatus, setPlatformPayoutStatus] = useState<ActionStatus>({
    type: "idle",
  });

  useEffect(() => {
    let mounted = true;

    const loadProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        if (mounted) {
          setStatus({
            type: "error",
            message: "You need to sign in to access the admin area.",
          });
        }
        return;
      }

      const { data, error } = await supabase
        .from("askmidwife_profiles")
        .select("id, email, display_name, role, paypal_email")
        .eq("id", userId)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setStatus({ type: "error", message: error.message });
        return;
      }

      setProfile(data ?? null);
      setStatus({ type: "idle" });
    };

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  const isAdmin = profile?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;

    const loadPayoutRequests = async () => {
      setPayoutsStatus({ type: "loading" });
      const { data, error } = await supabase
        .from("askmidwife_payout_requests")
        .select("id, provider_id, amount_gbp, paypal_email, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        setPayoutsStatus({ type: "error", message: error.message });
        return;
      }

      const requests = (data as PayoutRequest[]) ?? [];
      setPayoutRequests(requests);

      const providerIds = Array.from(
        new Set(requests.map((request) => request.provider_id)),
      );

      if (providerIds.length) {
        const { data: profileData } = await supabase
          .from("askmidwife_profiles")
          .select("id, email, display_name, role")
          .in("id", providerIds);

        if (profileData) {
          setProviderLookup((prev) => {
            const next = { ...prev };
            profileData.forEach((item) => {
              next[item.id] = item;
            });
            return next;
          });
        }
      }

      setPayoutsStatus({ type: "idle" });
    };

    loadPayoutRequests();
  }, [isAdmin, supabase]);

  useEffect(() => {
    if (!isAdmin) return;

    const loadPaidPayouts = async () => {
      setLoadingPaidPayouts(true);
      const { data, error } = await supabase
        .from("askmidwife_payout_payments")
        .select("id, request_id, provider_id, amount_gbp, payout_provider, status, processed_at")
        .eq("status", "paid")
        .order("processed_at", { ascending: false });

      if (!error) {
        const payouts = (data as PayoutPayment[]) ?? [];
        setPaidPayouts(payouts);

        const providerIds = Array.from(
          new Set(payouts.map((payout) => payout.provider_id)),
        );
        if (providerIds.length) {
          const { data: profileData } = await supabase
            .from("askmidwife_profiles")
            .select("id, email, display_name, role")
            .in("id", providerIds);

          if (profileData) {
            setProviderLookup((prev) => {
              const next = { ...prev };
              profileData.forEach((item) => {
                next[item.id] = item;
              });
              return next;
            });
          }
        }
      }
      setLoadingPaidPayouts(false);
    };

    loadPaidPayouts();
  }, [isAdmin, supabase]);

  useEffect(() => {
    if (!isAdmin) return;

    const loadPlatformFees = async () => {
      setLoadingPlatformFees(true);
      const { data, error } = await supabase
        .from("askmidwife_platform_fees")
        .select("amount_gbp, status");

      if (!error) {
        const summary = (data ?? []).reduce(
          (acc, item) => {
            const amount = Number(item.amount_gbp) || 0;
            if (item.status === "paid") {
              acc.paid += amount;
            } else if (item.status === "pending") {
              acc.pending += amount;
            } else {
              acc.earned += amount;
            }
            return acc;
          },
          { earned: 0, pending: 0, paid: 0 },
        );
        setPlatformFees(summary);
      }
      setLoadingPlatformFees(false);
    };

    loadPlatformFees();
  }, [isAdmin, supabase]);

  const updateActionStatus = (requestId: string, next: ActionStatus) => {
    setPayoutActionStatus((prev) => ({
      ...prev,
      [requestId]: next,
    }));
  };

  const handlePayoutAction = async (
    request: PayoutRequest,
    action: "mark-paid" | "paypal",
  ) => {
    updateActionStatus(request.id, { type: "loading" });

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      updateActionStatus(request.id, {
        type: "error",
        message: "Sign in again to perform this action.",
      });
      return;
    }

    const response = await fetch(`/api/payouts/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({ requestId: request.id }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      updateActionStatus(request.id, {
        type: "error",
        message: payload.error ?? "Unable to update payout request.",
      });
      return;
    }

    const payload = (await response.json()) as { status?: string };
    const isPaid = payload.status === "paid";

    updateActionStatus(request.id, {
      type: "success",
      message: isPaid
        ? "Marked as paid."
        : "PayPal payout initiated and pending.",
    });

    if (isPaid) {
      setPayoutRequests((prev) =>
        prev.filter((item) => item.id !== request.id),
      );
    }
  };

  const handlePlatformPayoutRequest = async () => {
    setPlatformPayoutStatus({ type: "loading" });

    if (!profile?.id) {
      setPlatformPayoutStatus({
        type: "error",
        message: "Admin profile not available.",
      });
      return;
    }

    if (!profile.paypal_email) {
      setPlatformPayoutStatus({
        type: "error",
        message: "Add a PayPal email to your admin profile first.",
      });
      return;
    }

    if (platformFees.earned <= 0) {
      setPlatformPayoutStatus({
        type: "error",
        message: "No available platform fees to request.",
      });
      return;
    }

    const { data, error } = await supabase
      .from("askmidwife_payout_requests")
      .insert({
        provider_id: profile.id,
        amount_gbp: Number(platformFees.earned.toFixed(2)),
        paypal_email: profile.paypal_email,
        status: "pending",
      })
      .select("id, provider_id, amount_gbp, paypal_email, status, created_at")
      .maybeSingle();

    if (error || !data?.id) {
      setPlatformPayoutStatus({
        type: "error",
        message: error?.message ?? "Unable to create payout request.",
      });
      return;
    }

    await supabase
      .from("askmidwife_platform_fees")
      .update({
        payout_request_id: data.id,
        status: "pending",
      })
      .eq("status", "earned")
      .is("payout_request_id", null);

    setPayoutRequests((prev) => [data as PayoutRequest, ...prev]);
    setPlatformFees((prev) => ({
      earned: 0,
      pending: prev.pending + prev.earned,
      paid: prev.paid,
    }));
    setPlatformPayoutStatus({
      type: "success",
      message: "Platform payout request created.",
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-12 text-zinc-900">
      <div className="pointer-events-none absolute left-[-15%] top-[-25%] h-[360px] w-[360px] rounded-full bg-emerald-200/60 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[-10%] h-[360px] w-[360px] rounded-full bg-amber-200/70 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="rounded-[28px] border border-zinc-200/70 bg-white/85 p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">
            Admin
          </p>
          <h1 className="mt-3 font-[var(--font-display)] text-3xl font-semibold text-zinc-900">
            Administration
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage payout approvals and platform oversight.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm text-zinc-500">
            <span>
              Signed in as{" "}
              <span className="font-semibold text-zinc-900">
                {profile?.display_name || profile?.email || "Guest"}
              </span>
            </span>
            <span aria-hidden="true">•</span>
            <Link className="font-semibold text-emerald-700" href="/profile">
              Back to profile
            </Link>
          </div>
        </header>

        <section className="rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
          {status.type === "loading" && (
            <p className="text-sm text-zinc-500">Checking admin access…</p>
          )}
          {status.type === "error" && (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {status.message ?? "Unable to load admin access."}
            </p>
          )}
          {status.type === "idle" && !isAdmin && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You do not have access to the admin area.
            </p>
          )}
          {status.type === "idle" && isAdmin && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-600">
                Admin access confirmed. Review payout requests below.
              </p>
            </div>
          )}
        </section>

        {status.type === "idle" && isAdmin && (
          <section className="rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                Payout requests
              </p>
              <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                Medical professionals requesting payouts
              </h2>
            </div>

            <div className="mt-6 space-y-3">
              {payoutsStatus.type === "loading" && (
                <p className="text-sm text-zinc-500">Loading payout requests…</p>
              )}
              {payoutsStatus.type === "error" && (
                <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {payoutsStatus.message ?? "Unable to load payout requests."}
                </p>
              )}
              {payoutsStatus.type === "idle" && payoutRequests.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No pending payout requests.
                </p>
              )}
              {payoutsStatus.type === "idle" &&
                payoutRequests.map((request) => {
                  const provider = providerLookup[request.provider_id];
                  return (
                    <div
                      key={request.id}
                      className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">
                            {provider?.display_name ||
                              provider?.email ||
                              request.provider_id}
                          </p>
                          <p className="text-xs text-zinc-500">
                            PayPal: {request.paypal_email || "Not linked"}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-emerald-700">
                          £{Number(request.amount_gbp).toFixed(2)}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                          onClick={() => handlePayoutAction(request, "mark-paid")}
                          disabled={payoutActionStatus[request.id]?.type === "loading"}
                        >
                          Mark as paid
                        </button>
                        <button
                          type="button"
                          className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:text-emerald-300"
                          onClick={() => handlePayoutAction(request, "paypal")}
                          disabled={
                            !request.paypal_email ||
                            payoutActionStatus[request.id]?.type === "loading"
                          }
                        >
                          Send via PayPal
                        </button>
                      </div>
                      {payoutActionStatus[request.id]?.message && (
                        <p
                          className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                            payoutActionStatus[request.id]?.type === "error"
                              ? "border-red-200 bg-red-50 text-red-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {payoutActionStatus[request.id]?.message}
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        )}

        {status.type === "idle" && isAdmin && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                  Platform fees
                </p>
                <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                  15% fee totals
                </h2>
              </div>
              <div className="mt-6 space-y-3">
                {loadingPlatformFees ? (
                  <p className="text-sm text-zinc-500">Loading fee totals…</p>
                ) : (
                  <>
                    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3">
                      <p className="text-xs text-zinc-500">Available</p>
                      <p className="text-lg font-semibold text-zinc-900">
                        {formatCurrency(platformFees.earned)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3">
                      <p className="text-xs text-zinc-500">Pending</p>
                      <p className="text-lg font-semibold text-zinc-900">
                        {formatCurrency(platformFees.pending)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3">
                      <p className="text-xs text-zinc-500">Paid out</p>
                      <p className="text-lg font-semibold text-zinc-900">
                        {formatCurrency(platformFees.paid)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                      onClick={handlePlatformPayoutRequest}
                      disabled={
                        platformFees.earned <= 0 ||
                        platformPayoutStatus.type === "loading"
                      }
                    >
                      Request platform payout
                    </button>
                    {platformPayoutStatus.message && (
                      <p
                        className={`rounded-2xl border px-3 py-2 text-xs ${
                          platformPayoutStatus.type === "error"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {platformPayoutStatus.message}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                  Paid payouts
                </p>
                <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                  Completed payouts
                </h2>
              </div>
              <div className="mt-6 space-y-3">
                {loadingPaidPayouts ? (
                  <p className="text-sm text-zinc-500">Loading payouts…</p>
                ) : paidPayouts.length ? (
                  paidPayouts.map((payout) => {
                    const provider = providerLookup[payout.provider_id];
                    return (
                      <div
                        key={payout.id}
                        className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">
                              {provider?.display_name ||
                                provider?.email ||
                                payout.provider_id}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {payout.payout_provider.toUpperCase()} payout
                            </p>
                          </div>
                          <p className="text-sm font-semibold text-emerald-700">
                            {formatCurrency(Number(payout.amount_gbp))}
                          </p>
                        </div>
                        {payout.processed_at && (
                          <p className="mt-2 text-xs text-zinc-500">
                            {new Date(payout.processed_at).toLocaleString(
                              "en-GB",
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              },
                            )}
                          </p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-zinc-500">
                    No paid payouts yet.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
