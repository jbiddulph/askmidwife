"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Role = "medical" | "client" | "admin";

type Availability = {
  id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  is_blocked: boolean;
  created_at: string;
};

type AppointmentStatus =
  | "requested"
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed";

type Appointment = {
  id: string;
  patient_id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  notes: string | null;
  proposed_reason: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  hourly_pay_gbp: number | null;
  paypal_email: string | null;
  created_at: string;
};

type Payment = {
  provider_earnings_gbp: number;
  status: "pending" | "paid" | "refunded";
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
  payout_reference: string | null;
  status: "pending" | "paid" | "failed";
  created_at: string;
  processed_at: string | null;
};

type Status = {
  type: "idle" | "loading" | "error" | "success";
  message?: string;
};

function PaymentConfirmation({ userId }: { userId: string | null }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!userId) return;
    const sessionId = searchParams.get("session_id");
    const paymentStatus = searchParams.get("payment");

    if (!sessionId || paymentStatus !== "success") return;

    const confirmPayment = async () => {
      await fetch(`/api/stripe/confirm?session_id=${sessionId}`);
    };

    confirmPayment();
  }, [searchParams, userId]);

  return null;
}

type CalendarTab = "month" | "week" | "day";
type ProfileTab = "profile" | "availability" | "meetings";

type TimeSlot = {
  hour: number;
  minute: number;
  label: string;
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const getDurationMinutes = (appointment: Appointment) =>
  Math.round(
    (new Date(appointment.ends_at).getTime() -
      new Date(appointment.starts_at).getTime()) /
      60000,
  );

const toIso = (value: string) => new Date(value).toISOString();

const toInputValue = (value: string) => {
  const date = new Date(value);
  const pad = (input: number) => input.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toLocalInput = (date: Date) => {
  const pad = (input: number) => input.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const startOfWeek = (date: Date) => {
  const value = new Date(date);
  const day = (value.getDay() + 6) % 7;
  value.setDate(value.getDate() - day);
  value.setHours(0, 0, 0, 0);
  return value;
};

const addDays = (date: Date, days: number) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};

const startOfMonth = (date: Date) => {
  const value = new Date(date.getFullYear(), date.getMonth(), 1);
  value.setHours(0, 0, 0, 0);
  return value;
};

const getMonthGrid = (date: Date) => {
  const start = startOfWeek(startOfMonth(date));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
};

const getWeekDates = (date: Date) =>
  Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date), index));

const createTimeSlots = (
  startHour: number,
  endHour: number,
  stepMinutes: number,
  startMinute = 0,
) => {
  const slots: TimeSlot[] = [];
  for (let hour = startHour; hour < endHour; hour += 1) {
    const minuteStart = hour === startHour ? startMinute : 0;
    for (let minute = minuteStart; minute < 60; minute += stepMinutes) {
      const label = `${hour.toString().padStart(2, "0")}:${minute
        .toString()
        .padStart(2, "0")}`;
      slots.push({ hour, minute, label });
    }
  }
  return slots;
};

const isSlotOnDay = (slot: { starts_at: string; ends_at: string }, day: Date) => {
  const start = new Date(slot.starts_at).getTime();
  const end = new Date(slot.ends_at).getTime();
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  const dayEnd = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();
  return start <= dayEnd && end >= dayStart;
};

const isSlotWithinInterval = (
  slotTime: Date,
  intervals: Array<{ starts_at: string; ends_at: string }>,
) => {
  const slotValue = slotTime.getTime();
  return intervals.some((interval) => {
    const start = new Date(interval.starts_at).getTime();
    const end = new Date(interval.ends_at).getTime();
    return slotValue >= start && slotValue < end;
  });
};

const earliestMinute = 9 * 60;
const latestMinute = 18 * 60;

const isWithinOperatingHours = (date: Date) => {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= earliestMinute && minutes <= latestMinute;
};

const roleOptions: Array<{
  value: Role;
  label: string;
  description: string;
  highlights: string[];
}> = [
  {
    value: "medical",
    label: "Medical professional",
    description: "Doctors and nurses who provide clinical guidance.",
    highlights: [
      "Manage consultations and care plans",
      "Access patient history with consent",
      "Flag high-priority cases",
    ],
  },
  {
    value: "client",
    label: "Patient or client",
    description: "Pregnant women or anyone seeking medical advice.",
    highlights: [
      "Request consultations",
      "Track pregnancy milestones",
      "Share questions with your care team",
    ],
  },
  {
    value: "admin",
    label: "Admin",
    description: "Full CRUD access across all AskMidwife tables.",
    highlights: [
      "Manage users and permissions",
      "Audit consultations and content",
      "Override or delete any record",
    ],
  },
];

export default function ProfilePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [formName, setFormName] = useState("");
  const [formRole, setFormRole] = useState<Role>("client");
  const [formHourlyPay, setFormHourlyPay] = useState("");
  const [formPaypalEmail, setFormPaypalEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState<Status>({
    type: "idle",
  });
  const [availabilityStatus, setAvailabilityStatus] = useState<Status>({
    type: "idle",
  });
  const [scheduleStatus, setScheduleStatus] = useState<Status>({
    type: "idle",
  });
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [availabilityStart, setAvailabilityStart] = useState("");
  const [availabilityEnd, setAvailabilityEnd] = useState("");
  const [availabilityBlocked, setAvailabilityBlocked] = useState(false);
  const [bulkRangeStart, setBulkRangeStart] = useState("");
  const [bulkRangeEnd, setBulkRangeEnd] = useState("");
  const [bulkWeekdays, setBulkWeekdays] = useState<boolean[]>([
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [medicalCalendarTab, setMedicalCalendarTab] =
    useState<CalendarTab>("month");
  const [medicalSelectedDate, setMedicalSelectedDate] = useState<Date>(
    () => new Date(),
  );
  const [providers, setProviders] = useState<Profile[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [providerAvailability, setProviderAvailability] = useState<
    Availability[]
  >([]);
  const [appointmentStart, setAppointmentStart] = useState("");
  const [appointmentEnd, setAppointmentEnd] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentDrafts, setAppointmentDrafts] = useState<
    Record<string, { starts_at: string; ends_at: string; reason: string }>
  >({});
  const [adminStatusDrafts, setAdminStatusDrafts] = useState<
    Record<string, AppointmentStatus>
  >({});
  const [profileLookup, setProfileLookup] = useState<Record<string, Profile>>(
    {},
  );
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [clientCalendarTab, setClientCalendarTab] =
    useState<CalendarTab>("month");
  const [clientSelectedDate, setClientSelectedDate] = useState<Date>(
    () => new Date(),
  );
  const [earningsStatus, setEarningsStatus] = useState<Status>({
    type: "idle",
  });
  const [earningsSummary, setEarningsSummary] = useState<{
    available: number;
    pending: number;
  }>({ available: 0, pending: 0 });
  const [payoutRequestStatus, setPayoutRequestStatus] = useState<Status>({
    type: "idle",
  });
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [loadingPayoutRequests, setLoadingPayoutRequests] = useState(false);
  const [providerPendingPayout, setProviderPendingPayout] =
    useState<PayoutRequest | null>(null);
  const [providerPayouts, setProviderPayouts] = useState<PayoutPayment[]>([]);
  const [loadingProviderPayouts, setLoadingProviderPayouts] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>("profile");

  const daySlots = useMemo(() => createTimeSlots(9, 18, 30, 0), []);
  const confirmedAppointments = useMemo(
    () =>
      appointments.filter((appointment) => appointment.status === "confirmed"),
    [appointments],
  );
  const appointmentIsPast = (appointment: Appointment) =>
    new Date(appointment.starts_at).getTime() < Date.now();
  const upcomingAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          appointment.status !== "completed" && !appointmentIsPast(appointment),
      ),
    [appointments],
  );
  const completedAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          appointment.status === "completed" || appointmentIsPast(appointment),
      ),
    [appointments],
  );

  const allowAdminRole = profile?.role === "admin";
  const availableRoles = allowAdminRole
    ? roleOptions
    : roleOptions.filter((option) => option.value !== "admin");

  const currentRole = profile?.role ?? formRole;
  const showMedicalTools = currentRole === "medical" || currentRole === "admin";
  const showClientTools = currentRole === "client" || currentRole === "admin";
  const isAdmin = currentRole === "admin";

  const selectedRole =
    roleOptions.find((option) => option.value === formRole) ?? roleOptions[1];
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const selectedProviderRate =
    selectedProvider?.hourly_pay_gbp != null
      ? Number(selectedProvider.hourly_pay_gbp)
      : null;
  const selectedDurationMinutes =
    appointmentStart && appointmentEnd
      ? Math.round(
          (new Date(appointmentEnd).getTime() -
            new Date(appointmentStart).getTime()) /
            60000,
        )
      : null;
  const selectedEstimatedTotal =
    selectedProviderRate != null && selectedDurationMinutes
      ? Number(
          ((selectedProviderRate * selectedDurationMinutes) / 60).toFixed(2),
        )
      : null;
  const medicalMonthGrid = useMemo(
    () => getMonthGrid(medicalSelectedDate),
    [medicalSelectedDate],
  );
  const medicalWeekDates = useMemo(
    () => getWeekDates(medicalSelectedDate),
    [medicalSelectedDate],
  );
  const clientMonthGrid = useMemo(
    () => getMonthGrid(clientSelectedDate),
    [clientSelectedDate],
  );
  const clientWeekDates = useMemo(
    () => getWeekDates(clientSelectedDate),
    [clientSelectedDate],
  );

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUserEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
    };

    loadSession();

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
      setProfile(null);
      setLoadingProfile(false);
      return;
    }

    const loadProfile = async () => {
      setLoadingProfile(true);
      const { data, error } = await supabase
        .from("askmidwife_profiles")
        .select(
          "id, email, display_name, role, hourly_pay_gbp, paypal_email, created_at",
        )
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setProfileStatus({ type: "error", message: error.message });
      }

      setProfile(data ?? null);
      setFormName(data?.display_name ?? "");
      setFormRole((data?.role as Role) ?? "client");
      setFormHourlyPay(
        data?.hourly_pay_gbp != null
          ? Number(data.hourly_pay_gbp).toFixed(2)
          : "",
      );
      setFormPaypalEmail(data?.paypal_email ?? "");
      setLoadingProfile(false);
    };

    loadProfile();
  }, [supabase, userId]);

  useEffect(() => {
    if (!userId || !showMedicalTools) {
      setAvailability([]);
      return;
    }

    const loadAvailability = async () => {
      setLoadingAvailability(true);
      const { data, error } = await supabase
        .from("askmidwife_provider_availability")
        .select("id, provider_id, starts_at, ends_at, is_blocked, created_at")
        .eq("provider_id", userId)
        .order("starts_at", { ascending: true });

      if (error) {
        setAvailabilityStatus({ type: "error", message: error.message });
      }
      setAvailability(data ?? []);
      setLoadingAvailability(false);
    };

    loadAvailability();
  }, [supabase, userId, showMedicalTools]);

  useEffect(() => {
    if (!userId || !showMedicalTools) {
      setEarningsSummary({ available: 0, pending: 0 });
      return;
    }

    const loadEarnings = async () => {
      setEarningsStatus({ type: "loading" });
      const { data, error } = await supabase
        .from("askmidwife_appointment_payments")
        .select("provider_earnings_gbp, status")
        .eq("provider_id", userId);

      if (error) {
        setEarningsStatus({ type: "error", message: error.message });
        return;
      }

      const summary = (data ?? []).reduce(
        (acc, item) => {
          const amount = Number(item.provider_earnings_gbp) || 0;
          if (item.status === "paid") {
            acc.available += amount;
          } else if (item.status === "pending") {
            acc.pending += amount;
          }
          return acc;
        },
        { available: 0, pending: 0 },
      );

      setEarningsSummary(summary);
      setEarningsStatus({ type: "success" });
    };

    loadEarnings();
  }, [supabase, userId, showMedicalTools]);

  useEffect(() => {
    if (!userId || !showMedicalTools) {
      setProviderPendingPayout(null);
      return;
    }

    const loadProviderPayout = async () => {
      const { data } = await supabase
        .from("askmidwife_payout_requests")
        .select("id, provider_id, amount_gbp, paypal_email, status, created_at")
        .eq("provider_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setProviderPendingPayout(data as PayoutRequest);
      } else {
        setProviderPendingPayout(null);
      }
    };

    loadProviderPayout();
  }, [supabase, userId, showMedicalTools]);

  useEffect(() => {
    if (profile?.role !== "admin") {
      setPayoutRequests([]);
      return;
    }

    const loadPayoutRequests = async () => {
      setLoadingPayoutRequests(true);
      const { data, error } = await supabase
        .from("askmidwife_payout_requests")
        .select("id, provider_id, amount_gbp, paypal_email, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (!error) {
        const requests = (data as PayoutRequest[]) ?? [];
        setPayoutRequests(requests);

        const providerIds = Array.from(
          new Set(requests.map((request) => request.provider_id)),
        );
        if (providerIds.length) {
          const { data: profileData } = await supabase
            .from("askmidwife_profiles")
            .select(
              "id, email, display_name, role, hourly_pay_gbp, paypal_email, created_at",
            )
            .in("id", providerIds);

          if (profileData) {
            setProfileLookup((prev) => {
              const next = { ...prev };
              profileData.forEach((item) => {
                next[item.id] = item;
              });
              return next;
            });
          }
        }
      }
      setLoadingPayoutRequests(false);
    };

    loadPayoutRequests();
  }, [supabase, profile?.role]);

  useEffect(() => {
    if (!userId || profile?.role !== "medical") {
      setProviderPayouts([]);
      return;
    }

    const loadProviderPayouts = async () => {
      setLoadingProviderPayouts(true);
      const { data, error } = await supabase
        .from("askmidwife_payout_payments")
        .select(
          "id, request_id, provider_id, amount_gbp, payout_provider, payout_reference, status, created_at, processed_at",
        )
        .eq("provider_id", userId)
        .eq("status", "paid")
        .order("processed_at", { ascending: false });

      if (!error) {
        setProviderPayouts((data as PayoutPayment[]) ?? []);
      }
      setLoadingProviderPayouts(false);
    };

    loadProviderPayouts();
  }, [supabase, userId, profile?.role]);

  useEffect(() => {
    if (!userId) {
      setProviders([]);
      return;
    }

    const loadProviders = async () => {
      const { data, error } = await supabase
        .from("askmidwife_profiles")
        .select(
          "id, email, display_name, role, hourly_pay_gbp, paypal_email, created_at",
        )
        .eq("role", "medical")
        .order("display_name", { ascending: true });

      if (error) {
        setScheduleStatus({ type: "error", message: error.message });
        return;
      }

      setProviders(data ?? []);
      setSelectedProviderId((prev) => prev || "");
    };

    loadProviders();
  }, [supabase, userId]);

  useEffect(() => {
    if (!selectedProviderId || !showClientTools) {
      setProviderAvailability([]);
      return;
    }

    const loadProviderAvailability = async () => {
      const { data, error } = await supabase
        .from("askmidwife_provider_availability")
        .select("id, provider_id, starts_at, ends_at, is_blocked, created_at")
        .eq("provider_id", selectedProviderId)
        .eq("is_blocked", false)
        .order("starts_at", { ascending: true });

      if (error) {
        setScheduleStatus({ type: "error", message: error.message });
        return;
      }

      setProviderAvailability(data ?? []);
    };

    loadProviderAvailability();
  }, [supabase, selectedProviderId, showClientTools]);

  useEffect(() => {
    if (!userId || (!showClientTools && !showMedicalTools)) {
      setAppointments([]);
      return;
    }

    const loadAppointments = async () => {
      setLoadingAppointments(true);
      let appointmentsData: Appointment[] = [];

      if (isAdmin) {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError || !sessionData.session?.access_token) {
          setScheduleStatus({
            type: "error",
            message: "Sign in again to load meetings.",
          });
          setLoadingAppointments(false);
          return;
        }

        const response = await fetch("/api/admin/appointments", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
          },
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          setScheduleStatus({
            type: "error",
            message: payload.error ?? "Unable to load appointments.",
          });
          setLoadingAppointments(false);
          return;
        }

        const payload = (await response.json()) as {
          appointments?: Appointment[];
          profiles?: Profile[];
        };

        appointmentsData = payload.appointments ?? [];

        if (payload.profiles?.length) {
          setProfileLookup((prev) => {
            const next = { ...prev };
            payload.profiles?.forEach((item) => {
              next[item.id] = item;
            });
            return next;
          });
        }
      } else {
        const query = supabase
          .from("askmidwife_appointments")
          .select(
            "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
          )
          .order("starts_at", { ascending: true });

        const { data, error } = showMedicalTools
          ? await query.eq("provider_id", userId)
          : await query.eq("patient_id", userId);

        if (error) {
          setScheduleStatus({ type: "error", message: error.message });
          setLoadingAppointments(false);
          return;
        }

        appointmentsData = data ?? [];
      }

      setAppointments(appointmentsData);
      setAppointmentDrafts((prev) => {
        const next = { ...prev };
        appointmentsData.forEach((appointment) => {
          if (!next[appointment.id]) {
            next[appointment.id] = {
              starts_at: toInputValue(appointment.starts_at),
              ends_at: toInputValue(appointment.ends_at),
              reason: appointment.proposed_reason ?? "",
            };
          }
        });
        return next;
      });
      setAdminStatusDrafts((prev) => {
        const next = { ...prev };
        appointmentsData.forEach((appointment) => {
          if (!next[appointment.id]) {
            next[appointment.id] = appointment.status;
          }
        });
        return next;
      });

      if (!isAdmin) {
        const profileIds = Array.from(
          new Set(
            appointmentsData.flatMap((appointment) => [
              appointment.patient_id,
              appointment.provider_id,
            ]),
          ),
        );

        if (profileIds.length) {
          const { data: profileData } = await supabase
            .from("askmidwife_profiles")
            .select(
              "id, email, display_name, role, hourly_pay_gbp, paypal_email, created_at",
            )
            .in("id", profileIds);

          if (profileData) {
            setProfileLookup((prev) => {
              const next = { ...prev };
              profileData.forEach((item) => {
                next[item.id] = item;
              });
              return next;
            });
          }
        }
      }

      setLoadingAppointments(false);
    };

    loadAppointments();
  }, [supabase, userId, showClientTools, showMedicalTools, isAdmin]);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileStatus({ type: "loading" });

    if (!userId) {
      setProfileStatus({ type: "error", message: "You need to sign in first." });
      return;
    }

    const normalizedHourlyPay = formHourlyPay.trim();
    const hourlyPayValue =
      normalizedHourlyPay === "" ? null : Number(normalizedHourlyPay);

    if (formRole === "medical") {
      if (
        normalizedHourlyPay === "" ||
        hourlyPayValue === null ||
        Number.isNaN(hourlyPayValue) ||
        hourlyPayValue < 0
      ) {
        setProfileStatus({
          type: "error",
          message: "Enter a valid hourly rate in GBP for medical profiles.",
        });
        return;
      }
    }

    const payload = {
      id: userId,
      email: userEmail,
      display_name: formName.trim(),
      role: formRole,
      hourly_pay_gbp: formRole === "medical" ? hourlyPayValue : null,
      paypal_email: formRole === "medical" ? formPaypalEmail.trim() || null : null,
    };

    const { error } = profile
      ? await supabase
          .from("askmidwife_profiles")
          .update(payload)
          .eq("id", userId)
      : await supabase.from("askmidwife_profiles").insert(payload);

    if (error) {
      setProfileStatus({ type: "error", message: error.message });
      return;
    }

    setProfileStatus({ type: "success", message: "Profile saved." });
    setProfile((prev) => (prev ? { ...prev, ...payload } : (payload as Profile)));
  };

  const handleRequestPayout = async () => {
    setPayoutRequestStatus({ type: "loading" });

    if (!userId) {
      setPayoutRequestStatus({
        type: "error",
        message: "You need to sign in first.",
      });
      return;
    }

    if (!formPaypalEmail.trim()) {
      setPayoutRequestStatus({
        type: "error",
        message: "Add a PayPal email before requesting a payout.",
      });
      return;
    }

    if (earningsSummary.available <= 0) {
      setPayoutRequestStatus({
        type: "error",
        message: "No available balance to request.",
      });
      return;
    }

    const payload = {
      provider_id: userId,
      amount_gbp: Number(earningsSummary.available.toFixed(2)),
      paypal_email: formPaypalEmail.trim(),
      status: "pending",
    };

    const { data, error } = await supabase
      .from("askmidwife_payout_requests")
      .insert(payload)
      .select("id, provider_id, amount_gbp, paypal_email, status, created_at")
      .maybeSingle();

    if (error) {
      setPayoutRequestStatus({ type: "error", message: error.message });
      return;
    }

    if (data) {
      setProviderPendingPayout(data);
    }

    setPayoutRequestStatus({
      type: "success",
      message: "Payout request submitted for admin approval.",
    });
  };

  const handleAddAvailability = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAvailabilityStatus({ type: "loading" });

    if (!userId) {
      setAvailabilityStatus({
        type: "error",
        message: "You need to sign in first.",
      });
      return;
    }

    if (!availabilityStart || !availabilityEnd) {
      setAvailabilityStatus({
        type: "error",
        message: "Start and end times are required.",
      });
      return;
    }

    const startDate = new Date(availabilityStart);
    const endDate = new Date(availabilityEnd);

    if (endDate <= startDate) {
      setAvailabilityStatus({
        type: "error",
        message: "End time must be after the start time.",
      });
      return;
    }

    if (!isWithinOperatingHours(startDate) || !isWithinOperatingHours(endDate)) {
      setAvailabilityStatus({
        type: "error",
        message: "Availability must be between 09:00 and 18:00.",
      });
      return;
    }

    const payload = {
      provider_id: userId,
      starts_at: toIso(availabilityStart),
      ends_at: toIso(availabilityEnd),
      is_blocked: availabilityBlocked,
    };

    const { data, error } = await supabase
      .from("askmidwife_provider_availability")
      .insert(payload)
      .select("id, provider_id, starts_at, ends_at, is_blocked, created_at");

    if (error) {
      setAvailabilityStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.[0]) {
      setAvailability((prev) => [...prev, data[0]]);
    }

    setAvailabilityStart("");
    setAvailabilityEnd("");
    setAvailabilityBlocked(false);
    setAvailabilityStatus({ type: "success", message: "Availability added." });
  };

  const handleBulkAvailability = async (isBlocked: boolean) => {
    setAvailabilityStatus({ type: "loading" });

    if (!userId) {
      setAvailabilityStatus({
        type: "error",
        message: "You need to sign in first.",
      });
      return;
    }

    if (!bulkRangeStart || !bulkRangeEnd) {
      setAvailabilityStatus({
        type: "error",
        message: "Select a start and end date for the range.",
      });
      return;
    }

    const startDate = new Date(bulkRangeStart);
    const endDate = new Date(bulkRangeEnd);

    if (endDate < startDate) {
      setAvailabilityStatus({
        type: "error",
        message: "End date must be the same day or later than start date.",
      });
      return;
    }

    if (!bulkWeekdays.some(Boolean)) {
      setAvailabilityStatus({
        type: "error",
        message: "Select at least one weekday.",
      });
      return;
    }

    const payload = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const weekdayIndex = (cursor.getDay() + 6) % 7;
      if (bulkWeekdays[weekdayIndex]) {
        const dayStart = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          9,
          0,
          0,
          0,
        );
        const dayEnd = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          18,
          0,
          0,
          0,
        );
        payload.push({
          provider_id: userId,
          starts_at: dayStart.toISOString(),
          ends_at: dayEnd.toISOString(),
          is_blocked: isBlocked,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (!payload.length) {
      setAvailabilityStatus({
        type: "error",
        message: "No dates matched the selected weekdays.",
      });
      return;
    }

    const { data, error } = await supabase
      .from("askmidwife_provider_availability")
      .insert(payload)
      .select("id, provider_id, starts_at, ends_at, is_blocked, created_at");

    if (error) {
      setAvailabilityStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.length) {
      setAvailability((prev) =>
        [...prev, ...data].sort(
          (a, b) =>
            new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        ),
      );
    }

    setAvailabilityStatus({
      type: "success",
      message: isBlocked
        ? "Bulk unavailability saved."
        : "Bulk availability saved.",
    });
  };

  const handleRemoveAvailability = async (availabilityId: string) => {
    setAvailabilityStatus({ type: "loading" });

    const { error } = await supabase
      .from("askmidwife_provider_availability")
      .delete()
      .eq("id", availabilityId);

    if (error) {
      setAvailabilityStatus({ type: "error", message: error.message });
      return;
    }

    setAvailability((prev) => prev.filter((item) => item.id !== availabilityId));
    setAvailabilityStatus({ type: "success", message: "Availability removed." });
  };

  const handleRequestAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScheduleStatus({ type: "loading" });

    if (!userId) {
      setScheduleStatus({ type: "error", message: "You need to sign in." });
      return;
    }

    if (!selectedProviderId) {
      setScheduleStatus({
        type: "error",
        message: "Choose a medical professional first.",
      });
      return;
    }

    if (!appointmentStart || !appointmentEnd) {
      setScheduleStatus({
        type: "error",
        message: "Start and end times are required.",
      });
      return;
    }

    if (new Date(appointmentEnd) <= new Date(appointmentStart)) {
      setScheduleStatus({
        type: "error",
        message: "End time must be after the start time.",
      });
      return;
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      setScheduleStatus({
        type: "error",
        message: "You need to sign in again to pay for this appointment.",
      });
      return;
    }

    const payload = {
      providerId: selectedProviderId,
      startsAt: toIso(appointmentStart),
      endsAt: toIso(appointmentEnd),
      notes: appointmentNotes.trim() || null,
    };

    const response = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorPayload = (await response.json()) as { error?: string };
      setScheduleStatus({
        type: "error",
        message: errorPayload.error ?? "Payment could not be started.",
      });
      return;
    }

    const responseData = (await response.json()) as { url?: string };

    if (!responseData.url) {
      setScheduleStatus({
        type: "error",
        message: "Payment session was not created correctly.",
      });
      return;
    }

    window.location.assign(responseData.url);
  };

  const handleProviderAccept = async (appointmentId: string) => {
    setScheduleStatus({ type: "loading" });

    const { data, error } = await supabase
      .from("askmidwife_appointments")
      .update({ status: "confirmed" })
      .eq("id", appointmentId)
      .select(
        "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
      );

    if (error) {
      setScheduleStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.[0]) {
      setAppointments((prev) =>
        prev.map((item) => (item.id === appointmentId ? data[0] : item)),
      );
      setScheduleStatus({ type: "success", message: "Appointment confirmed." });
    }
  };

  const handleProviderPropose = async (appointmentId: string) => {
    const draft = appointmentDrafts[appointmentId];
    if (!draft?.starts_at || !draft?.ends_at) {
      setScheduleStatus({
        type: "error",
        message: "Provide a new start and end time.",
      });
      return;
    }

    if (!draft.reason.trim()) {
      setScheduleStatus({
        type: "error",
        message: "Add a reason for the proposed change.",
      });
      return;
    }

    setScheduleStatus({ type: "loading" });

    const { data, error } = await supabase
      .from("askmidwife_appointments")
      .update({
        starts_at: toIso(draft.starts_at),
        ends_at: toIso(draft.ends_at),
        status: "proposed",
        proposed_reason: draft.reason.trim(),
      })
      .eq("id", appointmentId)
      .select(
        "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
      );

    if (error) {
      setScheduleStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.[0]) {
      setAppointments((prev) =>
        prev.map((item) => (item.id === appointmentId ? data[0] : item)),
      );
      setScheduleStatus({
        type: "success",
        message: "Proposed new time sent to the requester.",
      });
    }
  };

  const handlePatientConfirm = async (appointmentId: string) => {
    setScheduleStatus({ type: "loading" });
    const { data, error } = await supabase
      .from("askmidwife_appointments")
      .update({ status: "confirmed" })
      .eq("id", appointmentId)
      .select(
        "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
      );

    if (error) {
      setScheduleStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.[0]) {
      setAppointments((prev) =>
        prev.map((item) => (item.id === appointmentId ? data[0] : item)),
      );
      setScheduleStatus({
        type: "success",
        message: "Appointment confirmed.",
      });
    }
  };

  const handlePatientDecline = async (appointmentId: string) => {
    setScheduleStatus({ type: "loading" });
    const { data, error } = await supabase
      .from("askmidwife_appointments")
      .update({ status: "cancelled" })
      .eq("id", appointmentId)
      .select(
        "id, patient_id, provider_id, starts_at, ends_at, status, notes, proposed_reason, created_at",
      );

    if (error) {
      setScheduleStatus({ type: "error", message: error.message });
      return;
    }

    if (data?.[0]) {
      setAppointments((prev) =>
        prev.map((item) => (item.id === appointmentId ? data[0] : item)),
      );
      setScheduleStatus({
        type: "success",
        message: "Appointment declined.",
      });
    }
  };

  const handleAdminUpdate = async (appointmentId: string) => {
    const draft = appointmentDrafts[appointmentId];
    if (!draft?.starts_at || !draft?.ends_at) {
      setScheduleStatus({
        type: "error",
        message: "Provide a start and end time.",
      });
      return;
    }

    const status = adminStatusDrafts[appointmentId];
    if (!status) {
      setScheduleStatus({
        type: "error",
        message: "Select a status for the appointment.",
      });
      return;
    }

    if (new Date(draft.ends_at) <= new Date(draft.starts_at)) {
      setScheduleStatus({
        type: "error",
        message: "End time must be after the start time.",
      });
      return;
    }

    setScheduleStatus({ type: "loading" });

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError || !sessionData.session?.access_token) {
      setScheduleStatus({
        type: "error",
        message: "Sign in again to update the appointment.",
      });
      return;
    }

    const response = await fetch("/api/admin/appointments/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({
        appointmentId,
        startsAt: toIso(draft.starts_at),
        endsAt: toIso(draft.ends_at),
        status,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setScheduleStatus({
        type: "error",
        message: payload.error ?? "Unable to update appointment.",
      });
      return;
    }

    const payload = (await response.json()) as { appointment?: Appointment };
    if (payload.appointment) {
      setAppointments((prev) =>
        prev.map((item) =>
          item.id === appointmentId ? payload.appointment! : item,
        ),
      );
    }
    setScheduleStatus({ type: "success", message: "Appointment updated." });
  };

  const handleSignOut = async () => {
    setProfileStatus({ type: "loading" });
    const { error } = await supabase.auth.signOut();
    if (error) {
      setProfileStatus({ type: "error", message: error.message });
      return;
    }
    setProfileStatus({ type: "success", message: "Signed out." });
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-12 text-zinc-900">
      <Suspense fallback={null}>
        <PaymentConfirmation userId={userId} />
      </Suspense>
      <div className="pointer-events-none absolute left-[-15%] top-[-30%] h-[380px] w-[380px] rounded-full bg-emerald-200/60 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-25%] right-[-15%] h-[360px] w-[360px] rounded-full bg-amber-200/70 blur-3xl" />

      <main className="relative mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-5 rounded-[32px] border border-zinc-200/70 bg-white/85 p-10 shadow-[0_25px_80px_-60px_rgba(15,23,42,0.35)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700">
            Ask Midwife
          </p>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold leading-tight text-zinc-900 md:text-4xl">
            User profile and role setup
          </h1>
          <p className="max-w-2xl text-base text-zinc-600">
            Choose the role that matches how you will use the platform. Admin
            roles should be granted intentionally.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <span>
              Signed in as{" "}
              <span className="font-semibold text-zinc-900">
                {userEmail ?? "Guest"}
              </span>
            </span>
            <span aria-hidden="true">•</span>
            <Link className="font-semibold text-emerald-700" href="/">
              Back to sign in
            </Link>
          </div>
        </header>

        <section className="flex flex-wrap gap-3">
          {(isAdmin
            ? (["profile", "meetings"] as ProfileTab[])
            : (["profile", "availability"] as ProfileTab[])
          ).map((tab) => {
            const label =
              tab === "availability" && showClientTools && !showMedicalTools
                ? "Book a consultation"
                : tab === "meetings"
                ? "Upcoming meetings"
                : tab;
            return (
              <button
                key={tab}
              type="button"
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                profileTab === tab
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-200 text-zinc-500 hover:border-zinc-400"
              }`}
              onClick={() => setProfileTab(tab)}
            >
              {label}
            </button>
          );
          })}
        </section>

        {profileTab === "profile" && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <form
              className="flex flex-col gap-6 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]"
              onSubmit={handleSave}
            >
              <div className="space-y-2">
                <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                  Profile details
                </h2>
                <p className="text-sm text-zinc-500">
                  This data is stored in `askmidwife_profiles`.
                </p>
              </div>

              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                Display name
                <input
                  type="text"
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                />
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                Role
                <select
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                  value={formRole}
                  onChange={(event) => setFormRole(event.target.value as Role)}
                >
                  {availableRoles.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

            {formRole === "medical" && (
              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                Hourly pay (GBP)
                <input
                  type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="24.00"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                    value={formHourlyPay}
                    onChange={(event) => setFormHourlyPay(event.target.value)}
                  />
                <span className="text-xs text-zinc-500">
                  Patients are charged by the hour; platform fee is 15%.
                </span>
              </label>
            )}

            {(formRole === "medical" || formRole === "admin") && (
              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                PayPal email
                <input
                  type="email"
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                  value={formPaypalEmail}
                  onChange={(event) => setFormPaypalEmail(event.target.value)}
                />
                <span className="text-xs text-zinc-500">
                  Used for payout requests after admin approval.
                </span>
              </label>
            )}

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              <p className="font-semibold">{selectedRole.label}</p>
              <p className="mt-1 text-emerald-700/90">
                {selectedRole.description}
              </p>
                <ul className="mt-3 list-disc pl-5 text-emerald-700/90">
                  {selectedRole.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  disabled={profileStatus.type === "loading" || loadingProfile}
                >
                  {profile ? "Update profile" : "Create profile"}
                </button>
                <button
                  type="button"
                  className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed"
                  onClick={handleSignOut}
                  disabled={!userEmail || profileStatus.type === "loading"}
                >
                  Sign out
                </button>
              </div>

            {profileStatus.type !== "idle" && profileStatus.message && (
              <p
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  profileStatus.type === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }`}
              >
                {profileStatus.message}
              </p>
            )}

            {formRole === "medical" && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Payouts
                </p>
                <p className="mt-2 text-sm text-zinc-600">
                  Available balance:{" "}
                  <span className="font-semibold text-zinc-900">
                    {formatCurrency(earningsSummary.available)}
                  </span>
                </p>
                {providerPendingPayout ? (
                  <p className="mt-2 text-xs text-amber-700">
                    Payout request pending approval.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    onClick={handleRequestPayout}
                    disabled={earningsSummary.available <= 0}
                  >
                    Request payout
                  </button>
                )}
                {payoutRequestStatus.type !== "idle" &&
                  payoutRequestStatus.message && (
                    <p
                      className={`mt-3 rounded-2xl border px-4 py-3 text-xs ${
                        payoutRequestStatus.type === "error"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {payoutRequestStatus.message}
                    </p>
                  )}
              </div>
            )}
          </form>

            <aside className="flex flex-col gap-4 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                Role summaries
              </p>
              {roleOptions.map((option) => (
                <div
                  key={option.value}
                  className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4"
                >
                  <p className="text-sm font-semibold text-zinc-900">
                    {option.label}
                  </p>
                  <p className="text-sm text-zinc-500">{option.description}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                Admin access should be granted via server-side workflows using the
                service role key, not by client-side changes.
              </div>
            </aside>
          </section>
        )}

        {profileTab === "availability" && (showMedicalTools || showClientTools) && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {showMedicalTools && (
              <div className="flex flex-col gap-6 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
            <div className="space-y-2">
              <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                Availability
              </h2>
              <p className="text-sm text-zinc-500">
                Add the times you are open for consultations.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4 text-sm text-emerald-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700/80">
                  Earnings summary
                </span>
                {earningsStatus.type === "loading" ? (
                  <span className="text-xs text-emerald-700/80">
                    Refreshing…
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-emerald-700/80">Available</p>
                  <p className="text-lg font-semibold text-emerald-900">
                    {formatCurrency(earningsSummary.available)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-emerald-700/80">Pending</p>
                  <p className="text-lg font-semibold text-emerald-900">
                    {formatCurrency(earningsSummary.pending)}
                  </p>
                </div>
              </div>
              {earningsStatus.type === "error" && earningsStatus.message && (
                <p className="text-xs text-red-600">
                  {earningsStatus.message}
                </p>
              )}
            </div>

            <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-white p-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Quick setup
                </p>
                <p className="mt-2 text-sm text-zinc-600">
                  Add or block 09:00-18:00 availability across weeks or months.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  Range start
                  <input
                    type="date"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                    value={bulkRangeStart}
                    onChange={(event) => setBulkRangeStart(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  Range end
                  <input
                    type="date"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                    value={bulkRangeEnd}
                    onChange={(event) => setBulkRangeEnd(event.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {dayNames.map((day, index) => (
                  <button
                    key={day}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      bulkWeekdays[index]
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-zinc-200 text-zinc-500 hover:border-zinc-400"
                    }`}
                    onClick={() =>
                      setBulkWeekdays((prev) =>
                        prev.map((value, idx) =>
                          idx === index ? !value : value,
                        ),
                      )
                    }
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                  onClick={() => handleBulkAvailability(false)}
                  disabled={availabilityStatus.type === "loading"}
                >
                  Add 09:00-18:00 availability
                </button>
                <button
                  type="button"
                  className="rounded-full border border-amber-200 px-4 py-2 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:text-amber-800"
                  onClick={() => handleBulkAvailability(true)}
                  disabled={availabilityStatus.type === "loading"}
                >
                  Block 09:00-18:00
                </button>
              </div>
            </div>

            <div
              id="booking-calendar"
              className="space-y-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4"
            >
              <div className="flex flex-wrap gap-2">
                {(["month", "week", "day"] as CalendarTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                      medicalCalendarTab === tab
                        ? "bg-emerald-600 text-white"
                        : "border border-zinc-200 text-zinc-500 hover:border-zinc-400"
                    }`}
                    onClick={() => setMedicalCalendarTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {medicalCalendarTab === "month" && (
                <div className="grid gap-2">
                  <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-zinc-500">
                    {dayNames.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {medicalMonthGrid.map((day) => {
                      const isCurrentMonth =
                        day.getMonth() === medicalSelectedDate.getMonth();
                      const isSelected =
                        day.toDateString() ===
                        medicalSelectedDate.toDateString();
                      const hasOpen = availability.some(
                        (slot) => !slot.is_blocked && isSlotOnDay(slot, day),
                      );
                      const hasBlocked = availability.some(
                        (slot) => slot.is_blocked && isSlotOnDay(slot, day),
                      );

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs transition ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                          } ${isCurrentMonth ? "" : "opacity-50"}`}
                          onClick={() => {
                            setMedicalSelectedDate(day);
                            setMedicalCalendarTab("week");
                          }}
                        >
                          <span className="font-semibold">
                            {day.getDate()}
                          </span>
                          <div className="flex items-center gap-1">
                            {hasOpen && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            )}
                            {hasBlocked && (
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {medicalCalendarTab === "week" && (
                <div className="grid grid-cols-7 gap-2">
                  {medicalWeekDates.map((day) => {
                    const isSelected =
                      day.toDateString() === medicalSelectedDate.toDateString();
                    const hasOpen = availability.some(
                      (slot) => !slot.is_blocked && isSlotOnDay(slot, day),
                    );
                    const hasBlocked = availability.some(
                      (slot) => slot.is_blocked && isSlotOnDay(slot, day),
                    );

                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                        }`}
                        onClick={() => {
                          setMedicalSelectedDate(day);
                          setMedicalCalendarTab("day");
                        }}
                      >
                        <span className="font-semibold">
                          {dayNames[(day.getDay() + 6) % 7]}
                        </span>
                        <span>{day.getDate()}</span>
                        <div className="flex items-center gap-1">
                          {hasOpen && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                          {hasBlocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {medicalCalendarTab === "day" && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    {medicalSelectedDate.toLocaleDateString("en-GB", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {daySlots.map((slot) => {
                      const slotDate = new Date(medicalSelectedDate);
                      slotDate.setHours(slot.hour, slot.minute, 0, 0);
                      const slotEnd = new Date(slotDate);
                      slotEnd.setMinutes(slotEnd.getMinutes() + 30);
                      const openIntervals = availability.filter(
                        (item) => !item.is_blocked,
                      );
                      const blockedIntervals = availability.filter(
                        (item) => item.is_blocked,
                      );
                      const isOpen = isSlotWithinInterval(
                        slotDate,
                        openIntervals,
                      );
                      const isBlocked = isSlotWithinInterval(
                        slotDate,
                        blockedIntervals,
                      );
                      const isConfirmed = isSlotWithinInterval(
                        slotDate,
                        confirmedAppointments.filter(
                          (appointment) =>
                            appointment.provider_id === userId &&
                            isSlotOnDay(appointment, medicalSelectedDate),
                        ),
                      );
                      const isSelected =
                        availabilityStart &&
                        availabilityEnd &&
                        slotDate.getTime() ===
                          new Date(availabilityStart).getTime();

                      return (
                        <button
                          key={slot.label}
                          type="button"
                          className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                            isConfirmed
                              ? "border-red-200 bg-red-50 text-red-700"
                              : isBlocked
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : isSelected
                              ? "border-orange-200 bg-orange-50 text-orange-700"
                              : isOpen
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                          }`}
                          onClick={() => {
                            setAvailabilityStart(toLocalInput(slotDate));
                            setAvailabilityEnd(toLocalInput(slotEnd));
                          }}
                        >
                          <span className="font-semibold">{slot.label}</span>
                          <span>
                            {isConfirmed
                              ? "Confirmed"
                              : isBlocked
                              ? "Blocked"
                              : isSelected
                              ? "Selected"
                              : isOpen
                              ? "Open"
                              : "Select"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={handleAddAvailability}
            >
                  <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                    Start
                    <input
                      type="datetime-local"
                      className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                      value={availabilityStart}
                      onChange={(event) =>
                        setAvailabilityStart(event.target.value)
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                    End
                    <input
                      type="datetime-local"
                      className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2"
                      value={availabilityEnd}
                      onChange={(event) =>
                        setAvailabilityEnd(event.target.value)
                      }
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-700 md:col-span-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                      checked={availabilityBlocked}
                      onChange={(event) =>
                        setAvailabilityBlocked(event.target.checked)
                      }
                    />
                    Mark this time as unavailable
                  </label>
                  <button
                    type="submit"
                    className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300 md:col-span-2"
                    disabled={availabilityStatus.type === "loading"}
                  >
                    Save time block
                  </button>
                  {availabilityStatus.type !== "idle" &&
                    availabilityStatus.message && (
                      <p
                        className={`rounded-2xl border px-4 py-3 text-sm md:col-span-2 ${
                          availabilityStatus.type === "error"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {availabilityStatus.message}
                      </p>
                    )}
                </form>

              </div>
            )}

            {showClientTools && (
              <div className="flex flex-col gap-6 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
            <div className="space-y-2">
              <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                Request a consultation
              </h2>
              <p className="text-sm text-zinc-500">
                Choose a clinician and request a time that works for you.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Medical professionals
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {providers.map((provider) => {
                  const label =
                    provider.display_name || provider.email || provider.id;
                  const isSelected = provider.id === selectedProviderId;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={`rounded-2xl border px-4 py-4 text-left text-sm transition ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                      }`}
                      onClick={() => setSelectedProviderId(provider.id)}
                    >
                      <p className="font-semibold text-zinc-900">{label}</p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {provider.hourly_pay_gbp != null
                          ? `${formatCurrency(
                              Number(provider.hourly_pay_gbp),
                            )}/hr`
                          : "Hourly rate not set"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedProviderId && (
              <div className="space-y-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4">
                <div className="flex flex-wrap gap-2">
                  {(["month", "week", "day"] as CalendarTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        clientCalendarTab === tab
                          ? "bg-emerald-600 text-white"
                          : "border border-zinc-200 text-zinc-500 hover:border-zinc-400"
                      }`}
                      onClick={() => setClientCalendarTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {clientCalendarTab === "month" && (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-zinc-500">
                      {dayNames.map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {clientMonthGrid.map((day) => {
                        const isCurrentMonth =
                          day.getMonth() === clientSelectedDate.getMonth();
                        const isSelected =
                          day.toDateString() ===
                          clientSelectedDate.toDateString();
                        const hasOpen = providerAvailability.some((slot) =>
                          isSlotOnDay(slot, day),
                        );

                        return (
                          <button
                            key={day.toISOString()}
                            type="button"
                            className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs transition ${
                              isSelected
                                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                            } ${isCurrentMonth ? "" : "opacity-50"}`}
                            onClick={() => {
                              setClientSelectedDate(day);
                              setClientCalendarTab("week");
                            }}
                          >
                            <span className="font-semibold">
                              {day.getDate()}
                            </span>
                            {hasOpen && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {clientCalendarTab === "week" && (
                  <div className="grid grid-cols-7 gap-2">
                    {clientWeekDates.map((day) => {
                      const isSelected =
                        day.toDateString() ===
                        clientSelectedDate.toDateString();
                      const hasOpen = providerAvailability.some((slot) =>
                        isSlotOnDay(slot, day),
                      );

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs transition ${
                            isSelected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300"
                          }`}
                          onClick={() => {
                            setClientSelectedDate(day);
                            setClientCalendarTab("day");
                          }}
                        >
                          <span className="font-semibold">
                            {dayNames[(day.getDay() + 6) % 7]}
                          </span>
                          <span>{day.getDate()}</span>
                          {hasOpen && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {clientCalendarTab === "day" && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                      {clientSelectedDate.toLocaleDateString("en-GB", {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {daySlots.map((slot) => {
                        const slotDate = new Date(clientSelectedDate);
                        slotDate.setHours(slot.hour, slot.minute, 0, 0);
                        const slotEnd = new Date(slotDate);
                        slotEnd.setMinutes(slotEnd.getMinutes() + 30);
                        const isOpen = isSlotWithinInterval(
                          slotDate,
                          providerAvailability,
                        );
                        const isConfirmed = isSlotWithinInterval(
                          slotDate,
                          confirmedAppointments.filter(
                            (appointment) =>
                              appointment.patient_id === userId &&
                              appointment.provider_id ===
                                selectedProviderId &&
                              isSlotOnDay(appointment, clientSelectedDate),
                          ),
                        );
                        const isSelected =
                          appointmentStart &&
                          appointmentEnd &&
                          slotDate.getTime() ===
                            new Date(appointmentStart).getTime();

                        return (
                          <button
                            key={slot.label}
                            type="button"
                            disabled={!isOpen || isConfirmed}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                              isConfirmed
                                ? "border-red-200 bg-red-50 text-red-700"
                                : isSelected
                                ? "border-orange-200 bg-orange-50 text-orange-700"
                                : isOpen
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-white text-zinc-400"
                            }`}
                            onClick={() => {
                              setAppointmentStart(toLocalInput(slotDate));
                              setAppointmentEnd(toLocalInput(slotEnd));
                            }}
                          >
                            <span className="font-semibold">{slot.label}</span>
                            <span>
                              {isConfirmed
                                ? "Confirmed"
                                : isSelected
                                ? "Selected"
                                : isOpen
                                ? "Available"
                                : "Unavailable"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <form
              className="flex flex-col gap-4"
              onSubmit={handleRequestAppointment}
            >
              <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
                <p className="font-semibold text-zinc-900">
                  {selectedProvider
                    ? `Selected clinician: ${selectedProvider.display_name || selectedProvider.email || "Clinician"}`
                    : "Select a clinician to continue."}
                </p>
                {selectedProviderRate != null ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Hourly rate: {formatCurrency(selectedProviderRate)}
                  </p>
                ) : selectedProviderId ? (
                  <p className="mt-1 text-xs text-amber-600">
                    Hourly rate not set for this clinician.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  Start
                  <input
                    type="datetime-local"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2 disabled:bg-zinc-100"
                    value={appointmentStart}
                    onChange={(event) =>
                      setAppointmentStart(event.target.value)
                    }
                    disabled={!selectedProviderId}
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                  End
                  <input
                    type="datetime-local"
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2 disabled:bg-zinc-100"
                    value={appointmentEnd}
                    onChange={(event) =>
                      setAppointmentEnd(event.target.value)
                    }
                    disabled={!selectedProviderId}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
                Notes for the clinician (optional)
                <textarea
                  className="min-h-[120px] rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-emerald-200 transition focus:ring-2 disabled:bg-zinc-100"
                  value={appointmentNotes}
                  onChange={(event) => setAppointmentNotes(event.target.value)}
                  disabled={!selectedProviderId}
                />
              </label>

              {selectedEstimatedTotal != null &&
              selectedDurationMinutes &&
              selectedDurationMinutes > 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  Estimated total for {selectedDurationMinutes} minutes:{" "}
                  <span className="font-semibold">
                    {formatCurrency(selectedEstimatedTotal)}
                  </span>
                </div>
              ) : null}

              <button
                type="submit"
                className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                disabled={scheduleStatus.type === "loading" || !selectedProviderId}
              >
                Request appointment
              </button>
            </form>

                <div className="space-y-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-sm text-zinc-600">
                  <p className="font-semibold text-zinc-900">
                    {selectedProvider
                      ? `Availability for ${selectedProvider.display_name || selectedProvider.email || "clinician"}`
                      : "Select a clinician to view availability."}
                  </p>
                  {providerAvailability.length ? (
                    providerAvailability.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/70 bg-white px-3 py-2"
                      >
                        <span className="text-xs text-zinc-600">
                          {formatDateTime(slot.starts_at)} –{" "}
                          {formatDateTime(slot.ends_at)}
                        </span>
                        <button
                          type="button"
                          className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                          onClick={() => {
                            setAppointmentStart(toInputValue(slot.starts_at));
                            setAppointmentEnd(toInputValue(slot.ends_at));
                          }}
                        >
                          Use slot
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-zinc-500">
                      No availability published yet.
                    </p>
                  )}
                </div>

                {scheduleStatus.type !== "idle" && scheduleStatus.message && (
                  <p
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      scheduleStatus.type === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {scheduleStatus.message}
                  </p>
                )}
              </div>
            )}

            <aside className="flex flex-col gap-4 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4" open>
                <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                  {showMedicalTools ? "Upcoming requests" : "Your requests"}
                </summary>
                <div className="mt-4 space-y-3">
                  {loadingAppointments ? (
                    <p className="text-sm text-zinc-500">Loading appointments…</p>
                  ) : upcomingAppointments.length ? (
                    upcomingAppointments.map((appointment) => {
                  const counterpartId = showMedicalTools
                    ? appointment.patient_id
                    : appointment.provider_id;
                  const counterpart = profileLookup[counterpartId];
                  const draft = appointmentDrafts[appointment.id];
                  const durationMinutes = getDurationMinutes(appointment);
                  const statusTone =
                    appointment.status === "requested"
                      ? "text-amber-700"
                      : appointment.status === "confirmed"
                      ? "text-emerald-700"
                      : "text-emerald-700";

                      return (
                        <div
                          key={appointment.id}
                          className="rounded-2xl border border-zinc-200/80 bg-white p-4"
                        >
                      <p className="text-sm font-semibold text-zinc-900">
                        {counterpart?.display_name ||
                          counterpart?.email ||
                          counterpartId}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {formatDateTime(appointment.starts_at)} –{" "}
                        {formatDateTime(appointment.ends_at)}
                      </p>
                      {durationMinutes > 30 && (
                        <p className="mt-2 text-xs font-semibold text-amber-700">
                          Extended session selected: {durationMinutes} minutes
                        </p>
                      )}
                      {appointment.status === "confirmed" ? (
                        <Link
                          className="mt-2 inline-flex items-center rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-700"
                          href={`/appointments/${appointment.id}/connect`}
                        >
                          Connect now
                        </Link>
                      ) : (
                        <p
                          className={`mt-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
                        >
                          {appointment.status}
                        </p>
                      )}
                      {appointment.notes && (
                        <p className="mt-2 text-xs text-zinc-600">
                          Notes: {appointment.notes}
                        </p>
                      )}
                      {appointment.proposed_reason && (
                        <p className="mt-2 text-xs text-zinc-600">
                          Reason: {appointment.proposed_reason}
                        </p>
                      )}

                      {showMedicalTools &&
                        appointment.status === "requested" && (
                          <div className="mt-4 grid gap-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <input
                                type="datetime-local"
                                className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                                value={draft?.starts_at ?? ""}
                                onChange={(event) =>
                                  setAppointmentDrafts((prev) => ({
                                    ...prev,
                                    [appointment.id]: {
                                      starts_at: event.target.value,
                                      ends_at: draft?.ends_at ?? "",
                                      reason: draft?.reason ?? "",
                                    },
                                  }))
                                }
                              />
                              <input
                                type="datetime-local"
                                className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                                value={draft?.ends_at ?? ""}
                                onChange={(event) =>
                                  setAppointmentDrafts((prev) => ({
                                    ...prev,
                                    [appointment.id]: {
                                      starts_at: draft?.starts_at ?? "",
                                      ends_at: event.target.value,
                                      reason: draft?.reason ?? "",
                                    },
                                  }))
                                }
                              />
                            </div>
                            <textarea
                              className="min-h-[80px] rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                              placeholder="Reason for the change"
                              value={draft?.reason ?? ""}
                              onChange={(event) =>
                                setAppointmentDrafts((prev) => ({
                                  ...prev,
                                  [appointment.id]: {
                                    starts_at: draft?.starts_at ?? "",
                                    ends_at: draft?.ends_at ?? "",
                                    reason: event.target.value,
                                  },
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                                onClick={() =>
                                  handleProviderAccept(appointment.id)
                                }
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                                onClick={() =>
                                  handleProviderPropose(appointment.id)
                                }
                              >
                                Propose new time
                              </button>
                            </div>
                          </div>
                        )}

                      {showClientTools &&
                        appointment.status === "proposed" && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                              onClick={() =>
                                handlePatientConfirm(appointment.id)
                              }
                            >
                              Accept proposal
                            </button>
                            <button
                              type="button"
                              className="rounded-full border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                              onClick={() =>
                                handlePatientDecline(appointment.id)
                              }
                            >
                              Decline
                            </button>
                          </div>
                        )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-zinc-500">
                      No appointments yet. New requests will show up here.
                    </p>
                  )}
                </div>
              </details>

              <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                  Achieved consultations
                </summary>
                <div className="mt-4 space-y-3">
                  {loadingAppointments ? (
                    <p className="text-sm text-zinc-500">Loading consultations…</p>
                  ) : completedAppointments.length ? (
                    completedAppointments.map((appointment) => {
                      const counterpartId = showMedicalTools
                        ? appointment.patient_id
                        : appointment.provider_id;
                      const counterpart = profileLookup[counterpartId];
                      const isPast = appointmentIsPast(appointment);
                      const durationMinutes = getDurationMinutes(appointment);

                      return (
                        <div
                          key={appointment.id}
                          className={`rounded-2xl border border-zinc-200/80 bg-white p-4 ${
                            isPast ? "opacity-60" : ""
                          }`}
                        >
                          <p className="text-sm font-semibold text-zinc-900">
                            {counterpart?.display_name ||
                              counterpart?.email ||
                              counterpartId}
                          </p>
                          <p className="mt-2 text-xs text-zinc-500">
                            {formatDateTime(appointment.starts_at)} –{" "}
                            {formatDateTime(appointment.ends_at)}
                          </p>
                          {durationMinutes > 30 && (
                            <p className="mt-2 text-xs font-semibold text-zinc-500">
                              Extended session: {durationMinutes} minutes
                            </p>
                          )}
                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                            {appointment.status}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-zinc-500">
                      No completed consultations yet.
                    </p>
                  )}
                </div>
              </details>

              <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                  Available dates
                </summary>
                <div className="mt-4 space-y-3">
                  {!showMedicalTools ? (
                    <p className="text-sm text-zinc-500">
                      Availability is managed by medical professionals.
                    </p>
                  ) : loadingAvailability ? (
                    <p className="text-sm text-zinc-500">Loading availability…</p>
                  ) : availability.length ? (
                    availability.map((slot) => (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">
                            {formatDateTime(slot.starts_at)} –{" "}
                            {formatDateTime(slot.ends_at)}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {slot.is_blocked
                              ? "Marked unavailable"
                              : "Open for booking"}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                          onClick={() => handleRemoveAvailability(slot.id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-zinc-500">
                      No availability added yet.
                    </p>
                  )}
                </div>
              </details>

              {profile?.role === "medical" && (
                <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                    Paid payouts
                  </summary>
                  <div className="mt-4 space-y-3">
                    {loadingProviderPayouts ? (
                      <p className="text-sm text-zinc-500">Loading payouts…</p>
                    ) : providerPayouts.length ? (
                      providerPayouts.map((payout) => (
                        <div
                          key={payout.id}
                          className="rounded-2xl border border-zinc-200/80 bg-white p-4"
                        >
                          <p className="text-sm font-semibold text-zinc-900">
                            {formatCurrency(Number(payout.amount_gbp))}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {payout.payout_provider.toUpperCase()} payout
                          </p>
                          {payout.processed_at && (
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatDateTime(payout.processed_at)}
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">
                        No paid payouts yet.
                      </p>
                    )}
                  </div>
                </details>
              )}

              {profile?.role === "admin" && (
                <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-zinc-900">
                    Payout requests
                  </summary>
                  <div className="mt-4 space-y-3">
                    {loadingPayoutRequests ? (
                      <p className="text-sm text-zinc-500">
                        Loading payout requests…
                      </p>
                    ) : payoutRequests.length ? (
                      payoutRequests.map((request) => {
                        const provider = profileLookup[request.provider_id];
                        return (
                          <div
                            key={request.id}
                            className="rounded-2xl border border-zinc-200/80 bg-white p-4"
                          >
                            <p className="text-sm font-semibold text-zinc-900">
                              {provider?.display_name ||
                                provider?.email ||
                                request.provider_id}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {request.paypal_email || "No PayPal email"}
                            </p>
                            <p className="mt-2 text-xs font-semibold text-emerald-700">
                              {formatCurrency(Number(request.amount_gbp))}
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-zinc-500">
                        No pending payout requests.
                      </p>
                    )}
                  </div>
                </details>
              )}
            </aside>
          </section>
        )}

        {profileTab === "meetings" && isAdmin && (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <div className="space-y-2">
                <h2 className="font-[var(--font-display)] text-2xl font-semibold text-zinc-900">
                  Upcoming meetings
                </h2>
                <p className="text-sm text-zinc-500">
                  Review and edit upcoming appointments across the platform.
                </p>
              </div>

              {loadingAppointments ? (
                <p className="text-sm text-zinc-500">Loading appointments…</p>
              ) : upcomingAppointments.length ? (
                <div className="space-y-4">
                  {upcomingAppointments.map((appointment) => {
                    const counterpartId = appointment.provider_id;
                    const provider = profileLookup[counterpartId];
                    const patient = profileLookup[appointment.patient_id];
                    const draft = appointmentDrafts[appointment.id];

                    return (
                      <div
                        key={appointment.id}
                        className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">
                              {patient?.display_name ||
                                patient?.email ||
                                appointment.patient_id}
                            </p>
                            <p className="text-xs text-zinc-500">
                              Clinician:{" "}
                              {provider?.display_name ||
                                provider?.email ||
                                appointment.provider_id}
                            </p>
                          </div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                            {appointment.status}
                          </p>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <input
                            type="datetime-local"
                            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                            value={draft?.starts_at ?? ""}
                            onChange={(event) =>
                              setAppointmentDrafts((prev) => ({
                                ...prev,
                                [appointment.id]: {
                                  starts_at: event.target.value,
                                  ends_at: draft?.ends_at ?? "",
                                  reason: draft?.reason ?? "",
                                },
                              }))
                            }
                          />
                          <input
                            type="datetime-local"
                            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                            value={draft?.ends_at ?? ""}
                            onChange={(event) =>
                              setAppointmentDrafts((prev) => ({
                                ...prev,
                                [appointment.id]: {
                                  starts_at: draft?.starts_at ?? "",
                                  ends_at: event.target.value,
                                  reason: draft?.reason ?? "",
                                },
                              }))
                            }
                          />
                          <select
                            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs outline-none ring-emerald-200 transition focus:ring-2"
                            value={adminStatusDrafts[appointment.id] ?? appointment.status}
                            onChange={(event) =>
                              setAdminStatusDrafts((prev) => ({
                                ...prev,
                                [appointment.id]: event.target.value as AppointmentStatus,
                              }))
                            }
                          >
                            {(
                              [
                                "requested",
                                "proposed",
                                "confirmed",
                                "cancelled",
                                "completed",
                              ] as AppointmentStatus[]
                            ).map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                            onClick={() => handleAdminUpdate(appointment.id)}
                          >
                            Save changes
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  No upcoming meetings found.
                </p>
              )}

              {scheduleStatus.type !== "idle" && scheduleStatus.message && (
                <p
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    scheduleStatus.type === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {scheduleStatus.message}
                </p>
              )}
            </div>

            <aside className="flex flex-col gap-4 rounded-[28px] border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.35)]">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
                Admin notes
              </p>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                Use this view to update appointment times or status across the
                platform. Changes take effect immediately.
              </div>
            </aside>
          </section>
        )}
      </main>
    </div>
  );
}
