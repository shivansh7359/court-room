import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Scale, Mail, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Enter Courtroom | JusticeRoom" },
      { name: "description", content: "Sign in or create your JusticeRoom courtroom account." },
      { property: "og:title", content: "Enter Courtroom | JusticeRoom" },
      { property: "og:description", content: "Access your courtroom cases and dockets." },
    ],
  }),
  component: AuthPage,
});

function safePath(p?: string) {
  if (!p) return "/dashboard";
  try {
    const u = new URL(p, window.location.origin);
    return u.origin === window.location.origin ? u.pathname + u.search : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [rateLimitError, setRateLimitError] = useState(false);
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [f, setF] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: safePath(redirect), replace: true });
    });
  }, [navigate, redirect]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: f.email,
      password: f.password,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    navigate({ to: safePath(redirect), replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return toast.error("Please enter your name");
    if (f.password.length < 8) return toast.error("Password must be at least 8 characters");
    setBusy(true);
    setRateLimitError(false);
    const { data, error } = await supabase.auth.signUp({
      email: f.email,
      password: f.password,
      options: {
        emailRedirectTo: window.location.origin + "/dashboard",
        data: { display_name: f.name.trim() },
      },
    });
    setBusy(false);
    if (error) {
      if (
        error.message.toLowerCase().includes("rate limit") ||
        error.message.toLowerCase().includes("over_email_send_rate_limit")
      ) {
        setRateLimitError(true);
        return toast.error(
          "Supabase email rate limit exceeded. Disable 'Confirm email' in Supabase to bypass this.",
        );
      }
      return toast.error(error.message);
    }
    if (data.session) navigate({ to: "/dashboard", replace: true });
    else setSent(true);
  }

  async function google() {
    // const r = await lovable.auth.signInWithOAuth("google", {
    //   redirect_uri: window.location.origin + "/auth",
    // });
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/auth",
      },
    });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="panel p-8 sm:p-10 shadow-2xl">
        <div className="text-center mb-6">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10 mb-3">
            <Scale className="h-6 w-6 text-amber-400" />
          </div>
          <p className="eyebrow">Court Entry</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-100">
            Enter the Courtroom
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Access your proceedings, trial transcripts, and dockets.
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center space-y-3">
            <Mail className="mx-auto h-8 w-8 text-amber-400" />
            <h3 className="font-serif text-xl text-slate-100">Check Your Email</h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              We've dispatched a confirmation link to verify your courtroom credentials. Confirm
              your email, then return here to proceed.
            </p>
            <button onClick={() => setSent(false)} className="btn-ghost text-xs mt-2">
              Back to sign in
            </button>
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as "signin" | "signup");
              setRateLimitError(false);
            }}
          >
            <TabsList className="grid w-full grid-cols-2 bg-slate-950/80 border border-slate-800 p-1 rounded-full mb-4">
              <TabsTrigger
                value="signin"
                className="rounded-full py-1.5 text-xs font-semibold data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950 transition-colors"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="rounded-full py-1.5 text-xs font-semibold data-[state=active]:bg-amber-500 data-[state=active]:text-slate-950 transition-colors"
              >
                Create Account
              </TabsTrigger>
            </TabsList>

            {rateLimitError && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-xs text-red-200 space-y-2 mb-4">
                <div className="font-semibold text-red-300 flex items-center gap-1.5 font-mono uppercase tracking-wide">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                  Email Rate Limit Exceeded
                </div>
                <p className="leading-relaxed text-slate-300">
                  Supabase's built-in email service caps signup verification emails at 3–4 per hour
                  on free tiers.
                </p>
                <div className="rounded bg-slate-950/70 p-2.5 font-mono text-[11px] text-amber-300/90 space-y-1">
                  <p>
                    <strong>Fix:</strong> In Supabase Dashboard &rarr; <em>Authentication</em>{" "}
                    &rarr; <em>Providers</em> &rarr; <em>Email</em>, turn{" "}
                    <strong>"Confirm email" OFF</strong>.
                  </p>
                </div>
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTab("signin");
                      setRateLimitError(false);
                    }}
                    className="btn-gold text-[11px] py-1 px-3"
                  >
                    Try Signing In (If account exists)
                  </button>
                </div>
              </div>
            )}

            <TabsContent value="signin">
              <form onSubmit={signIn} className="space-y-4 pt-4">
                <div>
                  <Label
                    htmlFor="e1"
                    className="text-xs uppercase tracking-wider text-slate-400 font-mono"
                  >
                    Official Email
                  </Label>
                  <input
                    id="e1"
                    type="email"
                    required
                    value={f.email}
                    onChange={(e) => setF({ ...f, email: e.target.value })}
                    placeholder="counsel@chamber.com"
                    className="field mt-1.5"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="p1"
                    className="text-xs uppercase tracking-wider text-slate-400 font-mono"
                  >
                    Password
                  </Label>
                  <input
                    id="p1"
                    type="password"
                    required
                    value={f.password}
                    onChange={(e) => setF({ ...f, password: e.target.value })}
                    placeholder="••••••••"
                    className="field mt-1.5"
                  />
                </div>
                <button type="submit" className="btn-gold w-full mt-2" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in to Docket"}
                </button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={signUp} className="space-y-4 pt-4">
                <div>
                  <Label
                    htmlFor="n2"
                    className="text-xs uppercase tracking-wider text-slate-400 font-mono"
                  >
                    Full Legal Name
                  </Label>
                  <input
                    id="n2"
                    required
                    maxLength={80}
                    value={f.name}
                    onChange={(e) => setF({ ...f, name: e.target.value })}
                    placeholder="e.g. Elena Rostova"
                    className="field mt-1.5"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="e2"
                    className="text-xs uppercase tracking-wider text-slate-400 font-mono"
                  >
                    Email Address
                  </Label>
                  <input
                    id="e2"
                    type="email"
                    required
                    value={f.email}
                    onChange={(e) => setF({ ...f, email: e.target.value })}
                    placeholder="counsel@chamber.com"
                    className="field mt-1.5"
                  />
                </div>
                <div>
                  <Label
                    htmlFor="p2"
                    className="text-xs uppercase tracking-wider text-slate-400 font-mono"
                  >
                    Password (8+ characters)
                  </Label>
                  <input
                    id="p2"
                    type="password"
                    required
                    minLength={8}
                    value={f.password}
                    onChange={(e) => setF({ ...f, password: e.target.value })}
                    placeholder="••••••••"
                    className="field mt-1.5"
                  />
                </div>
                <button type="submit" className="btn-gold w-full mt-2" disabled={busy}>
                  {busy ? "Creating Account…" : "Create Courtroom Account"}
                </button>
              </form>
            </TabsContent>

            <div className="relative my-6 text-center text-xs text-slate-500">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-800" />
              </div>
              <span className="relative bg-slate-900/90 px-3 uppercase tracking-wider font-mono text-[10px]">
                or
              </span>
            </div>

            <button type="button" onClick={google} className="btn-ghost w-full">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                />
              </svg>
              Continue with Google
            </button>
          </Tabs>
        )}
      </div>
    </main>
  );
}
