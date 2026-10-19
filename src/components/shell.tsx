import Link from "next/link";
import {
  LayoutDashboard,
  Building2,
  Wallet,
  ArrowLeftRight,
  ScanLine,
  ShieldCheck,
  Settings2,
  ArrowUpRight,
} from "lucide-react";
import { logout } from "@/app/actions";
const links = [
  { href: "/panel", label: "Vista general", icon: LayoutDashboard },
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/fondos", label: "Fondos", icon: Wallet },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight },
  { href: "/auditoria", label: "Auditoría", icon: ScanLine },
  { href: "/borradores", label: "Borradores", icon: ArrowLeftRight },
  { href: "/cierres", label: "Cierres", icon: ShieldCheck },
  { href: "/reportes", label: "Reportes", icon: ScanLine },
];
export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 text-xl font-bold tracking-[.1em]"
    >
      <span className="grid size-9 grid-cols-2 gap-1 rounded-xl bg-emerald-800 p-2">
        <i className="rounded-sm bg-white" />
        <i className="rounded-sm bg-white/40" />
        <i className="rounded-sm bg-white/40" />
        <i className="rounded-sm bg-white" />
      </span>
      CUADRIA
    </Link>
  );
}
export function Shell({
  children,
  email,
}: {
  children: React.ReactNode;
  email?: string;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[238px_1fr]">
      <aside className="border-r border-stone-200 bg-[#f5f5f0] p-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Brand />
        <p className="mt-10 mb-3 hidden text-[10px] font-semibold tracking-[.16em] text-stone-500 lg:block">
          ESPACIO DE TRABAJO
        </p>
        <nav className="mt-5 flex gap-1 overflow-x-auto lg:mt-0 lg:flex-col">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="nav-link flex shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-sm text-stone-600 hover:bg-white hover:text-emerald-900"
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-stone-200 pt-5 lg:block">
          <div className="mb-5 flex items-center gap-2 text-xs text-stone-500">
            <ShieldCheck size={16} />
            Control financiero inteligente
          </div>
          <Link
            href="/configuracion"
            className="flex items-center gap-2 text-sm text-stone-600"
          >
            <Settings2 size={16} />
            Configuración
          </Link>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-20 items-center justify-between gap-3 border-b border-stone-200 bg-white px-6 lg:px-10">
          <span className="text-sm text-stone-500">
            Tu operación, en orden.
          </span>
          {email ? (
            <div className="flex items-center gap-4">
              <span className="hidden text-xs text-stone-500 md:inline">
                {email}
              </span>
              <form action={logout}>
                <button className="text-xs font-semibold underline">
                  Salir
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-2 text-sm font-medium"
            >
              Ingresar
              <ArrowUpRight size={16} />
            </Link>
          )}
        </header>
        <main id="main" className="mx-auto max-w-7xl p-5 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p className="mb-3 text-[10px] font-bold tracking-[.18em] text-emerald-800">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <Wallet className="mx-auto mb-4 text-stone-400" size={28} />
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-500">
        {description}
      </p>
    </div>
  );
}
