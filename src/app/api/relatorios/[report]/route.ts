import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { buildReport, REPORTS, toCsv } from "@/server/services/reports";
import { companyHeaderLines, getCompanyProfile } from "@/server/services/company";
import { DomainError, PermissionError, toUserMessage } from "@/server/errors";

export const dynamic = "force-dynamic";

/** Exportação CSV de relatórios: exige sessão e permissão reports.export; respeita os filtros da URL. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!(report in REPORTS)) return NextResponse.json({ error: "Relatório inexistente." }, { status: 404 });
  try {
    const db = await getDb();
    const table = await buildReport({ db, user }, report, request.nextUrl.searchParams);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    // Identificação da empresa (razão social, CNPJ e endereço) antes do cabeçalho; ?cabecalho=0 omite.
    const preamble =
      request.nextUrl.searchParams.get("cabecalho") === "0"
        ? []
        : [
            ...companyHeaderLines(await getCompanyProfile(db, user.companyId)).map((line) => [line]),
            [`${REPORTS[report as keyof typeof REPORTS]} — gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`],
            [],
          ];
    return new NextResponse(toCsv(table, preamble), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orion-${report}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof PermissionError ? 403 : error instanceof DomainError ? 400 : 500;
    return NextResponse.json({ error: toUserMessage(error) }, { status });
  }
}
