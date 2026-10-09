import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listProducts } from "@/server/services/products";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { STORAGE_CLASS_LABELS } from "@/lib/labels";
import { fmtQty } from "@/lib/format";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Produtos" };

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const rows = await listProducts(ctx, { q: params.q, status: params.status });
  return (
    <>
      <PageHeader
        title="Produtos e unidades logísticas"
        description="Cadastro mestre mantido pelo ERP (somente leitura aqui). O WMS complementa com parâmetros logísticos: lote, validade, série, classe de armazenagem e embalagens."
        breadcrumbs={[{ label: "Armazém" }, { label: "Produtos" }]}
      />
      <Alert level="info" className="mb-4">
        Para incluir ou alterar SKU, descrição, código de barras, unidade, peso e dimensões, utilize o cadastro de produtos do ERP.
      </Alert>
      <Card>
        <FilterBar resetHref="/produtos">
          <FilterField label="Buscar" className="w-full sm:w-72">
            <Input name="q" defaultValue={params.q} placeholder="SKU, descrição ou código de barras" />
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-36">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Todos"
              options={[
                { value: "active", label: "Ativo" },
                { value: "inactive", label: "Inativo" },
              ]}
            />
          </FilterField>
        </FilterBar>
        {rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Descrição</th>
                  <th>Código de barras</th>
                  <th>UN</th>
                  <th>Categoria</th>
                  <th>Controles</th>
                  <th>Classe</th>
                  <th className="num">Físico</th>
                  <th className="num">Reservado</th>
                  <th className="num">Bloqueado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/produtos/${p.id}`} className="link">
                        {p.sku}
                      </Link>
                    </td>
                    <td>
                      {p.description}
                      {p.status !== "active" ? <Badge className="ml-2">Inativo</Badge> : null}
                    </td>
                    <td className="code">{p.barcode ?? "—"}</td>
                    <td>{p.uom}</td>
                    <td>{p.category ?? "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {p.lot_controlled ? <Badge tone="info">Lote</Badge> : null}
                        {p.expiry_controlled ? <Badge tone="info">Validade</Badge> : null}
                        {p.serial_controlled ? <Badge tone="info">Série</Badge> : null}
                        {!p.lot_controlled && !p.expiry_controlled && !p.serial_controlled ? <span className="text-xs text-slate-400">—</span> : null}
                      </div>
                    </td>
                    <td>{STORAGE_CLASS_LABELS[p.storage_class]}</td>
                    <td className="num">{fmtQty(p.physical)}</td>
                    <td className="num">{fmtQty(p.reserved)}</td>
                    <td className="num">{fmtQty(p.blocked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum produto encontrado" />
        )}
      </Card>
    </>
  );
}
