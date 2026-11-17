import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errMsg } from "@/lib/jury";
import { rpc } from "@/lib/rpc";

export const Route = createFileRoute("/_authenticated/cases/new")({
  head: () => ({
    meta: [
      { title: "File a Case | JusticeRoom" },
      { name: "description", content: "File a new mock trial case docket." },
    ],
  }),
  component: NewCasePage,
});

const CATEGORIES = ["Criminal", "Civil", "Academic", "Workplace", "Other"];

function NewCasePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Criminal");
  const [statement, setStatement] = useState("");
  const [isPublic, setIsPublic] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 3) {
      return toast.error("Case title must be at least 3 characters");
    }

    setBusy(true);

    try {
      const { data, error } = await rpc("create_case", {
        _title: title.trim(),
        _description: statement.trim(),
        _type: category.toLowerCase(),
        _public: isPublic,
      });
      if (error) {
        setBusy(false);
        return toast.error(errMsg(error));
      }
      const caseId = data as string;

      toast.success("Case successfully filed on the docket");
      navigate({ to: "/cases/$id", params: { id: caseId } });
    } catch (err: any) {
      toast.error(err?.message || "Failed to file case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Back link */}
      <div className="mb-6">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-amber-300 transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to docket</span>
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-500">
          NEW FILING
        </p>
        <h1 className="mt-2 font-serif text-3xl sm:text-4xl font-normal text-slate-100">
          File a case
        </h1>
      </div>

      {/* Form Card */}
      <form
        onSubmit={create}
        className="rounded-xl border border-slate-800/80 bg-[#0a0f1d]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-sm space-y-6"
      >
        {/* Case Title */}
        <div>
          <Label
            htmlFor="case-title"
            className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-500/90 mb-2"
          >
            CASE TITLE
          </Label>
          <input
            id="case-title"
            required
            minLength={3}
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="The People v. Jordan Vale"
            className="w-full rounded-md border border-slate-800 bg-[#060a14] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40 transition-colors"
          />
        </div>

        {/* Category */}
        <div>
          <Label
            htmlFor="case-category"
            className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-500/90 mb-2"
          >
            CATEGORY
          </Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger
              id="case-category"
              className="w-full rounded-md border border-slate-800 bg-[#060a14] px-3.5 py-2.5 text-sm text-slate-100 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40 h-10"
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent className="border border-slate-800 bg-[#090e1a] text-slate-100 shadow-xl">
              {CATEGORIES.map((cat) => (
                <SelectItem
                  key={cat}
                  value={cat}
                  className="focus:bg-amber-500/15 focus:text-amber-200 cursor-pointer text-sm"
                >
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Statement of the Matter */}
        <div>
          <Label
            htmlFor="case-statement"
            className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-500/90 mb-2"
          >
            STATEMENT OF THE MATTER
          </Label>
          <textarea
            id="case-statement"
            rows={5}
            maxLength={4000}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="What is alleged, and what is the court asked to decide?"
            className="w-full rounded-md border border-slate-800 bg-[#060a14] p-3.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-y transition-colors"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-300">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="mt-1" />
          <span>Make this case public. Anyone may then ask to serve as the judge or a juror.</span>
        </label>
        <p className="text-xs leading-relaxed text-slate-500">
          You open the case as the prosecutor. Afterwards you appoint the judge (by email or with a judge code) and the defense is invited. The judge decides whether the case has a jury of 3, 5, 7 or 9.
        </p>

        {/* Submit button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full bg-amber-500 px-7 py-2.5 text-sm font-medium text-slate-950 transition-all duration-150 hover:bg-amber-400 active:scale-95 disabled:opacity-50 disabled:pointer-events-none shadow-md shadow-amber-500/20"
          >
            {busy ? "Filing case…" : "File case"}
          </button>
        </div>
      </form>
    </main>
  );
}
