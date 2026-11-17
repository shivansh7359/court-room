import { createFileRoute, Link } from "@tanstack/react-router";
import { Gavel, FileLock2, Users, Vote, ScrollText, QrCode, Scale, ArrowRight, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JusticeRoom | The virtual courtroom" },
      { name: "description", content: "File a case, invite counsel, witnesses and jurors, hold a live hearing, vote, and issue verifiable certificates." },
      { property: "og:title", content: "JusticeRoom | The virtual courtroom" },
      { property: "og:description", content: "A virtual courtroom for moot courts, classrooms and debate clubs." },
    ],
  }),
  component: Index,
});

const FEATURES = [
  { icon: Users, t: "Seats with Real Rules", d: "One judge, one prosecutor, one defense counsel. Witnesses, up to 12 jurors and courtroom observers." },
  { icon: FileLock2, t: "Secure Evidence Locker", d: "Private case exhibit storage. Restrict sensitive exhibits to the bench and designated counsel." },
  { icon: Gavel, t: "Live Hearing Record", d: "Formal statements, objections, and bench rulings broadcast to all active participants in real-time." },
  { icon: Vote, t: "Secret Jury Deliberation", d: "Private ballots, majority decision metrics, deadlocks trigger new rounds or formal mistrials." },
  { icon: ScrollText, t: "Permanent Verdicts", d: "Once the presiding judge enters the final verdict, the docket and findings are locked permanently." },
  { icon: QrCode, t: "Verifiable Certificates", d: "Every participant earns an official PDF credential sealed with a cryptographically verifiable QR link." },
];

function Index() {
  return (
    <main className="relative overflow-hidden">
      {/* Hero Section */}
      <section className="relative px-4 py-24 sm:px-8 sm:py-32 lg:py-40 border-b border-amber-500/10">
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />

        <div className="mx-auto max-w-6xl relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-mono uppercase tracking-widest text-amber-300 mb-6">
            <Scale className="h-3.5 w-3.5 text-amber-400" />
            The Virtual Courtroom
          </div>

          <h1 className="max-w-4xl font-serif text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-slate-100 leading-[1.1]">
            Order in the court — wherever your court happens to be.
          </h1>

          <p className="mt-6 max-w-2xl text-lg sm:text-xl text-slate-400 leading-relaxed font-sans">
            JusticeRoom runs structured mock trials for moot courts, classrooms, and legal societies — from formal indictment and witness testimony to secret jury ballots and sealed verdicts.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link to="/dashboard" className="btn-gold text-base py-3 px-6">
              Open Your Docket <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/auth" className="btn-ghost text-base py-3 px-6">
              Create Counsel Account
            </Link>
            <Link to="/verify" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-amber-300 px-3 py-2 transition-colors">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Verify a Certificate
            </Link>
          </div>
        </div>
      </section>

      {/* Feature Section */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
        <div className="flex flex-col items-start gap-2">
          <p className="eyebrow">Procedural Framework</p>
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-slate-100">
            From filing to final sealed verdict
          </h2>
          <p className="text-sm text-slate-400 max-w-lg mt-1">
            Built to respect judicial procedure, roles, evidentiary standards, and secret deliberation.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.t}
              className="panel p-7 transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-amber-500/40"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-semibold text-slate-100">{f.t}</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/60 py-8 text-center text-xs font-mono uppercase tracking-widest text-slate-500">
        JusticeRoom · Built for educational mock trials, moot court advocacy, and academic legal simulations.
      </footer>
    </main>
  );
}
