import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Download,
  FileText,
  Lock,
  Upload,
  Scale,
  Gavel,
  ShieldCheck,
  ArrowLeft,
  Vote,
  ExternalLink,
  Send,
  CheckCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table } from "@/lib/rpc";
import { VoicePanel } from "@/components/VoicePanel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PHASE_LABEL,
  ROLE_LABEL,
  OUTCOME_LABEL,
  allowedOutcomes,
  errMsg,
  MAX_JURY_ROUNDS,
  type TallyStatus,
} from "@/lib/jury";
import { downloadCertificate } from "@/lib/certificate";

export const Route = createFileRoute("/_authenticated/cases/$id")({
  head: () => ({
    meta: [
      { title: "Courtroom Chamber | JusticeRoom" },
      { name: "description", content: "Official case courtroom proceeding." },
      { property: "og:title", content: "Courtroom Chamber | JusticeRoom" },
      { property: "og:description", content: "Official case courtroom proceeding." },
    ],
  }),
  component: CasePage,
});

type Case = {
  id: string;
  title: string;
  description: string;
  phase: string;
  jury_round: number;
  invite_code: string;
  verdict_outcome: string | null;
  verdict_summary: string | null;
  locked: boolean;
  closed_at: string | null;
  created_at?: string;
  case_type?: string;
  is_public?: boolean;
  jury_size?: number | null;
  jury_min?: number | null;
  turn?: string;
  pending_objection?: string | null;
  certificate_code?: string | null;
  stage?: string;
  hearing_round?: number;
  evidence_seen?: boolean;
};

type Member = {
  user_id: string;
  role: string;
  joined_via?: string;
  profiles: { display_name: string } | null;
};

type Event = {
  id: string;
  user_id: string | null;
  kind: string;
  content: string;
  created_at: string;
};

type Evidence = {
  id: string;
  title: string;
  file_path: string;
  file_name: string;
  size_bytes: number | null;
  restricted: boolean;
  uploaded_by: string;
  created_at: string;
  approval: string;
  expires_at?: string | null;
  purged_at?: string | null;
};

type Tally = {
  round: number;
  jurors: number;
  voted: number;
  guilty: number;
  not_guilty: number;
  status: TallyStatus;
};

type Cert = {
  id: string;
  role: string;
  issued_at: string;
};

const ROLE_BADGE_STYLE: Record<string, string> = {
  prosecutor: "border-red-400/50 bg-red-500/10 text-red-300",
  defense: "border-sky-400/50 bg-sky-500/10 text-sky-300",
  judge: "border-amber-400/50 bg-amber-500/10 text-amber-300",
  juror: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",
  witness: "border-orange-400/50 bg-orange-500/10 text-orange-300",
  observer: "border-slate-600 bg-slate-800 text-slate-300",
};

// Phase stepper definition
const PHASES = [
  { key: "pre_trial", label: "Filing" },
  { key: "hearing", label: "Opening" },
  { key: "hearing_evidence", label: "Evidence" },
  { key: "hearing_closing", label: "Closing" },
  { key: "deliberation", label: "Jury" },
  { key: "closed", label: "Verdict" },
  { key: "locked", label: "Locked" },
] as const;

function getPhaseIndex(phase: string, locked: boolean, stage?: string): number {
  if (locked) return 6;
  switch (phase) {
    case "pre_trial": return 0;
    case "hearing": return stage === "closing" ? 3 : stage === "evidence" ? 2 : 1;
    case "deliberation": return 4;
    case "closed": return 5;
    default: return 0;
  }
}

function formatCaseNumber(id: string, createdAt?: string) {
  const year = createdAt ? new Date(createdAt).getFullYear() : 2026;
  const cleanId = id.replace(/-/g, "").toUpperCase();
  const suffix = cleanId.slice(-6);
  return `JR-${year}-${suffix}`;
}

function parseCategoryFromDescription(description: string): string | null {
  const match = description.match(/^\[Category:\s*([^\]]+)\]/);
  return match && match[1] ? match[1].trim() : null;
}

function CasePage() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const [c, setC] = useState<Case | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [tally, setTally] = useState<Tally | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [cert, setCert] = useState<Cert | null>(null);

  const loadCase = useCallback(async () => {
    const { data } = await supabase.from("cases").select("*").eq("id", id).maybeSingle();
    setC(data as Case | null);
  }, [id]);

  const loadMembers = useCallback(async () => {
    // An older database has no joined_via column. Retry without it so the seats still show.
    let res = await supabase.from("case_members").select("user_id, role, joined_via, profiles(display_name)").eq("case_id", id);
    if (res.error) res = (await supabase.from("case_members").select("user_id, role, profiles(display_name)").eq("case_id", id)) as typeof res;
    setMembers((res.data as unknown as Member[]) ?? []);
  }, [id]);

  const loadEvents = useCallback(async () => {
    const { data } = await supabase
      .from("hearing_events")
      .select("*")
      .eq("case_id", id)
      .order("created_at");
    setEvents((data as Event[]) ?? []);
  }, [id]);

  const loadEvidence = useCallback(async () => {
    const { data } = await supabase
      .from("evidence")
      .select("*")
      .eq("case_id", id)
      .order("created_at", { ascending: false });
    setEvidence((data as Evidence[]) ?? []);
  }, [id]);

  const loadJury = useCallback(async () => {
    const { data } = await supabase.rpc("jury_tally", { _case: id });
    const t = data?.[0] as Tally | undefined;
    setTally(t ?? null);
    if (t) {
      const { data: v } = await supabase
        .from("jury_votes")
        .select("vote")
        .eq("case_id", id)
        .eq("user_id", user.id)
        .eq("round", t.round)
        .maybeSingle();
      setMyVote(v?.vote ?? null);
    }
  }, [id, user.id]);

  const loadCert = useCallback(async () => {
    const { data } = await supabase
      .from("certificates")
      .select("id, role, issued_at")
      .eq("case_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    setCert(data as Cert | null);
  }, [id, user.id]);

  useEffect(() => {
    loadCase();
    loadMembers();
    loadEvents();
    loadEvidence();
    loadJury();
    loadCert();

    const ch = supabase
      .channel(`case-${id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cases", filter: `id=eq.${id}` }, () => {
        loadCase();
        loadJury();
        loadCert();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "case_members", filter: `case_id=eq.${id}` }, () => {
        loadMembers();
        loadJury();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "hearing_events", filter: `case_id=eq.${id}` }, loadEvents)
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence", filter: `case_id=eq.${id}` }, loadEvidence)
      .on("postgres_changes", { event: "*", schema: "public", table: "jury_votes", filter: `case_id=eq.${id}` }, loadJury)
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, loadCase, loadMembers, loadEvents, loadEvidence, loadJury, loadCert]);

  const [seatReqs, setSeatReqs] = useState<{ role: string; prosecutor_ok: boolean | null; defense_ok: boolean | null }[]>([]);
  useEffect(() => {
    const load = () => table("seat_requests").select("role, prosecutor_ok, defense_ok").eq("case_id", id).eq("status", "pending").then(({ data }: { data: typeof seatReqs | null }) => setSeatReqs(data ?? []));
    load();
    const ch = supabase.channel(`seatdots-${id}-${Math.random().toString(36).slice(2)}`).on("postgres_changes", { event: "*", schema: "public", table: "seat_requests", filter: `case_id=eq.${id}` }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);
  useEffect(() => {
    if (!c?.locked) return;
    (async () => {
      const { data } = await rpc("expired_evidence", { _case: id });
      const rows = (data ?? []) as { id: string; file_path: string }[];
      if (rows.length === 0) return;
      await supabase.storage.from("evidence").remove(rows.map((r) => r.file_path));
      await rpc("mark_evidence_purged", { _ids: rows.map((r) => r.id) });
      loadEvidence();
    })();
  }, [c?.locked, id, loadEvidence]);
  const [schemaOk, setSchemaOk] = useState<boolean | null>(null);
  useEffect(() => {
    rpc("schema_version").then(({ data, error }) => setSchemaOk(!error && Number(data) >= 6));
  }, []);
  const [removal, setRemoval] = useState<string | null>(null);
  useEffect(() => {
    const ch = supabase
      .channel(`removed-${id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "case_removals", filter: `user_id=eq.${user.id}` }, (p) => {
        const row = p.new as { case_id: string; reason: string };
        if (row.case_id === id) setRemoval(row.reason);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, user.id]);
  useEffect(() => {
    if (c === null) {
      table("case_removals").select("reason").eq("case_id", id).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1)
        .then(({ data }: { data: { reason: string }[] | null }) => { if (data && data[0]) setRemoval(data[0].reason); });
    }
  }, [c, id, user.id]);

  if (removal !== null) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-6 backdrop-blur-sm" role="alertdialog" aria-modal="true">
        <div className="panel max-w-md p-8 text-center">
          <Gavel className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="mt-4 font-serif text-2xl text-slate-100">You were removed from this case</h1>
          <p className="mt-2 text-sm text-slate-400">The judge removed you from the jury and gave this reason:</p>
          <p className="mt-4 whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950/70 p-4 text-left text-sm text-slate-200">{removal}</p>
          <Link to="/dashboard" className="btn-gold mt-6 inline-flex">Go back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (c === undefined) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
        <div className="panel h-20 animate-pulse bg-slate-900/40 mb-6" />
        <div className="panel h-96 animate-pulse bg-slate-900/40" />
      </main>
    );
  }

  if (c === null) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <div className="panel p-8">
          <Gavel className="mx-auto h-10 w-10 text-amber-400" />
          <h1 className="mt-4 font-serif text-2xl text-slate-100">Case Unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">
            This proceeding does not exist, or you have not been granted access to this docket.
          </p>
          <div className="mt-6">
            <Link to="/dashboard" className="btn-gold">Return to Docket</Link>
          </div>
        </div>
      </main>
    );
  }

  const myRole = members.find((m) => m.user_id === user.id)?.role;
  const names = Object.fromEntries(
    members.map((m) => [m.user_id, m.profiles?.display_name ?? "Member"])
  );
  const isJudge = myRole === "judge";
  const isParty = myRole === "prosecutor" || myRole === "defense";
  const pendingEv = evidence.filter((e) => e.approval === "pending").length;
  const seatTodo = seatReqs.filter((q) => (q.role === "juror" ? isJudge : myRole === "prosecutor" ? !q.prosecutor_ok : myRole === "defense" ? !q.defense_ok : false)).length;
  const todo: Record<string, string | null> = {
    courtroom:
      c.locked || c.phase !== "hearing" ? null
      : c.pending_objection ? (isJudge ? "Rule on the pending objection" : null)
      : isParty && c.stage !== "evidence" && c.turn === myRole ? "It is your turn to speak" : null,
    evidence: isJudge && !c.locked && pendingEv > 0 ? `${pendingEv} exhibit${pendingEv === 1 ? "" : "s"} waiting for your approval` : null,
    participants: seatTodo > 0 ? `${seatTodo} seat request${seatTodo === 1 ? "" : "s"} waiting for your decision` : null,
    votes:
      c.locked ? null
      : isJudge && c.phase === "hearing" && c.stage === "evidence" ? (c.evidence_seen ? "Decide whether a further hearing is needed" : "Confirm that you have seen the evidence")
      : c.phase === "deliberation" && tally && tally.jurors > 0 && (myRole === "juror" || isJudge) && !myVote ? "Cast your vote"
      : c.phase === "deliberation" && isJudge && tally && tally.status !== "pending" ? "Enter the final verdict" : null,
  };
  const caseNum = formatCaseNumber(c.id, c.created_at);
  const myRoleBadgeClass = myRole ? ROLE_BADGE_STYLE[myRole] : "";
  const category = c.case_type ? c.case_type.charAt(0).toUpperCase() + c.case_type.slice(1) : parseCategoryFromDescription(c.description);
  const phaseIdx = getPhaseIndex(c.phase, c.locked, c.stage);

  // Strip [Category:...] prefix from description for display
  const displayDescription = c.description.replace(/^\[Category:[^\]]+\]\s*\n?\n?/, "");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">
      {schemaOk === false && (
        <div role="alert" className="mb-5 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Your database is out of date, so some sections will not appear. Open Supabase, then SQL Editor, run <code className="font-mono">upgrade-database.sql</code>, and refresh this page.
        </div>
      )}

      {/* Back link */}
      <div className="mb-5">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-300 transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          Docket
        </Link>
      </div>

      {/* Case header */}
      <div className="mb-6">
        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="font-mono text-xs text-slate-500">{caseNum}</span>
          {category && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
              {category}
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
            {PHASE_LABEL[c.phase] ?? c.phase}
          </span>
          {c.locked && (
            <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
              <Lock className="h-2.5 w-2.5" /> Locked
            </span>
          )}
          {myRole && (
            <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${myRoleBadgeClass}`}>
              {ROLE_LABEL[myRole]}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold tracking-tight text-slate-100">
          {c.title}
        </h1>

        {/* Description */}
        {displayDescription && (
          <p className="mt-2 text-sm text-slate-400 leading-relaxed max-w-2xl line-clamp-2">
            {displayDescription}
          </p>
        )}
      </div>

      {/* Phase Stepper */}
      {c.certificate_code && (
        <p className="mb-3 font-mono text-xs text-amber-300">Certificate code: {c.certificate_code}</p>
      )}
      <div className="mb-6 overflow-x-auto rounded-xl border border-amber-500/20 bg-[#0d1322]/80 p-3">
        <ol className="grid min-w-[840px] grid-cols-7 gap-2">
          {PHASES.map((phase, i) => {
            const isActive = i === phaseIdx;
            const isDone = i < phaseIdx;
            return (
              <li key={phase.key} aria-current={isActive ? "step" : undefined}>
                <div
                  className={`inline-flex items-center gap-3 rounded-lg border px-4 py-3 ${
                    isActive ? "border-amber-500/50 bg-[#3a2f22]" : "border-transparent"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold ${
                      isActive
                        ? "bg-amber-500 text-slate-950"
                        : isDone
                        ? "bg-slate-700 text-slate-200"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {isDone ? <CheckCircle className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      isActive ? "text-amber-200" : isDone ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {phase.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Judge phase controls */}
      {isJudge && !c.locked && <PhaseControl c={c} onDone={loadCase} />}

      {/* Tabs */}
      <Tabs defaultValue="participants" className="mt-4">
        <TabsList className="flex h-auto gap-1 bg-transparent p-0 border-b border-slate-800/60 pb-0 w-full rounded-none justify-start">
          <TabsTrigger
            value="courtroom"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-slate-400 data-[state=active]:border-amber-500 data-[state=active]:text-amber-300 data-[state=active]:bg-transparent transition-colors"
          >
            Courtroom{todo.courtroom && <TabDot text={todo.courtroom} />}
          </TabsTrigger>
          <TabsTrigger
            value="evidence"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-slate-400 data-[state=active]:border-amber-500 data-[state=active]:text-amber-300 data-[state=active]:bg-transparent transition-colors"
          >
            Evidence ({evidence.length}){todo.evidence && <TabDot text={todo.evidence} />}
          </TabsTrigger>
          <TabsTrigger
            value="participants"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-slate-400 data-[state=active]:border-amber-500 data-[state=active]:text-amber-300 data-[state=active]:bg-transparent transition-colors"
          >
            Participants ({members.length}){todo.participants && <TabDot text={todo.participants} />}
          </TabsTrigger>
          <TabsTrigger
            value="votes"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-slate-400 data-[state=active]:border-amber-500 data-[state=active]:text-amber-300 data-[state=active]:bg-transparent transition-colors"
          >
            Vote / Verdict{todo.votes && <TabDot text={todo.votes} />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courtroom">
          <Hearing c={c} role={myRole ?? undefined} events={events} names={names} userId={user.id} roles={Object.fromEntries(members.map((m) => [m.user_id, m.role]))} />
        </TabsContent>

        <TabsContent value="evidence">
          <EvidenceTab c={c} role={myRole ?? undefined} userId={user.id} items={evidence} names={names} roles={Object.fromEntries(members.map((m) => [m.user_id, m.role]))} />
        </TabsContent>

        <TabsContent value="participants">
          <ParticipantsTab c={c} members={members} myRole={myRole ?? undefined} isJudge={isJudge} tally={tally} myVote={myVote} onJuryChange={loadJury} cert={cert} holder={names[user.id] ?? "Member"} onVerdictDone={() => { loadCase(); loadCert(); }} />
        </TabsContent>

        <TabsContent value="votes">
          <VoteVerdictTab c={c} myRole={myRole ?? undefined} isJudge={isJudge} tally={tally} myVote={myVote} onJuryChange={loadJury} cert={cert} holder={names[user.id] ?? "Member"} evidence={evidence} onChanged={loadCase} onVerdictDone={() => { loadCase(); loadCert(); }} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function PhaseControl({ c, onDone }: { c: Case; onDone: () => void }) {
  if (c.phase === "deliberation" || c.phase === "closed") return null;
  if (c.phase === "hearing" && c.stage === "evidence") return null; // the judge decides in the Vote / Verdict tab
  const isOpening = c.phase === "hearing" && c.stage === "opening";
  const label = c.phase === "pre_trial" ? "Call court to session" : isOpening ? "Close opening, move to evidence" : "Adjourn to deliberation";
  const description =
    c.phase === "pre_trial"
      ? "The hearing starts with the prosecutor. Jurors can no longer join once it begins."
      : isOpening
      ? "The opening stage ends and the evidence stage begins. You will then review the exhibits in the Vote / Verdict tab."
      : "The live hearing record closes and any seated jurors may begin casting secret ballots.";
  return (
    <div className="mb-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button type="button" className="btn-gold whitespace-nowrap text-sm">
            <Gavel className="h-4 w-4" /> {label}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="border border-amber-500/20 bg-slate-950 text-slate-100 shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-2xl text-amber-300">{label}?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400 text-sm">{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-ghost">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="btn-gold"
              onClick={async () => {
                const { error } = await rpc(isOpening ? "end_opening" : "advance_phase", { _case: c.id });
                if (error) toast.error(errMsg(error));
                else { toast.success("Proceeding advanced"); onDone(); }
              }}
            >
              Confirm Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const KIND_STYLE: Record<string, string> = {
  system: "border-l-2 border-slate-600 bg-slate-900/50 text-slate-400 italic",
  statement: "border-l-2 border-amber-500/80 bg-slate-900/70 text-slate-100",
  objection: "border-l-2 border-red-500 bg-red-950/20 text-red-200",
  ruling: "border-l-2 border-emerald-400 bg-emerald-950/20 text-emerald-200",
};

function Hearing({
  c,
  role,
  events,
  names,
  userId,
  roles,
}: {
  c: Case;
  role?: string;
  events: Event[];
  names: Record<string, string>;
  userId: string;
  roles: Record<string, string>;
}) {
  const isParty = role === "prosecutor" || role === "defense";
  const kinds = role === "judge" ? ["statement"] : isParty ? ["statement", "objection"] : [];
  const [kind, setKind] = useState("statement");
  const pending = !!c.pending_objection;
  const myTurn = isParty && c.turn === role;
  const allowed = role === "judge" || (isParty && c.stage !== "evidence" && !pending && (kind === "objection" || myTurn));
  const notice = pending
    ? "An objection is pending. The judge must rule before anyone continues."
    : isParty && c.stage === "evidence"
    ? "The judge is reviewing the evidence. The court will resume once the judge decides."
    : null;
  async function endTurn() {
    const { error } = await rpc("pass_turn", { _case: c.id });
    if (error) toast.error(errMsg(error));
  }
  async function rule(accept: boolean) {
    const { error } = await rpc("rule_objection", { _case: c.id, _accept: accept, _note: "" });
    if (error) toast.error(errMsg(error));
  }
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const { error } = await supabase.rpc("post_hearing_event", {
      _case: c.id,
      _kind: kind,
      _content: text.trim(),
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    setText("");
    if (kind === "objection") setKind("statement");
  }

  return (
    <div className="panel mt-6 overflow-hidden">
      <div className="border-b border-slate-800/80 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">Transcript of Record</p>
          <h3 className="font-serif text-lg text-slate-100">Live Courtroom Log</h3>
        </div>
        <span className="font-mono text-xs text-slate-500">
          {events.length} {events.length === 1 ? "entry" : "entries"} recorded
        </span>
      </div>

      <div className="h-[55vh] space-y-3 overflow-y-auto transcript-scroll p-6">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
            No hearing statements or rulings entered yet.
          </div>
        ) : (
          events.map((e) =>
          e.kind === "system" && /^Hearing \d+$/.test(e.content) ? (
            <div key={e.id} className="my-3 rounded-md border border-amber-500/60 bg-amber-500/15 px-4 py-2.5 text-center font-serif text-lg font-semibold uppercase tracking-widest text-amber-200">
              {e.content}
            </div>
          ) : (
            <div
              key={e.id}
              className={`rounded-md px-4 py-3 text-sm shadow-sm ${KIND_STYLE[e.kind] ?? KIND_STYLE["statement"]}`}
            >
              {e.kind !== "system" && (
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider font-semibold text-amber-300">
                    {names[e.user_id ?? ""] ?? "Participant"} · {e.kind}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                </div>
              )}
              <p className="whitespace-pre-wrap break-words leading-relaxed">{e.content}</p>
              {e.kind === "system" && (
                <div className="mt-1 font-mono text-[10px] text-slate-500">
                  {new Date(e.created_at).toLocaleTimeString()}
                </div>
              )}
            </div>
          )
          )
        )}
        <div ref={end} />
      </div>

      <div className="border-t border-slate-800/80 bg-slate-950/60 p-4 sm:p-6">
        {c.phase !== "hearing" ? (
          <p className="text-sm text-slate-400">
            {c.locked
              ? "The judicial record is concluded and permanently sealed."
              : c.phase === "pre_trial"
              ? "Court is not yet in formal session. Awaiting the presiding Judge."
              : "The hearing has adjourned to jury deliberation."}
          </p>
        ) : kinds.length === 0 ? (
          <p className="text-sm text-slate-400">
            Your courtroom role observes the hearing silently from the gallery.
          </p>
        ) : (
          <div className="space-y-3">
            {notice && <p className="text-xs text-amber-300">{notice}</p>}
            {pending && role === "judge" && (
              <div className="flex gap-2">
                <button type="button" onClick={() => rule(true)} className="btn-gold text-xs py-2 px-5">Sustain objection</button>
                <button type="button" onClick={() => rule(false)} className="btn-ghost text-xs py-2 px-5">Overrule objection</button>
              </div>
            )}
            <form onSubmit={post} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="field sm:w-40 font-mono text-xs uppercase">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border border-slate-800 bg-slate-950 text-slate-100">
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize font-mono text-xs">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                value={text}
                maxLength={4000}
                disabled={!allowed}
                onChange={(e) => setText(e.target.value)}
                placeholder={allowed ? "Address the court…" : "Wait for your turn (you may still object)"}
                className="field flex-1"
              />
              <div className="flex items-center gap-2">
                <VoicePanel caseId={c.id} userId={userId} myRole={role} roles={roles} turn={c.turn ?? "prosecutor"} pending={pending} stage={c.stage} />
                {isParty && myTurn && !pending && c.stage !== "evidence" && (
                  <button type="button" onClick={endTurn} className="btn-ghost whitespace-nowrap py-2 px-4 text-xs">End turn</button>
                )}
                <button type="submit" disabled={busy || !text.trim() || !allowed} className="btn-gold whitespace-nowrap text-xs py-2 px-6">
                  {busy ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function ParticipantsTab({
  c,
  members,
  myRole,
  isJudge,
  tally,
  myVote,
  onJuryChange,
  cert,
  holder,
  onVerdictDone,
}: {
  c: Case;
  members: Member[];
  myRole?: string;
  isJudge: boolean;
  tally: Tally | null;
  myVote: string | null;
  onJuryChange: () => void | Promise<void>;
  cert: Cert | null;
  holder: string;
  onVerdictDone: () => void;
}) {
  const order = ["judge", "prosecutor", "defense", "witness", "juror", "observer"];
  const sorted = [...members].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  // Check which key seats are filled
  const hasJudge = members.some((m) => m.role === "judge");
  const hasProsecutor = members.some((m) => m.role === "prosecutor");
  const hasDefense = members.some((m) => m.role === "defense");
  const hasJuror = members.some((m) => m.role === "juror");
  const jurorCount = members.filter((m) => m.role === "juror").length;
  const readyToBegin = hasJudge && hasProsecutor && hasDefense && true;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState(myRole === "judge" ? "juror" : "judge");
  const [inviteBusy, setInviteBusy] = useState(false);
  type Invite = { id: string; email: string; role: string; action: string; created_at: string };
  const [invites, setInvites] = useState<Invite[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [emails, setEmails] = useState<Record<string, string>>({});
  useEffect(() => {
    rpc("case_member_emails", { _case: c.id }).then(({ data }) =>
      setEmails(Object.fromEntries((data ?? []).map((r: { user_id: string; email: string }) => [r.user_id, r.email])))
    );
  }, [c.id, members.length]);
  const canInvite = myRole === "prosecutor" || myRole === "defense" || myRole === "judge";
  const loadInvites = useCallback(async () => {
    const { data } = await table("invitation_log").select("id, email, role, action, created_at").eq("case_id", c.id).order("created_at", { ascending: false });
    setInvites(data ?? []);
  }, [c.id]);
  useEffect(() => {
    loadInvites();
    const ch = supabase.channel(`invs-${c.id}-${Math.random().toString(36).slice(2)}`).on("postgres_changes", { event: "*", schema: "public", table: "invitation_log", filter: `case_id=eq.${c.id}` }, loadInvites).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [c.id, loadInvites]);
  async function removeJuror(uid: string) {
    const { error } = await rpc("remove_juror", { _case: c.id, _user: uid, _reason: reason.trim() });
    if (error) return toast.error(errMsg(error));
    toast.success("Juror removed. The reason is in the case log.");
    setRemoving(null);
    setReason("");
  }
  async function reinvite(i: Invite) {
    const { error } = await rpc("send_invitation", { _case: c.id, _email: i.email, _role: i.role });
    if (error) return toast.error(errMsg(error));
    toast.success(`Invitation sent again to ${i.email}`);
    loadInvites();
  }

  async function sendInvitation(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return toast.error("Please enter an email address");
    setInviteBusy(true);
    const { error } = await rpc("send_invitation", { _case: c.id, _email: inviteEmail.trim(), _role: inviteRole });
    setInviteBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(`Invitation sent to ${inviteEmail.trim()}. It now appears on their dashboard.`);
    setInviteEmail("");
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-5">
      {/* Left: Seated + Invitations */}
      <div className="space-y-5 lg:col-span-3">
        {/* Seated section */}
        <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80 mb-4">
            SEATED IN THIS COURT
          </p>

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-500">No participants have joined yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {sorted.map((m) => {
                const badgeClass = ROLE_BADGE_STYLE[m.role] || "border-slate-600 bg-slate-800 text-slate-300";
                return (
                  <li key={m.user_id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="group relative cursor-default text-sm font-medium text-slate-200">
                        {m.profiles?.display_name || "Court Member"}
                        {m.joined_via === "code" && <span className="ml-2 text-xs font-normal text-slate-500">(through invite code)</span>}
                        {emails[m.user_id] && (
                          <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-normal text-slate-200 shadow-lg group-hover:block">
                            {emails[m.user_id]}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {isJudge && m.role === "juror" && !c.locked && ["pre_trial", "hearing"].includes(c.phase) && (
                          <button
                            type="button"
                            onClick={() => { setRemoving(removing === m.user_id ? null : m.user_id); setReason(""); }}
                            className="btn-ghost py-1 px-3 text-[11px]"
                          >
                            Remove
                          </button>
                        )}
                        <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${badgeClass}`}>
                          {ROLE_LABEL[m.role] || m.role}
                        </span>
                      </div>
                    </div>
                    {removing === m.user_id && (
                      <div className="mt-3 space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                        <label className="text-xs text-slate-300">Reason for removing this juror (recorded in the case log and sent to the juror)</label>
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="field" />
                        <div className="flex gap-2">
                          <button type="button" disabled={reason.trim().length < 10} onClick={() => removeJuror(m.user_id)} className="btn-gold py-1.5 px-4 text-xs">Confirm removal</button>
                          <button type="button" onClick={() => setRemoving(null)} className="btn-ghost py-1.5 px-4 text-xs">Cancel</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {!readyToBegin && !c.locked && (
            <p className="mt-4 text-xs text-slate-500 leading-relaxed border-t border-slate-800/60 pt-4">
              The hearing needs a judge, a prosecutor and a defense counsel before it can begin. A jury is optional: the case can go ahead with any number of jurors up to the maximum.
            </p>
          )}
        </div>

        {/* Invitations section (full history) */}
        <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80 mb-3">
            INVITATIONS
          </p>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No invitations have been sent for this case yet.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y divide-slate-800/60 overflow-y-auto">
              {invites.map((i, idx) => {
                const latest = invites.findIndex((x) => x.email === i.email && x.role === i.role) === idx;
                const bad = i.action === "declined" || i.action === "removed";
                const mayReinvite =
                  latest && bad && !c.locked &&
                  (i.role === "juror" ? myRole === "judge" : i.role === "judge" ? myRole === "prosecutor" || myRole === "defense" : myRole === "prosecutor");
                const seat = (ROLE_LABEL[i.role] ?? i.role).toLowerCase();
                const text =
                  i.action === "invited" ? `Invited to the ${seat} seat.`
                  : i.action === "accepted" ? `Accepted the ${seat} seat.`
                  : i.action === "declined" ? `Declined the ${seat} seat.`
                  : `Removed from the ${seat} seat by the judge.`;
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{i.email}</p>
                      <p className={`mt-0.5 text-xs ${bad ? "text-red-300/90" : i.action === "accepted" ? "text-emerald-300/90" : "text-slate-500"}`}>
                        {text} <span className="text-slate-500">{new Date(i.created_at).toLocaleString()}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${ROLE_BADGE_STYLE[i.role] ?? ""}`}>
                        {ROLE_LABEL[i.role] ?? i.role}
                      </span>
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${bad ? "text-red-300" : i.action === "accepted" ? "text-emerald-300" : "text-amber-300"}`}>
                        {i.action}
                      </span>
                      {mayReinvite && (
                        <button type="button" onClick={() => reinvite(i)} className="btn-ghost py-1 px-3 text-[11px]">Invite again</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Invite panel */}
      <div className="lg:col-span-2">
        {!c.locked && <SeatTools c={c} role={myRole} />}
        {canInvite && !c.locked ? (
          <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80 mb-4">
              INVITE A PARTICIPANT
            </p>

            <form onSubmit={sendInvitation} className="space-y-3">
              <div>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full rounded-md border border-slate-700 bg-slate-950/80 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40 transition-colors"
                />
              </div>

              <div>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger className="w-full rounded-md border border-slate-700 bg-slate-950/80 px-3.5 py-2.5 text-sm text-slate-100 h-10 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border border-slate-800 bg-[#090e1a] text-slate-100 shadow-xl">
                    {(myRole === "judge" ? ["juror"] : myRole === "defense" ? ["judge"] : ["judge", "defense"]).map((r) => (
                      <SelectItem key={r} value={r} className="capitalize cursor-pointer text-sm focus:bg-amber-500/15 focus:text-amber-200">
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <button
                type="submit"
                disabled={inviteBusy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-sm font-medium text-slate-950 transition-all hover:bg-amber-400 active:scale-95 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {inviteBusy ? "Sending…" : "Send invitation"}
              </button>
            </form>

            {/* Invite code */}
            <div className="mt-5 pt-4 border-t border-slate-800/60">
              <p className="text-xs text-slate-500 leading-relaxed mb-3">
                The invitation appears in the Invitations panel on their dashboard once they sign in with this email. No email is sent, so let them know to register. The prosecutor invites the judge and defense. The defense can invite a judge. The judge invites jurors. Or share the case code below: people choose judge, defense or juror when they join, and jurors need the judge's approval.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-center font-mono text-sm tracking-widest text-amber-300">
                  {c.invite_code}
                </code>
                <button
                  type="button"
                  aria-label="Copy invite code"
                  onClick={() => {
                    navigator.clipboard.writeText(c.invite_code);
                    toast.success("Invite code copied to clipboard");
                  }}
                  className="btn-ghost p-2.5"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : !c.locked ? null : (
          <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6 text-center">
            <Lock className="mx-auto h-8 w-8 text-slate-600 mb-3" />
            <p className="text-sm text-slate-500">This case is locked. No new participants can join.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceTab({
  c,
  role,
  userId,
  items,
  names,
  roles,
}: {
  c: Case;
  role?: string;
  userId: string;
  items: Evidence[];
  names: Record<string, string>;
  roles?: Record<string, string>;
}) {
  const canUpload =
    !c.locked &&
    ["pre_trial", "hearing"].includes(c.phase) &&
    ["judge", "prosecutor", "defense"].includes(role ?? "");

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error("Please choose a file");
    if (file.size > 1048576) return toast.error("Files must be 1 MB or smaller");
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return toast.error("Only images (PNG, JPG, WEBP, GIF) or PDF files are allowed");
    setBusy(true);
    const path = `${c.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const up = await supabase.storage.from("evidence").upload(path, file, { contentType: file.type });
    if (up.error) {
      setBusy(false);
      return toast.error(up.error.message);
    }
    const { error } = await supabase.from("evidence").insert({
      case_id: c.id,
      uploaded_by: userId,
      title: title.trim() || file.name,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      restricted,
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(role === "judge" ? "Exhibit filed in court records" : "Exhibit submitted. It will reach the jury once the judge approves it.");
    setTitle("");
    setFile(null);
    setRestricted(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function review(ev: Evidence, ok: boolean) {
    const { error } = await rpc("review_evidence", { _evidence: ev.id, _approve: ok });
    if (error) return toast.error(errMsg(error));
    toast.success(ok ? "Exhibit approved. The jury can now see it." : "Exhibit rejected. The jury will not see it.");
  }

  const expiresAtMs = c.locked && c.closed_at ? new Date(c.closed_at).getTime() + 3 * 86400000 : null;
  const isExpired = (ev: Evidence) => !!ev.purged_at || (expiresAtMs !== null && Date.now() > expiresAtMs);
  async function download(ev: Evidence) {
    const { data, error } = await supabase.storage.from("evidence").createSignedUrl(ev.file_path, 60, { download: ev.file_name });
    if (error || !data) return toast.error("This file is no longer available");
    window.open(data.signedUrl, "_blank");
  }

  async function open(ev: Evidence) {
    const { data, error } = await supabase.storage.from("evidence").createSignedUrl(ev.file_path, 120);
    if (error || !data) return toast.error("You do not have judicial clearance to inspect this file");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12">
      <div className="space-y-3 lg:col-span-8">
        <div className="flex items-center justify-between pb-2">
          <p className="eyebrow">Evidentiary Locker</p>
          <span className="font-mono text-xs text-slate-500">
            {items.length} {items.length === 1 ? "exhibit" : "exhibits"} on file
          </span>
        </div>

        {items.length === 0 ? (
          <div className="panel border-dashed border-amber-500/20 p-12 text-center text-sm text-slate-400">
            No physical exhibits or documentary evidence filed yet.
          </div>
        ) : (
          items.map((ev, i) => (
            <div
              key={ev.id}
              className="panel flex items-center justify-between gap-4 p-5 transition-[border-color] hover:border-amber-500/40"
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-serif text-lg font-semibold text-slate-100">
                    Exhibit {items.length - i}: {ev.title}
                  </div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">
                    Filed by {names[ev.uploaded_by] ?? "Counsel"}{roles?.[ev.uploaded_by] ? ` (${(ROLE_LABEL[roles[ev.uploaded_by]] ?? roles[ev.uploaded_by]).toLowerCase()})` : ""} · {ev.file_name}
                    {ev.size_bytes ? ` · ${(ev.size_bytes / 1024).toFixed(0)} KB` : ""}
                    {ev.restricted ? (
                      <span className="ml-2 text-amber-300 font-semibold uppercase text-[10px]">
                        [Bench & Counsel Only]
                      </span>
                    ) : null}
                    <span className={`ml-2 font-semibold uppercase text-[10px] ${ev.approval === "approved" ? "text-emerald-300" : ev.approval === "rejected" ? "text-red-300" : "text-amber-300"}`}>
                      [{ev.approval === "approved" ? "Approved" : ev.approval === "rejected" ? "Rejected" : "Awaiting judge"}]
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {role === "judge" && !c.locked && ev.approval === "pending" && (
                  <>
                    <button type="button" onClick={() => review(ev, true)} className="btn-gold text-xs py-2 px-4">Approve</button>
                    <button type="button" onClick={() => review(ev, false)} className="btn-ghost text-xs py-2 px-4">Reject</button>
                  </>
                )}
                {isExpired(ev) ? (
                  <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Expired</span>
                ) : (
                  <>
                    <button type="button" onClick={() => open(ev)} className="btn-ghost text-xs py-2 px-4 whitespace-nowrap">
                      Inspect Exhibit <ExternalLink className="h-3 w-3 ml-1" />
                    </button>
                    <button type="button" onClick={() => download(ev)} className="btn-ghost text-xs py-2 px-4 whitespace-nowrap">
                      <Download className="h-3 w-3 mr-1" /> Download
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="lg:col-span-4">
        <div className="panel p-6">
          <p className="eyebrow">Tender Evidence</p>
          <h3 className="mt-2 font-serif text-xl font-semibold text-slate-100">File an Exhibit</h3>

          {!canUpload ? (
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              {c.locked || c.phase === "deliberation" || c.phase === "closed"
                ? "The evidentiary record is permanently closed for this proceeding."
                : "Only the judge and the two parties may tender exhibits."}
            </p>
          ) : (
            <form onSubmit={upload} className="mt-4 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-mono">
                  Exhibit Description
                </label>
                <input
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Contract Exhibit A, CCTV Record"
                  className="field mt-1.5"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-mono">
                  Image or PDF (max 1 MB)
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="field mt-1.5 file:mr-3 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-amber-500/10 file:text-amber-300 cursor-pointer"
                />
              </div>
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-1">
                <Switch checked={restricted} onCheckedChange={setRestricted} />
                <span>Restrict exhibit to Bench & Counsel</span>
              </label>
              <button type="submit" disabled={busy} className="btn-gold w-full mt-2">
                <Upload className="h-4 w-4" />
                {busy ? "Uploading Exhibit…" : "File Exhibit"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Jury({
  c,
  role,
  tally,
  myVote,
  onChange,
}: {
  c: Case;
  role?: string;
  tally: Tally | null;
  myVote: string | null;
  onChange: () => void;
}) {
  async function vote(v: "guilty" | "not_guilty") {
    const { error } = await supabase.rpc("cast_vote", { _case: c.id, _vote: v });
    if (error) toast.error(errMsg(error));
    else { toast.success("Secret ballot cast"); onChange(); }
  }

  async function newRound() {
    const { error } = await supabase.rpc("new_jury_round", { _case: c.id });
    if (error) toast.error(errMsg(error));
    else { toast.success("New deliberation round ordered"); onChange(); }
  }

  const [past, setPast] = useState<{ round: number; guilty: number; not_guilty: number }[]>([]);
  useEffect(() => {
    if (!tally || tally.round <= 1) { setPast([]); return; }
    rpc("jury_rounds", { _case: c.id }).then(({ data }) =>
      setPast(((data ?? []) as { round: number; guilty: number; not_guilty: number }[]).filter((r) => r.round < tally.round))
    );
  }, [c.id, tally?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tally || tally.status === "no_jury") {
    return (
      <div className="text-center py-4">
        <Scale className="mx-auto h-7 w-7 text-amber-400/60 mb-2" />
        <p className="text-sm text-slate-500">No jury empaneled for this proceeding.</p>
      </div>
    );
  }

  const showCounts = c.locked || (role === "judge" && (!!myVote || tally.status !== "pending"));

  return (
    <div>
      <p className="eyebrow mb-3">Jury Deliberation</p>
      <p className="font-mono text-xs text-slate-400 mb-3">
        {tally.round > 1 || tally.status === "deadlock" ? `Round ${tally.round} of ${MAX_JURY_ROUNDS} · ` : ""}{tally.voted}/{tally.jurors} ballots cast
      </p>
      <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-amber-400 transition-all duration-300"
          style={{ width: `${tally.jurors > 0 ? (tally.voted / tally.jurors) * 100 : 0}%` }}
        />
      </div>
      {showCounts && (
        <div className="flex justify-around font-mono text-sm bg-slate-950/70 rounded-lg p-3 mb-3">
          <div><span className="text-slate-500 text-xs">Guilty: </span><strong className="text-red-400">{tally.guilty}</strong></div>
          <div><span className="text-slate-500 text-xs">Not Guilty: </span><strong className="text-emerald-400">{tally.not_guilty}</strong></div>
        </div>
      )}
      {(role === "juror" || role === "judge") && c.phase === "deliberation" && !myVote && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <ConfirmVote label="Guilty" onYes={() => vote("guilty")} isCrimson />
          <ConfirmVote label="Not guilty" onYes={() => vote("not_guilty")} />
        </div>
      )}
      {past.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-800 p-3 font-mono text-xs text-slate-400">
          <p className="mb-1 uppercase tracking-widest text-slate-500">Earlier rounds (kept on record)</p>
          {past.map((r) => <p key={r.round}>Round {r.round}: {r.guilty} guilty, {r.not_guilty} not guilty</p>)}
        </div>
      )}
      {role === "judge" && tally.status === "deadlock" && !c.locked && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-amber-300">The vote is tied. You can enter the final verdict now, or order another round.</p>
          {tally.round < MAX_JURY_ROUNDS && (
            <button type="button" onClick={newRound} className="btn-ghost w-full text-xs">Order another round</button>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmVote({ label, onYes, isCrimson }: { label: string; onYes: () => void; isCrimson?: boolean; }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={isCrimson ? "btn-crimson w-full" : "btn-gold w-full"}>{label}</button>
      </AlertDialogTrigger>
      <AlertDialogContent className="border border-amber-500/20 bg-slate-950 text-slate-100 shadow-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-2xl text-amber-300">Cast vote for "{label}"?</AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400 text-sm">
            Once submitted, your secret ballot cannot be rescinded or altered for this round.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="btn-ghost">Cancel</AlertDialogCancel>
          <AlertDialogAction className={isCrimson ? "btn-crimson" : "btn-gold"} onClick={onYes}>Cast Ballot</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Verdict({
  c,
  isJudge,
  tally,
  cert,
  holder,
  onDone,
}: {
  c: Case;
  isJudge: boolean;
  tally: Tally | null;
  cert: Cert | null;
  holder: string;
  onDone: () => void;
}) {
  const allowed = tally ? allowedOutcomes(tally.status) : [];
  const [outcome, setOutcome] = useState<string>("");
  const [summary, setSummary] = useState("");

  useEffect(() => {
    if (allowed.length === 1 && allowed[0]) setOutcome(allowed[0]);
  }, [allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    const { error } = await supabase.rpc("submit_verdict", {
      _case: c.id,
      _outcome: outcome,
      _summary: summary,
    });
    if (error) toast.error(errMsg(error));
    else { toast.success("Verdict entered and docket permanently sealed"); onDone(); }
  }

  if (c.locked) {
    return (
      <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6">
        <div className="grid h-10 w-10 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10 mb-3">
          <Gavel className="h-5 w-5 text-amber-400" />
        </div>
        <p className="eyebrow">Permanent Verdict</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-slate-100">
          {OUTCOME_LABEL[c.verdict_outcome ?? ""] ?? "Case Concluded"}
        </h2>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500 mb-2">Judicial Findings:</p>
          <p className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
            {c.verdict_summary || "No written findings entered."}
          </p>
        </div>
        <p className="mt-3 font-mono text-xs text-slate-500">
          Docket closed {c.closed_at ? new Date(c.closed_at).toLocaleString() : ""}
        </p>
        {cert && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => downloadCertificate({ id: c.certificate_code ?? cert.id, holder, role: cert.role, caseTitle: c.title, outcome: c.verdict_outcome, issuedAt: cert.issued_at })}
              className="btn-gold"
            >
              <Download className="h-4 w-4" /> Download Certificate (PDF)
            </button>
            <Link to="/verify/$id" params={{ id: c.certificate_code ?? cert.id }} className="btn-ghost">
              <ShieldCheck className="h-4 w-4" /> Verify Seal
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (!isJudge || c.phase !== "deliberation") return null;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6 space-y-5">
      <div>
        <p className="eyebrow">Judicial Decree</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-slate-100">Enter Final Verdict</h2>
      </div>
      {allowed.length === 0 ? (
        <p className="text-sm text-slate-400">Awaiting completion of jury deliberation ballots.</p>
      ) : (
        <>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400 font-mono">Court Outcome</label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="field mt-1.5"><SelectValue placeholder="Choose Outcome" /></SelectTrigger>
              <SelectContent className="border border-slate-800 bg-slate-950 text-slate-100">
                {allowed.map((o) => (
                  <SelectItem key={o} value={o}>{OUTCOME_LABEL[o]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400 font-mono">
              Judicial Reasoning (Min 10 chars)
            </label>
            <textarea
              rows={4}
              maxLength={4000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="State the formal basis of the verdict..."
              className="field mt-1.5 resize-none"
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button type="button" disabled={!outcome || summary.trim().length < 10} className="btn-gold w-full">
                <Gavel className="h-4 w-4" /> Enter Verdict & Seal Case
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border border-amber-500/20 bg-slate-950 text-slate-100 shadow-2xl">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-serif text-2xl text-amber-300">Enter Final Verdict & Seal Case?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400 text-sm">
                  This action permanently concludes the proceeding and cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="btn-ghost">Cancel</AlertDialogCancel>
                <AlertDialogAction className="btn-gold" onClick={submit}>Confirm & Seal</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function SeatTools({ c, role }: { c: Case; role?: string }) {
  type Req = { id: string; role: string; prosecutor_ok: boolean | null; defense_ok: boolean | null; profiles: { display_name: string } | null };
  const [reqs, setReqs] = useState<Req[]>([]);
  const loadReqs = useCallback(async () => {
    const { data } = await table("seat_requests").select("id, role, prosecutor_ok, defense_ok, profiles(display_name)").eq("case_id", c.id).eq("status", "pending");
    setReqs(data ?? []);
  }, [c.id]);
  useEffect(() => {
    loadReqs();
    const ch = supabase.channel(`req-${c.id}-${Math.random().toString(36).slice(2)}`).on("postgres_changes", { event: "*", schema: "public", table: "seat_requests", filter: `case_id=eq.${c.id}` }, loadReqs).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [c.id, loadReqs]);
  async function decide(id: string, ok: boolean) {
    const { error } = await rpc("decide_request", { _request: id, _approve: ok });
    if (error) return toast.error(errMsg(error));
    toast.success(ok ? "Approved" : "Declined");
    loadReqs();
  }
  async function setRange(v: string) {
    const [min, max] = v.split("-").map(Number);
    const { error } = await rpc("set_jury_size", { _case: c.id, _min: min, _max: max });
    if (error) toast.error(errMsg(error)); else toast.success("Jury size updated");
  }
  const mine = reqs.filter((q) => (q.role === "juror" ? role === "judge" : role === "prosecutor" || role === "defense"));
  const card = "mb-5 rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6";
  const label = "mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80";
  return (
    <>
      {role === "judge" && c.phase === "pre_trial" && (
        <div className={card}>
          <p className={label}>JURY SIZE</p>
          <p className="mb-3 text-xs text-slate-500">The jury is optional. The case can go ahead with any number of jurors from none up to the maximum.</p>
          <Select value={`${c.jury_min ?? 0}-${c.jury_size ?? 0}`} onValueChange={setRange}>
            <SelectTrigger className="h-10 w-full border border-slate-700 bg-slate-950/80 text-sm text-slate-100"><SelectValue /></SelectTrigger>
            <SelectContent className="border border-slate-800 bg-[#090e1a] text-slate-100">
              <SelectItem value="0-0">Not required</SelectItem>
              <SelectItem value="1-3">1 – 3 jurors</SelectItem>
              <SelectItem value="3-5">3 – 5 jurors</SelectItem>
              <SelectItem value="5-7">5 – 7 jurors</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {mine.length > 0 && (
        <div className={card}>
          <p className={label}>SEAT REQUESTS</p>
          <ul className="divide-y divide-slate-800/60">
            {mine.map((q) => (
              <li key={q.id} className="space-y-2 py-3 text-sm text-slate-200">
                <p>{q.profiles?.display_name} wants to be {q.role === "judge" ? "the judge" : "a juror"}{q.role === "judge" ? ` (prosecutor ${q.prosecutor_ok ? "approved" : "pending"}, defense ${q.defense_ok ? "approved" : "pending"})` : ""}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => decide(q.id, true)} className="btn-gold py-1.5 px-4 text-xs">Approve</button>
                  <button type="button" onClick={() => decide(q.id, false)} className="btn-ghost py-1.5 px-4 text-xs">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function VoteVerdictTab({
  c, myRole, isJudge, tally, myVote, onJuryChange, cert, holder, evidence, onChanged, onVerdictDone,
}: {
  c: Case; myRole?: string; isJudge: boolean; tally: Tally | null; myVote: string | null; onJuryChange: () => void | Promise<void>;
  cert: Cert | null; holder: string; evidence: Evidence[]; onChanged: () => void; onVerdictDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const card = "rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6";
  const label = "mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80";
  const approved = evidence.filter((e) => e.approval === "approved").length;
  const rejected = evidence.filter((e) => e.approval === "rejected").length;
  const pending = evidence.filter((e) => e.approval === "pending").length;
  const round = c.hearing_round ?? 1;
  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true);
    const { error } = await rpc(fn, { _case: c.id, ...args });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    toast.success(ok);
    onChanged();
  }
  const stageText =
    c.locked ? "The case is closed and locked."
    : c.phase === "pre_trial" ? "Filing: voting and the verdict open after the hearing and the judge's review of the evidence."
    : c.phase === "hearing" ? `Hearing ${round}: ${c.stage === "evidence" ? "evidence stage" : c.stage === "closing" ? "closing stage" : "opening stage"}.`
    : "Jury deliberation.";
  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <div className={card}>
        <p className={label}>WHERE THE CASE STANDS</p>
        <p className="text-sm text-slate-200">{stageText}</p>
      </div>

      {c.phase === "hearing" && c.stage === "evidence" && (
        <div className={card}>
          <p className={label}>EVIDENCE REVIEW</p>
          <p className="mb-3 text-xs text-slate-400">{approved} approved, {rejected} rejected, {pending} waiting for the judge.</p>
          {isJudge ? (
            !c.evidence_seen ? (
              <>
                <p className="mb-3 text-sm text-slate-200">Have you seen all the evidence?</p>
                <button type="button" disabled={busy || pending > 0} onClick={() => call("confirm_evidence_seen", {}, "Recorded: evidence reviewed")} className="btn-gold text-xs py-2 px-5">
                  Yes, I have seen the evidence
                </button>
                {pending > 0 && <p className="mt-2 text-xs text-amber-300">Approve or reject the {pending} pending exhibit{pending === 1 ? "" : "s"} in the Evidence tab first.</p>}
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-slate-200">Is a further hearing required?</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => call("decide_further_hearing", { _further: true }, `Hearing ${round + 1} begins`)} className="btn-gold text-xs py-2 px-5">
                    Yes, hold hearing {round + 1}
                  </button>
                  <button type="button" disabled={busy} onClick={() => call("decide_further_hearing", { _further: false }, "Moving to closing")} className="btn-ghost text-xs py-2 px-5">
                    No, move to closing
                  </button>
                </div>
              </>
            )
          ) : (
            <p className="text-sm text-slate-300">{c.evidence_seen ? "The judge has reviewed the evidence and is deciding whether another hearing is needed." : "The judge is reviewing the evidence."}</p>
          )}
        </div>
      )}

      {c.phase === "hearing" && c.stage !== "evidence" && isJudge && (
        <div className={card}>
          <p className={label}>NEXT STEP</p>
          <p className="text-sm text-slate-300">{c.stage === "opening" ? "When the opening statements are done, use \"Close opening, move to evidence\" at the top of the page." : "When the closing statements are done, use \"Adjourn to deliberation\" at the top of the page."}</p>
        </div>
      )}

      {(c.phase === "deliberation" || c.locked) && (
        <div className={card}>
          <Jury c={c} role={myRole} tally={tally} myVote={myVote} onChange={onJuryChange} />
        </div>
      )}
      {(c.phase === "deliberation" || c.locked) && (isJudge || c.locked) && (
        <Verdict c={c} isJudge={isJudge} tally={tally} cert={cert} holder={holder} onDone={onVerdictDone} />
      )}
    </div>
  );
}

function TabDot({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={80}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="img" aria-label={text} className="ml-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 ring-2 ring-red-500/30" />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="whitespace-nowrap border-slate-700 bg-slate-950 text-xs text-slate-100">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
