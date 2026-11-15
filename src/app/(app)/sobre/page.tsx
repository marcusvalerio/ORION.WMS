import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { OrionRing } from "@/components/brand/orion-ring";
import { RELEASES } from "@/content/novidades";
import { itensParaPerfil } from "@/lib/novidades";

export const metadata = { title: "Sobre" };

export default async function SobrePage() {
  const { user } = await requireCtx();
  return (
    <>
      <PageHeader title="Sobre o ORION" description="Versão, ecossistema e histórico de novidades." breadcrumbs={[{ label: "Sobre" }]} />
      <div className="space-y-5">
        <section className="relative overflow-hidden rounded-2xl bg-[#03061A] px-6 py-12 text-center text-creme-100 sm:px-10">
          <OrionRing size={900} bars={72} palette="interno" direction="ccw" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70" />
          <div className="relative flex flex-col items-center gap-4">
            <span className="font-mono text-xs tracking-[0.18em] text-ceu-400">UM SÓ ECOSSISTEMA</span>
            <h2 className="font-display text-5xl font-black tracking-wide sm:text-7xl">ASTRAEUS</h2>
            <div className="flex flex-wrap justify-center gap-2 text-sm font-semibold">
              <span className="rounded-full bg-creme-300 px-4 py-2 text-noite-900">ATLAS · ERP, MRP, MCN</span>
              <span className="rounded-full bg-ceu-400 px-4 py-2 text-noite-900">ORION · WMS</span>
              <span className="rounded-full border border-dashed border-ceu-300 px-4 py-2 text-ceu-300">TMS · em breve</span>
            </div>
            <p className="max-w-xl text-ceu-300">O ERP planeja, o WMS guarda e separa, o TMS leva. Um dado digitado uma vez vale para todos.</p>
          </div>
        </section>
        <Card>
          <CardHeader title="Novidades por versão" description="Use o ícone de presente no topo para rever as novidades da versão atual." />
          <ol className="divide-y divide-line">
            {RELEASES.map((r) => {
              const itens = itensParaPerfil(r, user.role);
              return (
                <li key={r.versao} className="px-4 py-3">
                  <p className="font-mono text-xs text-muted">Versão {r.versao}</p>
                  {itens.length ? (
                    <ul className="mt-1 space-y-1 text-sm">
                      {itens.map((i) => (
                        <li key={i.id}>
                          <span className="font-medium text-fg">{i.titulo}</span> <span className="text-muted">— {i.texto}</span>{" "}
                          {i.rota ? (
                            <Link href={i.rota} className="link">
                              Abrir
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">Nenhuma novidade para o seu perfil.</p>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
        <p className="text-sm text-muted">
          Componentes de interface: <Link href="/sobre/estados" className="link">catálogo de estados do sistema</Link> ·{" "}
          <Link href="/site" className="link">página pública</Link>
        </p>
      </div>
    </>
  );
}
