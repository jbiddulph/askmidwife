"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Appointment = {
  id: string;
  patient_id: string;
  provider_id: string;
  starts_at: string;
  ends_at: string;
  status: "requested" | "proposed" | "confirmed" | "cancelled" | "completed";
};

type Message = {
  id: string;
  appointment_id: string;
  sender_id: string;
  message: string;
  created_at: string;
};

type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "medical" | "client" | "admin";
};

type Status = "idle" | "loading" | "ready" | "error";

export default function AppointmentConnectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [connectStatus, setConnectStatus] = useState<Status>("loading");
  const [connectionState, setConnectionState] = useState("connecting");
  const [callEnded, setCallEnded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [chatStatus, setChatStatus] = useState<Status>("idle");
  const [clearStatus, setClearStatus] = useState<Status>("idle");
  const [profileLookup, setProfileLookup] = useState<Record<string, Profile>>(
    {},
  );

  const counterpartId = appointment
    ? appointment.provider_id === userId
      ? appointment.patient_id
      : appointment.provider_id
    : null;
  const counterpartName = counterpartId
    ? profileLookup[counterpartId]?.display_name ||
      profileLookup[counterpartId]?.email ||
      "the other participant"
    : "the other participant";

  const endCall = (notifyPeer: boolean) => {
    if (notifyPeer && channelRef.current && userId) {
      channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: {
          from: userId,
          kind: "end",
        },
      });
    }

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    peerRef.current?.close();
    peerRef.current = null;
    channelRef.current?.unsubscribe();
    channelRef.current = null;

    setConnectionState("disconnected");
    setCallEnded(true);
  };

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      setUserId(data.user?.id ?? null);
      if (!data.user) {
        setConnectStatus("error");
      }
    };

    loadSession();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (!id || !userId) return;

    const loadAppointment = async () => {
      const { data, error } = await supabase
        .from("askmidwife_appointments")
        .select("id, patient_id, provider_id, starts_at, ends_at, status")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) {
        setConnectStatus("error");
        return;
      }

      const isParticipant =
        data.patient_id === userId || data.provider_id === userId;

      if (!isParticipant) {
        setConnectStatus("error");
        return;
      }

      setAppointment(data);
      const { data: profileData } = await supabase
        .from("askmidwife_profiles")
        .select("id, email, display_name, role")
        .in("id", [data.patient_id, data.provider_id]);

      if (profileData) {
        setProfileLookup((prev) => {
          const next = { ...prev };
          profileData.forEach((profile) => {
            next[profile.id] = profile;
          });
          return next;
        });
      }
      setConnectStatus("ready");
    };

    loadAppointment();
  }, [supabase, id, userId]);

  useEffect(() => {
    if (!appointment || !userId || appointment.status !== "confirmed") return;

    let mounted = true;
    const initConnection = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!mounted) return;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        localStreamRef.current = stream;

        const peer = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        stream.getTracks().forEach((track) => peer.addTrack(track, stream));

        peer.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        peer.onconnectionstatechange = () => {
          setConnectionState(peer.connectionState);
        };

        peer.onicecandidate = (event) => {
          if (!event.candidate) return;
          channelRef.current?.send({
            type: "broadcast",
            event: "signal",
            payload: {
              from: userId,
              kind: "ice",
              candidate: event.candidate,
            },
          });
        };

        peerRef.current = peer;

        const channel = supabase.channel(`appointment-${appointment.id}`, {
          config: { broadcast: { ack: true } },
        });

        channel
          .on("broadcast", { event: "signal" }, async ({ payload }) => {
            if (payload.from === userId) return;
            if (!peerRef.current) return;

            if (payload.kind === "end") {
              endCall(false);
              return;
            }

            if (payload.kind === "offer") {
              await peerRef.current.setRemoteDescription(payload.sdp);
              const answer = await peerRef.current.createAnswer();
              await peerRef.current.setLocalDescription(answer);
              channel.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  from: userId,
                  kind: "answer",
                  sdp: peerRef.current.localDescription,
                },
              });
            }

            if (payload.kind === "answer") {
              await peerRef.current.setRemoteDescription(payload.sdp);
            }

            if (payload.kind === "ice") {
              await peerRef.current.addIceCandidate(payload.candidate);
            }
          })
          .subscribe(async (status) => {
            if (status !== "SUBSCRIBED") return;
            const isInitiator = appointment.provider_id === userId;
            if (!isInitiator) return;
            if (!peerRef.current) return;
            const offer = await peerRef.current.createOffer();
            await peerRef.current.setLocalDescription(offer);
            channel.send({
              type: "broadcast",
              event: "signal",
              payload: {
                from: userId,
                kind: "offer",
                sdp: peerRef.current.localDescription,
              },
            });
          });

        channelRef.current = channel;
      } catch (error) {
        setConnectStatus("error");
      }
    };

    initConnection();

    return () => {
      mounted = false;
      endCall(false);
    };
  }, [appointment, supabase, userId]);

  useEffect(() => {
    if (!appointment || !userId) return;

    let mounted = true;
    const loadMessages = async () => {
      setChatStatus("loading");
      const { data, error } = await supabase
        .from("askmidwife_appointment_messages")
        .select("id, appointment_id, sender_id, message, created_at")
        .eq("appointment_id", appointment.id)
        .order("created_at", { ascending: true });

      if (!mounted) return;

      if (error) {
        setChatStatus("error");
        return;
      }

      setMessages(data ?? []);
      setChatStatus("ready");
    };

    loadMessages();

    const chatChannel = supabase
      .channel(`appointment-chat-${appointment.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "askmidwife_appointment_messages",
          filter: `appointment_id=eq.${appointment.id}`,
        },
        (payload) => {
          const next = payload.new as Message;
          setMessages((prev) =>
            prev.some((item) => item.id === next.id) ? prev : [...prev, next],
          );
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(chatChannel);
    };
  }, [appointment, supabase, userId]);

  const handleSendMessage = async () => {
    if (!appointment || !userId || !messageInput.trim()) return;
    const { error } = await supabase
      .from("askmidwife_appointment_messages")
      .insert({
        appointment_id: appointment.id,
        sender_id: userId,
        message: messageInput.trim(),
      });

    if (!error) {
      setMessageInput("");
    }
  };

  const handleClearChat = async () => {
    if (!appointment) return;
    setClearStatus("loading");
    const { error } = await supabase
      .from("askmidwife_appointment_messages")
      .delete()
      .eq("appointment_id", appointment.id);

    if (error) {
      setClearStatus("error");
      return;
    }

    setMessages([]);
    setClearStatus("success");
  };

  if (connectStatus === "error") {
    return (
      <div className="min-h-screen px-6 py-12 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-10 text-red-700">
          <p className="text-lg font-semibold">Unable to join this session.</p>
          <p className="mt-2 text-sm">
            You must be signed in and part of a confirmed appointment.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              href="/"
            >
              Back home
            </Link>
            <button
              className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-700"
              onClick={() => router.back()}
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appointment && appointment.status !== "confirmed") {
    return (
      <div className="min-h-screen px-6 py-12 text-zinc-900">
        <div className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-amber-50 p-10 text-amber-700">
          <p className="text-lg font-semibold">
            This appointment is not confirmed yet.
          </p>
          <p className="mt-2 text-sm">
            You can connect once both participants have confirmed the time.
          </p>
          <div className="mt-6 flex gap-3">
            <Link
              className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
              href="/profile"
            >
              Back to profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12 text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-zinc-200/70 bg-white p-8 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.3)]">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">
            Appointment session
          </p>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold text-zinc-900">
            Connect with your clinician
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {appointment
              ? `${new Date(appointment.starts_at).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })} – ${new Date(appointment.ends_at).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Loading appointment…"}
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 rounded-3xl border border-zinc-200/70 bg-white p-6 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.3)]">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500">
              <span>Live call</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                {connectionState}
              </span>
            </div>
            {connectionState === "connecting" && !callEnded && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span className="mr-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                Wait for {counterpartName} to connect, please wait...
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-900">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                onClick={() => endCall(true)}
                disabled={callEnded}
              >
                End call
              </button>
              {callEnded && (
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-400">
                  Call ended
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Keep this tab open while connected. Audio/video requires browser
              permission.
            </p>
          </div>

          <div className="flex flex-col gap-4 rounded-3xl border border-zinc-200/70 bg-white p-6 shadow-[0_25px_70px_-60px_rgba(15,23,42,0.3)]">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-zinc-500">
              <span>Chat</span>
              <span className="text-xs text-zinc-400">{chatStatus}</span>
            </div>
            <div className="max-h-[500px] flex-1 space-y-3 overflow-y-auto rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 text-sm text-zinc-700">
              {messages.length ? (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl px-3 py-2 ${
                      message.sender_id === userId
                        ? "ml-auto bg-emerald-100 text-emerald-800"
                        : "bg-white text-zinc-700"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      {profileLookup[message.sender_id]?.display_name ||
                        profileLookup[message.sender_id]?.email ||
                        (message.sender_id === userId ? "You" : "Participant")}
                    </p>
                    <p className="mt-1">{message.message}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                      {new Date(message.created_at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-zinc-500">
                  No messages yet. Say hello!
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="rounded-full border border-red-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-600 transition hover:border-red-300 hover:text-red-700 disabled:cursor-not-allowed disabled:border-red-100 disabled:text-red-300"
                onClick={handleClearChat}
                disabled={!messages.length || clearStatus === "loading"}
              >
                Clear chat
              </button>
              {clearStatus === "loading" && (
                <span className="text-xs text-zinc-400">Clearing…</span>
              )}
              {clearStatus === "success" && (
                <span className="text-xs text-emerald-600">Chat cleared.</span>
              )}
              {clearStatus === "error" && (
                <span className="text-xs text-red-600">
                  Failed to clear chat.
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm outline-none ring-emerald-200 transition focus:ring-2"
                placeholder="Type a message"
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleSendMessage();
                  }
                }}
              />
              <button
                type="button"
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                onClick={handleSendMessage}
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
