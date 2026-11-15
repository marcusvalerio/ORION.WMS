/**
 * Templates de e-mail do ORION (HTML com estilos inline, compatível com
 * clientes de e-mail). Funções puras: recebem dados e devolvem assunto, HTML e
 * texto simples. Nenhum envio acontece aqui — o envio real depende de um
 * transporte de e-mail que ainda não existe no projeto.
 */

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

const C = {
  noite: "#03061A",
  marinho: "#060B2A",
  creme: "#FFF8E7",
  ceu: "#7DB7F0",
  gelo: "#F7F9FC",
  gelo200: "#DCE8F3",
  texto2: "#46516A",
  ok: "#2CC593",
  critBg: "#FDECEC",
  critFg: "#A3202A",
  critSolid: "#E03A45",
  critLine: "#F5C2C5",
};
const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const DISPLAY = "Gabarito, Inter, -apple-system, 'Segoe UI', Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, Menlo, Consolas, monospace";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const nf = (n: number, digits = 0) => n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const signed = (s: string, n: number) => (n > 0 ? `+${s}` : n < 0 ? `−${s.replace("-", "")}` : s);

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${C.marinho};color:${C.creme};font-family:${SANS};font-weight:600;font-size:14px;text-decoration:none">${escapeHtml(label)}</a>`;
}

function layout(title: string, header: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.gelo200};font-family:${SANS};color:${C.marinho}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td>${header}</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:1.55">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${C.gelo200};font-size:11px;color:${C.texto2}">ORION WMS · ecossistema ASTRAEUS · mensagem automática, não responda.</td></tr>
</table></td></tr></table></body></html>`;
}

function stat(value: string, label: string): string {
  return `<td width="33%" style="padding:4px"><div style="padding:12px 6px;border-radius:10px;background:${C.gelo};text-align:center"><b style="display:block;font-size:22px;font-weight:500">${escapeHtml(value)}</b><span style="font-size:11px;color:${C.texto2}">${escapeHtml(label)}</span></div></td>`;
}

function row(label: string, value: string, mono = false): string {
  return `<tr><td style="padding:4px 0;color:${C.texto2}">${escapeHtml(label)}</td><td align="right" style="padding:4px 0;${mono ? `font-family:${MONO}` : ""}">${escapeHtml(value)}</td></tr>`;
}

// ---------------------------------------------------------------------------

export interface InventarioConcluidoData {
  codigo: string;
  deposito: string;
  fechadoEm: Date;
  /** Acuracidade em % (0–100). */
  acuracidade: number;
  enderecos: number;
  ajustes: number;
  url: string;
}

export function inventarioConcluidoEmail(d: InventarioConcluidoData): EmailMessage {
  const acc = `${nf(d.acuracidade, 1)}%`;
  const hora = d.fechadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const header = `<div style="background:${C.noite};padding:22px;height:106px;position:relative;overflow:hidden;color:${C.creme}">
<div style="font-family:${DISPLAY};font-weight:700;font-size:64px;line-height:1;letter-spacing:-0.04em;color:${C.ok}">${escapeHtml(nf(d.acuracidade, 1))}</div>
<div style="font-family:${DISPLAY};font-weight:600;font-size:24px;margin-top:6px">Inventário concluído</div></div>`;
  const body = `<p style="margin:0 0 14px">O inventário <span style="font-family:${MONO}">${escapeHtml(d.codigo)}</span> do ${escapeHtml(d.deposito)} foi fechado hoje às ${escapeHtml(hora)}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr>${stat(acc, "acuracidade")}${stat(nf(d.enderecos), "endereços")}${stat(nf(d.ajustes), "ajustes")}</tr></table>
${button(d.url, "Abrir relatório")}`;
  return {
    subject: `Inventário ${d.codigo} concluído · ${acc} de acuracidade`,
    html: layout("Inventário concluído", header, body),
    text: `Inventário concluído\n\nO inventário ${d.codigo} do ${d.deposito} foi fechado hoje às ${hora}.\nAcuracidade: ${acc} · Endereços: ${nf(d.enderecos)} · Ajustes: ${nf(d.ajustes)}\n\nAbrir relatório: ${d.url}\n\nORION WMS · ecossistema ASTRAEUS`,
  };
}

export interface DivergenciaData {
  endereco: string;
  produto?: string;
  esperado: number;
  contado: number;
  unidade?: string;
  /** Valor unitário em R$ para estimar o impacto (opcional). */
  valorUnitario?: number;
  recontagemCriada: boolean;
  url: string;
}

export function divergenciaEmail(d: DivergenciaData): EmailMessage {
  const un = d.unidade ?? "un";
  const diff = d.contado - d.esperado;
  const diffTxt = signed(`${nf(diff)} ${un}`, diff) + (d.valorUnitario != null ? ` · ${signed(brl(diff * d.valorUnitario), diff)}` : "");
  const header = `<div style="padding:22px 24px;border-bottom:1px solid ${C.gelo200}"><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${C.critSolid};margin-right:10px"></span><span style="font-family:${DISPLAY};font-weight:600;font-size:20px">Divergência encontrada</span></div>`;
  const body = `<div style="font-family:${MONO};font-weight:500;font-size:30px;margin:0 0 14px">${escapeHtml(d.endereco)}</div>
${d.produto ? `<p style="margin:0 0 10px;color:${C.texto2}">${escapeHtml(d.produto)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.critBg};color:${C.critFg};border-radius:12px;margin:0 0 14px"><tr><td style="padding:14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="color:${C.critFg}">
<tr><td style="padding:3px 0">Esperado</td><td align="right" style="font-weight:600">${escapeHtml(`${nf(d.esperado)} ${un}`)}</td></tr>
<tr><td style="padding:3px 0">Contado</td><td align="right" style="font-weight:600">${escapeHtml(`${nf(d.contado)} ${un}`)}</td></tr>
<tr><td style="padding:8px 0 0;border-top:1px solid ${C.critLine}">Diferença</td><td align="right" style="padding:8px 0 0;border-top:1px solid ${C.critLine};font-weight:600">${escapeHtml(diffTxt)}</td></tr>
</table></td></tr></table>
<p style="margin:0 0 14px;color:${C.texto2}">${d.recontagemCriada ? "Uma recontagem foi criada para outro operador." : "Analise a divergência antes de ajustar o estoque."}</p>
${button(d.url, d.recontagemCriada ? "Ver recontagem" : "Ver divergência")}`;
  return {
    subject: `Divergência em ${d.endereco}: ${signed(`${nf(diff)} ${un}`, diff)}`,
    html: layout("Divergência encontrada", header, body),
    text: `Divergência encontrada em ${d.endereco}\n${d.produto ? `${d.produto}\n` : ""}Esperado: ${nf(d.esperado)} ${un}\nContado: ${nf(d.contado)} ${un}\nDiferença: ${diffTxt}\n\n${d.url}\n\nORION WMS · ecossistema ASTRAEUS`,
  };
}

export interface RecebimentoAgendadoData {
  pedido: string;
  doca: string;
  inicio: Date;
  fim: Date;
  volumes?: string;
  fornecedor?: string;
  url: string;
}

export function recebimentoAgendadoEmail(d: RecebimentoAgendadoData): EmailMessage {
  const tz = { timeZone: "America/Sao_Paulo" } as const;
  const dia = d.inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", ...tz });
  const h = (x: Date) => x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", ...tz });
  const janela = `${dia} · ${h(d.inicio)}–${h(d.fim)}`;
  const header = `<div style="background:${C.ceu};padding:22px;height:106px;position:relative"><div style="height:64px"></div><div style="font-family:${DISPLAY};font-weight:600;font-size:24px;color:${C.marinho}">Recebimento agendado</div></div>`;
  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">
${row("Pedido", d.pedido, true)}${d.fornecedor ? row("Fornecedor", d.fornecedor) : ""}${row("Doca", d.doca, true)}${row("Janela", janela)}${d.volumes ? row("Volumes", d.volumes) : ""}
</table>
${button(d.url, "Ver agenda da doca")}`;
  return {
    subject: `Recebimento agendado: ${d.pedido} na doca ${d.doca} (${janela})`,
    html: layout("Recebimento agendado", header, body),
    text: `Recebimento agendado\n\nPedido: ${d.pedido}\n${d.fornecedor ? `Fornecedor: ${d.fornecedor}\n` : ""}Doca: ${d.doca}\nJanela: ${janela}\n${d.volumes ? `Volumes: ${d.volumes}\n` : ""}\nVer agenda da doca: ${d.url}\n\nORION WMS · ecossistema ASTRAEUS`,
  };
}
