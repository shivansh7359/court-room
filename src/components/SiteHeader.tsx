import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Bell, Scale, LayoutDashboard, ShieldCheck, LogOut } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

interface Notif {
  id: string;
  message: string;
  read: boolean;
  created_at: string;
  case_id: string | null;
}

export function SiteHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setNotifs([]);
      return;
    }
    const load = () =>
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30)
        .then(({ data }) => setNotifs((data as Notif[]) ?? []));
    load();
    const ch = supabase
      .channel(`notif-${user.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (p) => {
          toast((p.new as Notif).message);
          load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const unread = notifs.filter((n) => !n.read).length;

  async function markAll() {
    await supabase.from("notifications").update({ read: true }).eq("read", false);
    setNotifs((n) => n.map((x) => ({ ...x, read: true })));
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const isDashboard = location.pathname.startsWith("/dashboard") || location.pathname.startsWith("/cases");
  const isVerify = location.pathname.startsWith("/verify");
  const displayName =
    (user?.user_metadata?.display_name as string) ||
    user?.email?.split("@")[0] ||
    "Counsel";

  return (
    <header className="sticky top-0 z-50 border-b border-amber-500/20 bg-slate-950/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-8">
        <Link
          data-testid="shell-logo-link"
          to={user ? "/dashboard" : "/"}
          className="focus-visible:outline-none"
        >
          <span className="inline-flex items-center gap-2.5 [&>span:last-child]:hidden sm:[&>span:last-child]:inline">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-amber-500/40 bg-amber-500/10">
              <Scale className="h-4 w-4 text-amber-400" />
            </span>
            <span className="font-serif text-2xl font-semibold tracking-tight text-slate-100">
              JusticeRoom
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {user ? (
            <>
              <Link
                data-testid="nav-dashboard"
                to="/dashboard"
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-200 ${
                  isDashboard
                    ? "bg-amber-500/10 text-amber-300"
                    : "text-slate-300 hover:text-amber-300"
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden md:inline">Docket</span>
              </Link>

              <Link
                data-testid="nav-verify"
                to="/verify"
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-200 ${
                  isVerify
                    ? "bg-amber-500/10 text-amber-300"
                    : "text-slate-300 hover:text-amber-300"
                }`}
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="hidden md:inline">Verify</span>
              </Link>

              <span
                data-testid="realtime-status"
                title="Live updates connected"
                className="mx-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-500"
              >
                <span className="h-2 w-2 rounded-full animate-pulse bg-emerald-400" />
                <span className="hidden sm:inline">Live</span>
              </span>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    data-testid="notification-bell"
                    aria-label="Notifications"
                    type="button"
                    className="relative grid h-10 w-10 place-items-center rounded-full border border-slate-700 text-slate-300 transition-colors duration-200 hover:border-amber-500/60 hover:text-amber-300"
                  >
                    <Bell className="h-4 w-4" />
                    {unread > 0 && (
                      <span
                        data-testid="notification-unread-count"
                        className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
                      >
                        {unread}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 p-0 border border-amber-500/20 bg-slate-950 text-slate-100 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
                    <span className="font-serif text-sm font-semibold text-amber-300">
                      Notifications
                    </span>
                    {unread > 0 && (
                      <button
                        onClick={markAll}
                        className="font-mono text-xs text-slate-400 hover:text-amber-300 transition-colors"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto transcript-scroll divide-y divide-slate-800/70">
                    {notifs.length === 0 ? (
                      <p className="p-4 text-center text-sm text-slate-500">
                        You're all caught up.
                      </p>
                    ) : (
                      notifs.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3 text-sm transition-colors hover:bg-slate-900/60 ${
                            n.read ? "text-slate-400 opacity-75" : "text-slate-100 font-medium"
                          }`}
                        >
                          {n.case_id ? (
                            <Link
                              to="/cases/$id"
                              params={{ id: n.case_id }}
                              className="hover:text-amber-300 transition-colors"
                            >
                              {n.message}
                            </Link>
                          ) : (
                            n.message
                          )}
                          <div className="mt-1 font-mono text-[11px] text-slate-500">
                            {new Date(n.created_at).toLocaleString()}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    data-testid="user-menu"
                    aria-label="Account menu"
                    className="flex items-center gap-2.5 rounded-full border border-slate-700 py-1 pl-1 pr-3 text-slate-300 transition-colors duration-200 hover:border-amber-500/60 hover:text-amber-300"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-500/15 font-mono text-xs font-semibold uppercase text-amber-300 ring-1 ring-amber-500/40">
                      {displayName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2)}
                    </span>
                    <span data-testid="shell-user-name" className="hidden max-w-[8rem] truncate text-sm lg:inline">
                      {displayName}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 border border-slate-800 bg-[#090e1a] p-2 text-slate-100">
                  <div className="px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Signed in as</p>
                    <p className="mt-1 break-all text-sm text-slate-200">{user.email}</p>
                  </div>
                  <button
                    data-testid="logout-button"
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-red-300"
                  >
                    <LogOut className="h-4 w-4" /> Log out
                  </button>
                </PopoverContent>
              </Popover>
            </>
          ) : (
            <>
              <Link
                data-testid="nav-verify"
                to="/verify"
                className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-300 hover:text-amber-300 transition-colors duration-200"
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="hidden md:inline">Verify</span>
              </Link>
              <Link
                to="/auth"
                className="btn-gold text-sm py-2 px-4"
              >
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
