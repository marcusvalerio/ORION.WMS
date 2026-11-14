import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DomainError } from "../../errors";

/**
 * Leitura LOCAL do XML da NF-e (modelo 55, layout 4.00) — sem consulta à SEFAZ.
 *
 * Por que fast-xml-parser: é JavaScript puro (sem binário nativo, roda igual no
 * Node, na Vercel e nos testes), não resolve entidades externas nem faz acesso a
 * rede/arquivo, tem validador de boa formação e é amplamente usado. Mesmo assim,
 * aplicamos defesas próprias antes do parse:
 *  - tamanho máximo (MAX_NFE_BYTES);
 *  - recusa de qualquer DOCTYPE/ENTITY (impede XXE e "billion laughs");
 *  - processEntities desligado para entidades declaradas e validação de estrutura.
 * A assinatura digital do XML NÃO é verificada (exigiria a cadeia ICP-Brasil);
 * a chave de acesso tem o dígito verificador conferido.
 */
export const MAX_NFE_BYTES = 1024 * 1024;

export interface NfeLot {
  lot: string;
  quantity: number;
  manufacturedAt: string | null;
  expiryDate: string | null;
}

export interface NfeItem {
  itemNo: number;
  supplierCode: string;
  ean: string | null;
  description: string;
  quantity: number;
  unit: string;
  poNumberRef: string | null;
  lots: NfeLot[];
}

export interface ParsedNfe {
  accessKey: string;
  model: string;
  number: string;
  series: string;
  issuedAt: string | null;
  emitter: { cnpj: string; name: string };
  recipientCnpj: string | null;
  items: NfeItem[];
}

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
export function accessKeyCheckDigit(first43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());
const EAN_EMPTY = new Set(["", "SEM GTIN"]);

function num(v: unknown, label: string): number {
  const n = Number(str(v));
  if (!Number.isFinite(n) || n <= 0) throw new DomainError(`XML da NF-e: ${label} inválida.`, "NFE_INVALID");
  return Math.round(n * 1000) / 1000;
}

function date(v: unknown): string | null {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export function parseNfeXml(xml: string): ParsedNfe {
  if (typeof xml !== "string" || !xml.trim()) throw new DomainError("Arquivo XML vazio.", "NFE_INVALID");
  if (Buffer.byteLength(xml, "utf8") > MAX_NFE_BYTES) {
    throw new DomainError(`Arquivo XML acima do limite de ${MAX_NFE_BYTES / 1024} KB.`, "NFE_TOO_LARGE");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new DomainError("XML recusado: declarações DOCTYPE/ENTITY não são permitidas em NF-e.", "NFE_UNSAFE");
  }
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new DomainError(`XML malformado (linha ${valid.err.line}).`, "NFE_INVALID");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    parseTagValue: false, // mantém zeros à esquerda (cProd, cEAN, CNPJ)
    parseAttributeValue: false,
    processEntities: true, // apenas as 5 entidades predefinidas: DOCTYPE já foi recusado
    htmlEntities: false,
    isArray: (name) => name === "det" || name === "rastro",
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc.nfeProc as Record<string, unknown> | undefined)?.NFe ?? doc.NFe;
  const infNFe = (root as Record<string, unknown> | undefined)?.infNFe as Record<string, unknown> | undefined;
  if (!infNFe) throw new DomainError("XML não é uma NF-e (elemento infNFe ausente).", "NFE_INVALID");

  const version = str(infNFe["@versao"]);
  if (version && version !== "4.00") throw new DomainError(`Layout da NF-e ${version} não suportado (esperado 4.00).`, "NFE_INVALID");
  const accessKey = str(infNFe["@Id"]).replace(/^NFe/, "");
  if (!/^\d{44}$/.test(accessKey)) throw new DomainError("Chave de acesso da NF-e deve ter 44 dígitos.", "NFE_INVALID");
  if (!isValidAccessKey(accessKey)) throw new DomainError("Chave de acesso da NF-e com dígito verificador inválido.", "NFE_INVALID");

  const ide = (infNFe.ide ?? {}) as Record<string, unknown>;
  const emit = (infNFe.emit ?? {}) as Record<string, unknown>;
  const dest = (infNFe.dest ?? {}) as Record<string, unknown>;
  const model = str(ide.mod);
  if (model !== "55") throw new DomainError(`Modelo ${model || "?"} não suportado: apenas NF-e modelo 55.`, "NFE_INVALID");
  const cnpj = str(emit.CNPJ).replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj)) throw new DomainError("Emitente sem CNPJ válido na NF-e.", "NFE_INVALID");
  if (accessKey.slice(6, 20) !== cnpj) throw new DomainError("CNPJ do emitente não confere com a chave de acesso.", "NFE_INVALID");
  const number = str(ide.nNF);
  if (number && Number(number) !== Number(accessKey.slice(25, 34))) {
    throw new DomainError("Número da NF-e não confere com a chave de acesso.", "NFE_INVALID");
  }

  const dets = asArray(infNFe.det as Record<string, unknown>[] | undefined);
  if (!dets.length) throw new DomainError("NF-e sem itens.", "NFE_INVALID");
  if (dets.length > 990) throw new DomainError("NF-e com itens acima do limite do layout.", "NFE_INVALID");
  const items: NfeItem[] = dets.map((det, idx) => {
    const prod = (det.prod ?? {}) as Record<string, unknown>;
    const ean = str(prod.cEAN);
    const lots = asArray(prod.rastro as Record<string, unknown>[] | undefined).map((r) => ({
      lot: str(r.nLote).toUpperCase().slice(0, 40),
      quantity: num(r.qLote, `quantidade do lote do item ${idx + 1}`),
      manufacturedAt: date(r.dFab),
      expiryDate: date(r.dVal),
    }));
    const description = str(prod.xProd);
    const supplierCode = str(prod.cProd);
    if (!supplierCode || !description) throw new DomainError(`Item ${idx + 1} da NF-e sem código ou descrição.`, "NFE_INVALID");
    return {
      itemNo: Number(str(det["@nItem"])) || idx + 1,
      supplierCode: supplierCode.slice(0, 60),
      ean: EAN_EMPTY.has(ean.toUpperCase()) ? null : ean,
      description: description.slice(0, 200),
      quantity: num(prod.qCom, `quantidade do item ${idx + 1}`),
      unit: (str(prod.uCom) || "UN").toUpperCase().slice(0, 10),
      poNumberRef: str(prod.xPed) || null,
      lots,
    };
  });

  return {
    accessKey,
    model,
    number: number || String(Number(accessKey.slice(25, 34))),
    series: str(ide.serie) || String(Number(accessKey.slice(22, 25))),
    issuedAt: str(ide.dhEmi) || null,
    emitter: { cnpj, name: str(emit.xNome).slice(0, 160) || cnpj },
    recipientCnpj: str(dest.CNPJ) || null,
    items,
  };
}
