import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Search, QrCode } from "lucide-react";

export const Route = createFileRoute("/verify/")({
  head: () => ({
    meta: [
      { title: "Verify Certificate | JusticeRoom" },
      { name: "description", content: "Verify official JusticeRoom courtroom participation certificates." },
    ],
  }),
  component: VerifyIndex,
});

function VerifyIndex() {
  const [certId, setCertId] = useState("");
  const navigate = useNavigate();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const clean = certId.trim();
    if (clean) {
      navigate({ to: "/verify/$id", params: { id: clean } });
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:py-24">
      <div className="panel p-8 sm:p-10 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10">
          <ShieldCheck className="h-6 w-6 text-amber-400" />
        </div>

        <p className="eyebrow mt-4">Verification Registry</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-slate-100">
          Verify Courtroom Certificate
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter the unique certificate code (like JR-4F9A2C1B07) printed on the winning party's JusticeRoom certificate.
        </p>

        <form onSubmit={handleSearch} className="mt-8 space-y-4">
          <div className="relative">
            <input
              type="text"
              required
              value={certId}
              onChange={(e) => setCertId(e.target.value)}
              placeholder="e.g. 6af86fd3-d30f-3740-85f4-2932..."
              className="field font-mono text-xs pr-10"
            />
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          </div>

          <button type="submit" className="btn-gold w-full">
            Verify Certificate Record
          </button>
        </form>

        <div className="mt-8 border-t border-slate-800/80 pt-6 text-xs text-slate-500 flex items-center justify-center gap-2">
          <QrCode className="h-4 w-4 text-amber-500/60" />
          <span>Certificates can also be verified directly by scanning the QR code on the PDF.</span>
        </div>
      </div>
    </main>
  );
}
