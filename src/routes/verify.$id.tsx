import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BadgeCheck, XCircle, ArrowLeft } from "lucide-react";
import { rpc } from "@/lib/rpc";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, OUTCOME_LABEL } from "@/lib/jury";

export const Route = createFileRoute("/verify/$id")({
  head: () => ({
    meta: [
      { title: "Case Record Verification | JusticeRoom" },
      { name: "description", content: "Verify an official JusticeRoom case record." },
    ],
  }),
  component: Verify,
});

type Record_ = {
  certificate_code: string; title: string; case_type: string; outcome: string | null; summary: string | null; closed_at: string | null;
  hearings: number; prosecutor: string | null; defense: string | null; hidden_evidence: number;
  participants: { name: string; email: string; role: string }[];
  evidence: { title: string; file_name: string; filed_by: string; filed_at: string; path: string; expired: boolean }[];
  votes: { guilty: number; not_guilty: number };
};

function Verify() {
  const { id } = Route.useParams();
  const [state, setState] = useState<"loading" | "invalid" | Record_>("loading");

  async function openFile(path: string) {
    const { data } = await supabase.storage.from("evidence").createSignedUrl(path, 120);
    if (data) window.open(data.signedUrl, "_blank");
  }

  useEffect(() => {
    if (!/^JR-[0-9A-F]{10}$/i.test(id)) { setState("invalid"); return; }
    rpc("verify_record", { _code: id }).then(({ data }) => setState(data ? (data as Record_) : "invalid"));
  }, [id]);

  const card = "rounded-xl border border-slate-800/80 bg-[#080d1a]/60 p-6";
  const label = "mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-500/80";

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <div className="mb-6">
        <Link to="/verify" className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-slate-400 hover:text-amber-300 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Look up another code
        </Link>
      </div>

      {state === "loading" ? (
        <div className="panel space-y-4 p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
          <p className="font-mono text-xs uppercase tracking-widest text-slate-400">Querying court registry…</p>
        </div>
      ) : state === "invalid" ? (
        <div className="panel p-10 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-red-500/40 bg-red-500/10"><XCircle className="h-7 w-7 text-red-400" /></div>
          <p className="eyebrow mt-4 text-red-300">Unverified Record</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-slate-100">Record Not Found</h1>
          <p className="mt-3 text-sm text-slate-400">This code does not match any closed JusticeRoom case.</p>
          <div className="mt-6 break-all rounded-md border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs text-slate-500">{id}</div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="panel p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-500/40 bg-emerald-500/10"><BadgeCheck className="h-8 w-8 text-emerald-400" /></div>
            <p className="eyebrow mt-4 text-emerald-300">Authentic Record</p>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-slate-100">{state.title}</h1>
            <p className="mt-1 font-mono text-xs capitalize text-slate-400">{state.case_type} case · {state.hearings} hearing{state.hearings === 1 ? "" : "s"} · closed {state.closed_at ? new Date(state.closed_at).toLocaleDateString() : ""}</p>
            <p className="mt-5 font-serif text-xl text-amber-200">
              {state.outcome === "guilty" ? `${state.prosecutor} (Prosecutor) won against ${state.defense} (Defense)`
                : state.outcome === "not_guilty" ? `${state.defense} (Defense) won against ${state.prosecutor} (Prosecutor)`
                : "Mistrial: no winner"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-300">Final verdict: {OUTCOME_LABEL[state.outcome ?? ""] ?? "Concluded"}</p>
            {state.summary && <p className="mx-auto mt-3 max-w-xl whitespace-pre-wrap text-sm text-slate-400">{state.summary}</p>}
          </div>

          <div className={card}>
            <p className={label}>PEOPLE IN THIS CASE</p>
            <ul className="divide-y divide-slate-800/60">
              {state.participants.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span><span className="font-medium text-slate-100">{p.name}</span> <span className="text-slate-400">· {p.email}</span></span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300">{ROLE_LABEL[p.role] ?? p.role}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className={card}>
            <p className={label}>APPROVED EVIDENCE ({state.evidence.length})</p>
            {state.evidence.length === 0 ? <p className="text-sm text-slate-500">No approved evidence was filed.</p> : (
              <ul className="divide-y divide-slate-800/60">
                {state.evidence.map((e, i) => (
                  <li key={i} className="py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-100">{e.title}</p>
                        <p className="text-xs text-slate-500">{e.file_name} · filed by {e.filed_by} · {new Date(e.filed_at).toLocaleDateString()}</p>
                      </div>
                      {e.expired ? (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Expired</span>
                      ) : (
                        <button type="button" onClick={() => openFile(e.path)} className="btn-ghost shrink-0 py-1.5 px-4 text-xs">Open</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {state.hidden_evidence > 0 && <p className="mt-2 text-xs text-slate-500">{state.hidden_evidence} restricted exhibit{state.hidden_evidence === 1 ? "" : "s"} not shown.</p>}
          </div>

          <div className={card}>
            <p className={label}>JURY VOTE</p>
            {state.votes.guilty + state.votes.not_guilty === 0 ? <p className="text-sm text-slate-500">No jury took part. The judge decided the case.</p> : (
              <p className="font-mono text-lg text-slate-100">
                <span className="text-red-300">{state.votes.guilty} guilty</span> : <span className="text-emerald-300">{state.votes.not_guilty} not guilty</span>
                <span className="ml-2 text-xs text-slate-500">({state.votes.guilty + state.votes.not_guilty} jurors voted)</span>
              </p>
            )}
          </div>

          <p className="text-center font-mono text-[11px] text-slate-500">Certificate code {state.certificate_code}</p>
        </div>
      )}
    </main>
  );
}
