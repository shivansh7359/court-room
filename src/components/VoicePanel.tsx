import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/* Live audio for the hearing. Browser-to-browser (WebRTC); Supabase Realtime only carries the
   call setup messages. Speaking rights follow the court rules: the judge may speak at any time,
   the prosecutor and defense only on their turn (and not while an objection is pending).
   Everyone else listens. Each browser also mutes incoming audio from anyone who may not speak. */

const SPEAKER_ROLES = ["judge", "prosecutor", "defense"];
const canSpeak = (role: string | undefined, turn: string, pending: boolean, stage?: string) =>
  role === "judge" || ((role === "prosecutor" || role === "defense") && !pending && stage !== "evidence" && turn === role);

function iceServers(): RTCIceServer[] {
  try {
    const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined;
    if (raw) return JSON.parse(raw) as RTCIceServer[];
  } catch {
    /* fall back to public STUN */
  }
  return [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
}

type Peer = { pc: RTCPeerConnection; audio: HTMLAudioElement; queue: RTCIceCandidateInit[]; ready: boolean };
type Signal = { type: "hello" | "here" | "offer" | "answer" | "ice" | "bye"; from: string; to?: string; data?: unknown };

function attachLocal(pc: RTCPeerConnection, stream: MediaStream | null) {
  const track = stream?.getAudioTracks()[0];
  if (!track || !stream) return;
  const t = pc.getTransceivers().find((x) => x.receiver.track.kind === "audio");
  if (t) {
    void t.sender.replaceTrack(track);
    t.direction = "sendrecv";
  } else pc.addTrack(track, stream);
}

export function VoicePanel({ caseId, userId, myRole, roles, turn, pending, stage }: {
  caseId: string; userId: string; myRole?: string; roles: Record<string, string>; turn: string; pending: boolean; stage?: string;
}) {
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [count, setCount] = useState(0);
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const local = useRef<MediaStream | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const live = useRef({ roles, turn, pending, myRole, stage });
  const micRef = useRef(false);
  live.current = { roles, turn, pending, myRole, stage };
  micRef.current = micOn;
  const isSpeaker = SPEAKER_ROLES.includes(myRole ?? "");
  const allowed = canSpeak(myRole, turn, pending, stage);

  const syncAudio = useCallback(() => {
    const { roles: r, turn: t, pending: p, myRole: mr, stage: st } = live.current;
    peers.current.forEach((peer, id) => { peer.audio.muted = !canSpeak(r[id], t, p, st); });
    local.current?.getAudioTracks().forEach((tr) => { tr.enabled = micRef.current && canSpeak(mr, t, p, st); });
  }, []);
  useEffect(() => { syncAudio(); }, [turn, pending, stage, roles, micOn, joined, syncAudio]);

  const send = useCallback((s: Omit<Signal, "from">) => {
    void channel.current?.send({ type: "broadcast", event: "sig", payload: { ...s, from: userId } });
  }, [userId]);

  const closePeer = useCallback((id: string) => {
    const p = peers.current.get(id);
    if (!p) return;
    p.pc.close(); p.audio.srcObject = null; p.audio.remove();
    peers.current.delete(id);
    setCount(peers.current.size);
  }, []);

  const makePeer = useCallback((id: string): Peer => {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    holder.current?.appendChild(audio);
    const peer: Peer = { pc, audio, queue: [], ready: false };
    pc.ontrack = (e) => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); syncAudio(); };
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: "ice", to: id, data: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(id);
      else setCount(peers.current.size);
    };
    peers.current.set(id, peer);
    setCount(peers.current.size);
    syncAudio();
    return peer;
  }, [closePeer, send, syncAudio]);

  const offerTo = useCallback(async (id: string) => {
    if (peers.current.has(id)) return;
    const peer = makePeer(id);
    if (local.current) attachLocal(peer.pc, local.current);
    else peer.pc.addTransceiver("audio", { direction: "recvonly" });
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    send({ type: "offer", to: id, data: offer });
  }, [makePeer, send]);

  const flush = async (peer: Peer) => {
    peer.ready = true;
    for (const c of peer.queue) await peer.pc.addIceCandidate(c);
    peer.queue = [];
  };

  const onSignal = useCallback(async (m: Signal) => {
    if (m.from === userId || (m.to && m.to !== userId)) return;
    const { roles: r, myRole: mr } = live.current;
    if (!r[m.from]) return; // not a member of this case
    const needed = SPEAKER_ROLES.includes(mr ?? "") || SPEAKER_ROLES.includes(r[m.from]); // listeners never link to each other
    try {
      if (m.type === "hello" || m.type === "here") {
        if (!needed) return;
        if (m.type === "hello") { closePeer(m.from); send({ type: "here", to: m.from }); }
        if (userId < m.from) await offerTo(m.from); // the lower id always makes the offer
      } else if (m.type === "offer") {
        if (!needed) return;
        const peer = makePeer(m.from);
        await peer.pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
        attachLocal(peer.pc, local.current);
        await flush(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        send({ type: "answer", to: m.from, data: answer });
      } else if (m.type === "answer") {
        const peer = peers.current.get(m.from);
        if (!peer) return;
        await peer.pc.setRemoteDescription(m.data as RTCSessionDescriptionInit);
        await flush(peer);
      } else if (m.type === "ice") {
        const peer = peers.current.get(m.from);
        if (!peer) return;
        if (peer.ready) await peer.pc.addIceCandidate(m.data as RTCIceCandidateInit);
        else peer.queue.push(m.data as RTCIceCandidateInit);
      } else if (m.type === "bye") closePeer(m.from);
    } catch (err) {
      console.error("voice signalling error", err);
    }
  }, [userId, closePeer, makePeer, offerTo, send]);

  async function join() {
    try {
      if (isSpeaker) {
        local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        local.current.getAudioTracks().forEach((t) => { t.enabled = false; });
      }
      const ch = supabase.channel(`voice:${caseId}`, { config: { private: true, broadcast: { self: false } } });
      ch.on("broadcast", { event: "sig" }, ({ payload }) => { void onSignal(payload as Signal); });
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") { setJoined(true); send({ type: "hello" }); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") toast.error("Could not open the voice channel. Make sure the latest database setup was run.");
      });
      channel.current = ch;
    } catch {
      toast.error("Could not use the microphone. Allow microphone access in your browser and try again.");
    }
  }

  const leave = useCallback(() => {
    send({ type: "bye" });
    [...peers.current.keys()].forEach(closePeer);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    if (channel.current) { void supabase.removeChannel(channel.current); channel.current = null; }
    setJoined(false); setMicOn(false); setCount(0);
  }, [closePeer, send]);
  useEffect(() => () => { leave(); }, [leave]);

  const speaking = micOn && allowed;
  return (
    <>
      {!joined ? (
        <button type="button" onClick={join} title="Join the live audio of this hearing" className="btn-ghost inline-flex items-center gap-2 whitespace-nowrap py-2 px-4 text-xs">
          <PhoneCall className="h-3.5 w-3.5" /> Join voice
        </button>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-700 p-1" title={`Connected to ${count} ${count === 1 ? "person" : "people"}`}>
          <span className="px-2 font-mono text-[11px] text-emerald-300">● {count}</span>
          {isSpeaker && (
            <button
              type="button"
              disabled={!allowed}
              onClick={() => setMicOn((v) => !v)}
              aria-label={speaking ? "Mute microphone" : "Unmute microphone"}
              title={allowed ? (speaking ? "Mute" : "Unmute") : "Your microphone is locked right now"}
              className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-800 disabled:opacity-40"
            >
              {speaking ? <Mic className="h-4 w-4 text-emerald-300" /> : <MicOff className="h-4 w-4 text-slate-400" />}
            </button>
          )}
          <button type="button" onClick={leave} aria-label="Leave voice" title="Leave voice" className="grid h-8 w-8 place-items-center rounded-full hover:bg-slate-800">
            <PhoneOff className="h-4 w-4 text-red-300" />
          </button>
        </div>
      )}
      <div ref={holder} className="hidden" />
    </>
  );
}
