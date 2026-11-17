import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  LogIn,
  Gavel,
  Lock,
  Scale,
  ChevronRight,
  MailOpen,
  Hash,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rpc } from "@/lib/rpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PHASE_LABEL, ROLE_LABEL, OUTCOME_LABEL, errMsg } from "@/lib/jury";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your Docket | JusticeRoom" },
      { name: "description", content: "Your courtroom cases and pending docket." },
      { property: "og:title", content: "Your Docket | JusticeRoom" },
      { property: "og:description", content: "Your courtroom cases and pending docket." },
    ],
  }),
  component: Dashboard,
});

type Row = {
  role: string;
  cases: {
    id: string;
    title: string;
    phase: string;
    created_at: string;
    locked: boolean;
    verdict_outcome?: string | null; closed_at?: string | null;
  } | null;
};

const ROLE_BADGE_STYLE: Record<string, string> = {
  prosecutor: "border-red-400/50 bg-red-500/10 text-red-300",
  defense: "border-sky-400/50 bg-sky-500/10 text-sky-300",
  judge: "border-amber-400/50 bg-amber-500/10 text-amber-300",
  juror: "border-emerald-400/50 bg-emerald-500/10 text-emerald-300",
  witness: "border-orange-400/50 bg-orange-500/10 text-orange-300",
  observer: "border-slate-600 bg-slate-800 text-slate-300",
};

function formatCaseNumber(id: string, createdAt: string) {
  const year = new Date(createdAt).getFullYear() || 2026;
  const cleanId = id.replace(/-/g, "").toUpperCase();
  const suffix = cleanId.slice(-6);
  return `JR-${year}-${suffix}`;
}

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openJoin, setOpenJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jc, setJc] = useState({ code: "", role: "juror" });

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("case_members")
      .select("role, cases(id,title,phase,created_at,locked,verdict_outcome,closed_at)")
      .eq("user_id", user.id);
    if (error) toast.error(error.message);
    setRows(
      ((data as Row[]) ?? [])
        .filter((r) => r.cases)
        .sort((a, b) => b.cases!.created_at.localeCompare(a.cases!.created_at))
    );
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("join_case", {
      _code: jc.code,
      _role: jc.role as "juror",
    });
    setBusy(false);
    if (error) return toast.error(errMsg(error));
    setOpenJoin(false);
    if (!data) {
      toast.success("Request sent. The judge must approve your jury seat. You will be notified.");
      return;
    }
    toast.success("Joined case");
    navigate({ to: "/cases/$id", params: { id: data as string } });
  }

  const userDisplayName =
    (user?.user_metadata?.display_name as string) ||
    user?.email?.split("@")[0] ||
    "Counsel";

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-8 sm:py-14">
      <div data-testid="dashboard-page">
        {/* Top Header Row */}
        <div className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Your docket</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold tracking-tight sm:text-5xl text-slate-100">
              Good day, <span>{userDisplayName}</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Join with code button */}
            <Dialog open={openJoin} onOpenChange={setOpenJoin}>
              <DialogTrigger asChild>
                <button type="button" className="btn-ghost">
                  <LogIn className="h-4 w-4" /> Join with code
                </button>
              </DialogTrigger>
              <DialogContent className="border border-amber-500/20 bg-slate-950 text-slate-100 shadow-2xl sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="font-serif text-2xl text-amber-300">
                    Join a case
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={join} className="space-y-4 pt-2">
                  <div>
                    <Label htmlFor="code" className="text-xs uppercase tracking-wider text-slate-400 font-mono">
                      Invite code
                    </Label>
                    <input
                      id="code"
                      required
                      maxLength={8}
                      value={jc.code}
                      onChange={(e) => setJc({ ...jc, code: e.target.value.toUpperCase() })}
                      placeholder="e.g. 4F9A2C1B"
                      className="field mt-1.5 font-mono uppercase tracking-widest text-base"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-slate-400 font-mono">
                      Your courtroom role
                    </Label>
                    <Select value={jc.role} onValueChange={(v) => setJc({ ...jc, role: v })}>
                      <SelectTrigger className="field mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border border-slate-800 bg-slate-950 text-slate-100">
                        {["judge", "defense", "juror"].map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button type="submit" className="btn-gold w-full mt-4" disabled={busy}>
                    {busy ? "Joining…" : "Join case"}
                  </button>
                </form>
              </DialogContent>
            </Dialog>

            {/* File a new case link */}
            <Link
              to="/cases/new"
              data-testid="create-case-button"
              className="btn-gold"
            >
              <Plus className="h-4 w-4" /> File a new case
            </Link>
          </div>
        </div>

        {/* Main Grid: Cases (8 cols) and Invitations/Actions (4 cols) */}
        <div className="grid gap-8 lg:grid-cols-12">
          {/* Cases Column */}
          <section className="space-y-4 lg:col-span-8">
            <p className="eyebrow">
              Cases{" "}
              <span data-testid="cases-count">
                ({rows ? rows.length : 0})
              </span>
            </p>

            {rows === null ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="panel h-28 animate-pulse p-6 bg-slate-900/40" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="panel border-dashed border-amber-500/20 p-12 text-center">
                <Gavel className="mx-auto h-8 w-8 text-amber-400/80" />
                <h3 className="mt-4 font-serif text-2xl text-slate-100">No cases on your docket</h3>
                <p className="mt-2 text-sm text-slate-400 max-w-sm mx-auto">
                  File a new mock trial case as the presiding judge, or join an active proceeding with an invite code.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link
                    to="/cases/new"
                    className="btn-gold text-xs py-2 px-4"
                  >
                    <Plus className="h-3.5 w-3.5" /> File a new case
                  </Link>
                  <button
                    type="button"
                    onClick={() => setOpenJoin(true)}
                    className="btn-ghost text-xs py-2 px-4"
                  >
                    <LogIn className="h-3.5 w-3.5" /> Join with code
                  </button>
                </div>
              </div>
            ) : (
              rows.map((r) => {
                const item = r.cases!;
                const caseNum = formatCaseNumber(item.id, item.created_at);
                const roleBadgeClass =
                  ROLE_BADGE_STYLE[r.role] ||
                  "border-slate-600 bg-slate-800 text-slate-300";

                return (
                  <Link
                    key={item.id}
                    data-testid={`case-card-${item.id}`}
                    to="/cases/$id"
                    params={{ id: item.id }}
                    className="panel group flex items-center justify-between gap-4 p-6 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-amber-500/50"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-xs text-slate-500">
                          {caseNum}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${roleBadgeClass}`}
                        >
                          {r.role}
                        </span>
                      </div>

                      <h3 className="mt-3 truncate font-serif text-2xl text-slate-100">
                        {item.title}
                      </h3>

                      <p className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                        {item.locked ? (
                          <>
                            <Lock className="h-3.5 w-3.5 text-emerald-400" />
                            Locked: {lockedLabel(r.role, item.verdict_outcome)}
                          </>
                        ) : (
                          <>
                            <Scale className="h-3.5 w-3.5 text-amber-400" />
                            {PHASE_LABEL[item.phase]}
                          </>
                        )}
                      </p>
              {item.locked && item.closed_at && Date.now() < new Date(item.closed_at).getTime() + 3 * 864e5 && (
                <p className="mt-1.5 text-xs text-amber-300/90">Download the evidence. It will be deleted in the next 3 days.</p>
              )}
                    </div>

                    <ChevronRight className="h-5 w-5 shrink-0 text-slate-600 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-amber-400" />
                  </Link>
                );
              })
            )}
          </section>

          {/* Right Column: Invitations & Info */}
          <div className="lg:col-span-4 space-y-6">
            <InvitationsPanel />
            <PublicCases />

            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
              <MailOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span>
                Invitations are matched to your account email:{" "}
                <span className="text-slate-400 font-medium">{user.email}</span>
              </span>
            </p>

            {/* Quick Join docket panel */}
            <div className="panel p-6">
              <p className="eyebrow flex items-center gap-1.5">
                <Hash className="h-3 w-3 text-amber-400" /> Quick Access
              </p>
              <h4 className="mt-2 font-serif text-lg text-slate-200">Have a case code?</h4>
              <p className="mt-1 text-xs text-slate-400">
                Enter an 8-character code from counsel or the court clerk to participate immediately.
              </p>
              <button
                type="button"
                onClick={() => setOpenJoin(true)}
                className="btn-ghost w-full mt-4 text-xs py-2"
              >
                <LogIn className="h-3.5 w-3.5" /> Enter Invite Code
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

type Invite = { id: string; case_id: string; case_title: string; case_type: string; role: string; invited_by_name: string };
function InvitationsPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Invite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await rpc("my_invitations");
    setItems(data ?? []);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel(`inv-${Math.random().toString(36).slice(2)}`).on("postgres_changes", { event: "*", schema: "public", table: "invitations" }, load).subscribe();
    const t = setInterval(load, 20000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [load]);
  async function respond(i: Invite, accept: boolean) {
    setBusyId(i.id);
    const { data, error } = await rpc("respond_invitation", { _id: i.id, _accept: accept });
    setBusyId(null);
    if (error) { toast.error(errMsg(error)); return load(); }
    if (accept) {
      toast.success(`You joined as ${ROLE_LABEL[i.role] ?? i.role}`);
      navigate({ to: "/cases/$id", params: { id: data as string } });
    } else {
      toast.success("Invitation declined");
      load();
    }
  }
  return (
    <aside data-testid="invitations-panel" className="panel h-fit p-6">
      <p className="eyebrow">
        Invitations <span data-testid="invitations-count">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p data-testid="invitations-empty" className="mt-5 text-sm leading-relaxed text-slate-500">
          No pending invitations. When someone invites your email address to a case, it appears here.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {items.map((i) => (
            <li key={i.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="font-serif text-base text-slate-100">{i.case_title}</p>
              <p className="mt-1 text-xs text-slate-400">
                {i.invited_by_name} invited you as <span className="font-semibold text-amber-300">{ROLE_LABEL[i.role] ?? i.role}</span>
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busyId === i.id} onClick={() => respond(i, true)} className="btn-gold text-xs py-1.5 px-4">Accept</button>
                <button type="button" disabled={busyId === i.id} onClick={() => respond(i, false)} className="btn-ghost text-xs py-1.5 px-4">Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

type PublicRow = { id: string; title: string; case_type: string; jury_size: number | null; has_judge: boolean; jurors: number };
function PublicCases() {
  const [rows, setRows] = useState<PublicRow[] | null>(null);
  useEffect(() => { rpc("list_public_cases").then(({ data }) => setRows(data ?? [])); }, []);
  async function ask(id: string, role: "judge" | "juror") {
    const { error } = await rpc("request_seat", { _case: id, _role: role });
    if (error) return toast.error(errMsg(error));
    toast.success("Request sent. You will be notified when it is decided.");
  }
  if (!rows || rows.length === 0) return null;
  return (
    <div className="panel p-6">
      <p className="eyebrow">Public cases</p>
      <p className="mt-2 text-xs text-slate-500">Ask to serve. A juror needs the judge's approval. A judge needs both parties' approval.</p>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            <p className="font-serif text-base text-slate-100">{r.title}</p>
            <p className="mt-1 text-xs capitalize text-slate-400">{r.case_type} · {r.has_judge ? "judge seated" : "needs a judge"} · {r.jury_size ? `${r.jurors}/${r.jury_size} jurors` : "no jury"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!r.has_judge && <button type="button" onClick={() => ask(r.id, "judge")} className="btn-ghost text-xs py-1.5 px-4">Request judge</button>}
              {r.jury_size && r.jurors < r.jury_size ? <button type="button" onClick={() => ask(r.id, "juror")} className="btn-ghost text-xs py-1.5 px-4">Request jury seat</button> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function lockedLabel(role: string, outcome?: string | null) {
  if (outcome === "mistrial") return "Mistrial";
  if (role === "judge") return outcome === "guilty" ? "Guilty · Prosecutor won" : outcome === "not_guilty" ? "Not guilty · Defense won" : "Concluded";
  if (role === "prosecutor") return outcome === "guilty" ? "Won" : outcome === "not_guilty" ? "Lost" : "Concluded";
  if (role === "defense") return outcome === "not_guilty" ? "Won" : outcome === "guilty" ? "Lost" : "Concluded";
  return OUTCOME_LABEL[outcome ?? ""] ?? "Concluded";
}
