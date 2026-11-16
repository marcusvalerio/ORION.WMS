import { z } from "zod";

/**
 * Contrato de integração ATLAS.ERP ↔ ORION.WMS, versão 1.
 *
 * Fonte da verdade: docs/INTEGRACAO-ATLAS-ORION.md e docs/contrato/*.json
 * (idênticos nos dois repositórios). Estes schemas validam o que o ORION
 * recebe (a2o.*, sso.*, s2s.*) e o que ele emite (o2a.*); os testes de
 * contrato (tests/atlas-contract.test.ts) passam TODAS as fixtures por eles.
 */

export const CONTRACT_VERSION = 1;
export const SSO_AUDIENCE = "orion-wms";

const id = z.uuid();
const nullableText = z.string().nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");
const dateTime = z.iso.datetime({ offset: true });
const quantity = z.number().finite().nonnegative();
const cancelOrigin = z.enum(["atlas", "orion"]);
const positive = z.number().finite().positive();
export const ORION_ROLES = ["admin", "supervisor", "operator", "auditor"] as const;
const role = z.enum(ORION_ROLES);

// -----------------------------------------------------------------------------
// Envelope (3.3)
// -----------------------------------------------------------------------------

export const aggregateSchema = z.object({
  type: z.string().min(1).max(60),
  id,
  sequence: z.number().int().nonnegative(),
});

export const envelopeSchema = z.object({
  id,
  type: z.string().regex(/^[a-z_]+\.[a-z_]+$/, "Tipo de evento inválido."),
  version: z.number().int().positive(),
  source: z.enum(["atlas", "orion"]),
  atlas_company_id: id,
  orion_company_id: id,
  aggregate: aggregateSchema,
  occurred_at: dateTime,
  payload: z.record(z.string(), z.unknown()),
  // Campos legados do formato ORION (o ATLAS os ignora).
  company_id: id.optional(),
  created_at: z.string().optional(),
  attempt: z.number().int().nonnegative().optional(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

// -----------------------------------------------------------------------------
// ATLAS → ORION (3.4)
// -----------------------------------------------------------------------------

const companyPayload = z.object({
  company: z.object({
    atlas_company_id: id,
    name: z.string().min(1).max(200),
    legal_name: nullableText,
    document: nullableText,
    email: nullableText,
    phone: nullableText,
    address: nullableText,
    city: nullableText,
    state: nullableText,
    zip_code: nullableText,
    status: z.string(),
    updated_at: dateTime.optional(),
  }),
});

const warehouseRef = z.object({
  atlas_warehouse_id: id,
  code: z.string().min(1),
  name: z.string().min(1),
  orion_warehouse_code: z.string().min(1).max(30),
});

const addressSchema = z
  .object({
    street: nullableText,
    number: nullableText,
    district: nullableText,
    city: nullableText,
    state: nullableText,
    zip_code: nullableText,
  })
  .nullable()
  .optional();

const salesLine = z.object({
  atlas_line_id: id,
  line_no: z.number().int().positive(),
  atlas_product_id: id,
  product_code: z.string().min(1),
  unit: z.string().min(1),
  quantity: positive,
  lot_code: nullableText,
});

export const A2O_PAYLOADS = {
  "company.upserted": companyPayload,
  "company.deactivated": z.object({
    atlas_company_id: id,
    reason: z.string(),
    mode: z.enum(["read_only", "disabled"]),
    effective_at: dateTime.optional(),
  }),
  "integration.activated": z.object({
    stock_owner: z.enum(["atlas", "orion"]),
    sales_release_status: z.string(),
    purchase_release_status: z.string(),
    production_release_status: z.string(),
    require_invoice_before_ship: z.boolean(),
    warehouses: z.array(warehouseRef),
  }),
  "user_access.granted": z.object({
    atlas_user_id: id,
    email: z.email(),
    name: z.string().min(1).max(120),
    orion_role: role,
    access_version: z.number().int().nonnegative(),
    warehouses: z.array(z.string()).optional().nullable(),
  }),
  "user_access.revoked": z.object({
    atlas_user_id: id,
    access_version: z.number().int().nonnegative(),
    reason: z.string(),
  }),
  "unit.upserted": z.object({
    atlas_unit_id: id,
    code: z.string().min(1).max(20),
    name: z.string().min(1),
    base_unit_code: nullableText,
    factor_to_base: z.number().positive().nullable().optional(),
    status: z.enum(["active", "inactive"]),
  }),
  "product.upserted": z.object({
    product: z.object({
      atlas_product_id: id,
      code: z.string().min(1).max(60),
      sku: nullableText,
      barcode: nullableText,
      name: z.string().min(1),
      description: nullableText,
      category: nullableText,
      unit: z.string().min(1).max(20),
      ncm: nullableText,
      weight_kg: z.number().nonnegative().nullable().optional(),
      height_cm: z.number().nonnegative().nullable().optional(),
      width_cm: z.number().nonnegative().nullable().optional(),
      length_cm: z.number().nonnegative().nullable().optional(),
      batch_controlled: z.boolean(),
      expiration_controlled: z.boolean(),
      serial_controlled: z.boolean().optional(),
      status: z.enum(["active", "inactive"]),
      updated_at: dateTime.optional(),
      packagings: z
        .array(z.object({ unit: z.string().min(1), quantity: positive, barcode: nullableText }))
        .optional()
        .nullable(),
    }),
  }),
  "product.deactivated": z.object({ atlas_product_id: id, code: z.string() }),
  "customer.upserted": z.object({
    customer: z.object({
      atlas_customer_id: id,
      code: z.string().min(1),
      type: z.string().optional(),
      name: z.string().min(1),
      trade_name: nullableText,
      document: nullableText,
      email: nullableText,
      phone: nullableText,
      address: addressSchema,
      status: z.enum(["active", "inactive"]),
      updated_at: dateTime.optional(),
    }),
  }),
  "supplier.upserted": z.object({
    supplier: z.object({
      atlas_supplier_id: id,
      code: z.string().min(1),
      name: z.string().min(1),
      document: nullableText,
      email: nullableText,
      status: z.enum(["active", "inactive"]),
      updated_at: dateTime.optional(),
    }),
  }),
  "sales_order.released": z.object({
    sales_order: z.object({
      atlas_sales_order_id: id,
      number: z.string().min(1),
      status: z.string(),
      atlas_customer_id: id,
      customer_code: z.string(),
      issue_date: date,
      requested_ship_date: date.nullable().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      atlas_warehouse_id: id,
      shipping: z
        .object({ carrier_code: nullableText, freight_mode: nullableText, address: addressSchema })
        .nullable()
        .optional(),
      export: z.record(z.string(), z.unknown()).nullable().optional(),
      notes: nullableText,
      lines: z.array(salesLine).min(1),
    }),
  }),
  "sales_order.updated": z.object({
    sales_order: z.object({
      atlas_sales_order_id: id,
      number: z.string(),
      requested_ship_date: date.nullable().optional(),
      lines: z.array(salesLine).min(1),
    }),
    changed_fields: z.array(z.string()).optional(),
  }),
  "sales_order.line_cancelled": z.object({
    atlas_sales_order_id: id,
    number: z.string(),
    atlas_line_id: id,
    cancelled_quantity: positive,
    reason: z.string().min(1),
  }),
  "sales_order.cancelled": z.object({
    atlas_sales_order_id: id,
    number: z.string(),
    reason: z.string().min(1),
    lines: z.array(z.unknown()).nullable().optional(),
  }),
  "sales_invoice.authorized": z.object({
    atlas_sales_order_id: id,
    number: z.string(),
    atlas_fiscal_document_id: id,
    nfe_number: z.string(),
    nfe_series: z.string(),
    access_key: z.string().regex(/^\d{44}$/, "Chave de acesso inválida."),
    authorized_at: dateTime,
    orion_outbound_id: id.nullable().optional(),
    lines: z.array(z.object({ atlas_line_id: id, quantity: quantity, lot_code: nullableText })).optional(),
  }),
  "purchase_order.released": z.object({
    purchase_order: z.object({
      atlas_purchase_order_id: id,
      number: z.string().min(1),
      status: z.string(),
      atlas_supplier_id: id,
      supplier_code: z.string(),
      issue_date: date,
      expected_date: date.nullable().optional(),
      atlas_warehouse_id: id,
      import: z.record(z.string(), z.unknown()).nullable().optional(),
      lines: z
        .array(
          z.object({
            atlas_line_id: id,
            line_no: z.number().int().positive(),
            atlas_product_id: id,
            product_code: z.string(),
            unit: z.string(),
            quantity: positive,
            unit_price: z.number().nonnegative().nullable().optional(),
          }),
        )
        .min(1),
    }),
  }),
  "purchase_order.cancelled": z.object({ atlas_purchase_order_id: id, number: z.string(), reason: z.string().min(1) }),
  "production_order.released": z.object({
    production_order: z.object({
      atlas_production_order_id: id,
      number: z.string().min(1),
      status: z.string(),
      atlas_product_id: id,
      product_code: z.string(),
      quantity: positive,
      unit: z.string(),
      planned_date: date.nullable().optional(),
      output_lot_code: nullableText,
      atlas_warehouse_id: id,
      components: z
        .array(
          z.object({
            atlas_material_id: id,
            line_no: z.number().int().positive(),
            atlas_product_id: id,
            product_code: z.string(),
            unit: z.string(),
            quantity: positive,
          }),
        )
        .min(1),
    }),
  }),
  "production_order.cancelled": z.object({ atlas_production_order_id: id, number: z.string(), reason: z.string().min(1) }),
  "stock.initial_snapshot": z.object({
    snapshot_id: id,
    taken_at: dateTime,
    chunk: z.number().int().positive(),
    chunks: z.number().int().positive(),
    atlas_warehouse_id: id,
    receiving_location: nullableText,
    items: z.array(
      z.object({
        atlas_product_id: id,
        product_code: z.string(),
        lot_code: nullableText,
        expiration_date: date.nullable().optional(),
        quantity: positive,
        unit_cost: z.number().nonnegative().nullable().optional(),
      }),
    ),
  }),
} as const;

export type A2OType = keyof typeof A2O_PAYLOADS;
export const A2O_TYPES = Object.keys(A2O_PAYLOADS) as A2OType[];
export type A2OPayload<T extends A2OType> = z.infer<(typeof A2O_PAYLOADS)[T]>;

// -----------------------------------------------------------------------------
// ORION → ATLAS (3.6)
// -----------------------------------------------------------------------------

const lot = z.object({ lot_code: z.string().nullable(), quantity: quantity, expiration_date: date.nullable().optional() });
const productRef = { atlas_product_id: id.nullable(), sku: z.string() };

export const O2A_PAYLOADS = {
  "outbound.accepted": z.object({ code: z.string(), atlas_sales_order_id: id, atlas_event_id: id }),
  "document.rejected": z.object({
    atlas_event_id: id,
    atlas_document_type: z.string(),
    atlas_document_id: id,
    error: z.object({ code: z.string(), message: z.string() }),
  }),
  "outbound.picking_started": z.object({ code: z.string(), atlas_sales_order_id: id.nullable(), wave: z.string().nullable().optional() }),
  "outbound.ready_to_invoice": z.object({
    code: z.string(),
    atlas_sales_order_id: id.nullable(),
    gross_weight_kg: z.number().nonnegative().nullable(),
    net_weight_kg: z.number().nonnegative().nullable(),
    volumes: z.number().int().nonnegative().nullable(),
    lines: z.array(
      z.object({ atlas_line_id: id.nullable(), ...productRef, quantity, lots: z.array(lot), serials: z.array(z.string()) }),
    ),
  }),
  "outbound.shipped": z.object({
    code: z.string(),
    shipment: z.string(),
    atlas_sales_order_id: id.nullable(),
    access_key: z.string().nullable().optional(),
    carrier: z.string().nullable().optional(),
    vehicle_plate: z.string().nullable().optional(),
    shipped_at: dateTime,
    lines: z.array(
      z.object({ atlas_line_id: id.nullable(), ...productRef, requested_qty: quantity, shipped_qty: quantity, lots: z.array(lot) }),
    ),
  }),
  "outbound.cancelled": z.object({
    code: z.string(),
    atlas_sales_order_id: id.nullable(),
    reason: z.string(),
    released_reservations: z.boolean().optional(),
    /** Quem pediu o cancelamento (3.6): "atlas" = eco de sales_order.cancelled; o ATLAS não repete o efeito. */
    origin: cancelOrigin.optional(),
    atlas_event_id: id.nullable().optional(),
  }),
  "outbound.line_cancelled": z.object({
    code: z.string(),
    atlas_sales_order_id: id.nullable(),
    atlas_line_id: id.nullable(),
    sku: z.string(),
    cancelled_qty: quantity,
    reason: z.string(),
    origin: cancelOrigin.optional(),
    atlas_event_id: id.nullable().optional(),
  }),
  "receipt.completed": z.object({
    code: z.string(),
    atlas_purchase_order_id: id.nullable(),
    purchase_order_status: z.string().nullable().optional(),
    invoice_number: z.string().nullable().optional(),
    invoice_access_key: z.string().nullable().optional(),
    completed_at: dateTime,
    items: z.array(
      z.object({
        atlas_line_id: id.nullable(),
        ...productRef,
        expected_qty: quantity,
        received_qty: quantity,
        accepted_qty: quantity,
        rejected_qty: quantity,
        lots: z.array(lot),
      }),
    ),
  }),
  "divergence.registered": z.object({
    code: z.string(),
    receipt: z.string().nullable().optional(),
    atlas_purchase_order_id: id.nullable().optional(),
    kind: z.string(),
    atlas_product_id: id.nullable().optional(),
    sku: z.string().nullable().optional(),
    expected_qty: quantity.nullable().optional(),
    found_qty: quantity.nullable().optional(),
  }),
  "customer_return.completed": z.object({
    code: z.string(),
    atlas_sales_order_id: id.nullable(),
    atlas_customer_id: id.nullable().optional(),
    invoice_access_key: z.string().nullable().optional(),
    items: z.array(
      z.object({
        ...productRef,
        lot_code: z.string().nullable(),
        returned_qty: quantity,
        restocked_qty: quantity,
        scrapped_qty: quantity,
        disposition: z.string(),
      }),
    ),
  }),
  "inventory.approved": z.object({
    code: z.string(),
    scope: z.string().optional(),
    approved_at: dateTime,
    adjustments: z.array(
      z.object({
        ...productRef,
        lot_code: z.string().nullable(),
        orion_warehouse_code: z.string(),
        expected_qty: quantity,
        counted_qty: quantity,
        delta: z.number().finite(),
        reason: z.string(),
      }),
    ),
  }),
  "stock.adjusted": z.object({
    code: z.string(),
    reason: z.string(),
    notes: z.string().nullable().optional(),
    approved_by: z.string().nullable().optional(),
    items: z.array(z.object({ ...productRef, lot_code: z.string().nullable(), orion_warehouse_code: z.string(), delta: z.number().finite() })),
  }),
  "stock.transferred": z.object({
    code: z.string(),
    from_orion_warehouse_code: z.string(),
    to_orion_warehouse_code: z.string(),
    from_atlas_warehouse_id: id,
    to_atlas_warehouse_id: id,
    items: z.array(z.object({ ...productRef, lot_code: z.string().nullable(), quantity: positive })),
  }),
  "production.materials_delivered": z.object({
    code: z.string(),
    atlas_production_order_id: id.nullable(),
    order: z.string(),
    delivery: z.string(),
    received_by: z.string().nullable().optional(),
    items: z.array(z.object({ atlas_material_id: id.nullable(), ...productRef, lot_code: z.string().nullable(), quantity: positive })),
  }),
  "production.leftovers_returned": z.object({
    code: z.string(),
    atlas_production_order_id: id.nullable(),
    order: z.string(),
    atlas_material_id: id.nullable(),
    ...productRef,
    lot_code: z.string().nullable(),
    quantity: positive,
    location: z.string(),
  }),
  "production.output_received": z.object({
    code: z.string(),
    atlas_production_order_id: id.nullable(),
    order: z.string(),
    ...productRef,
    lot_code: z.string().nullable(),
    expiration_date: date.nullable().optional(),
    quantity: positive,
    total_received: quantity,
  }),
  "import.cleared": z.object({
    code: z.string(),
    atlas_purchase_order_id: id.nullable(),
    declaration: z.object({ type: z.string(), number: z.string(), cleared_at: date }),
    origin_country: z.string().nullable().optional(),
    items: z.array(z.object({ ...productRef, ncm: z.string().nullable().optional(), lot_code: z.string().nullable(), quantity: quantity })),
  }),
  "export.packed": z.object({
    code: z.string(),
    atlas_sales_order_id: id.nullable(),
    incoterm: z.string().nullable().optional(),
    destination_country: z.string().nullable().optional(),
    invoice: z.string().nullable().optional(),
    due_number: z.string().nullable().optional(),
    gross_weight_kg: z.number().nullable().optional(),
    net_weight_kg: z.number().nullable().optional(),
    volume_m3: z.number().nullable().optional(),
    packages: z.array(z.record(z.string(), z.unknown())),
  }),
  "stock.balance_snapshot": z.object({
    snapshot_id: id,
    taken_at: dateTime,
    chunk: z.number().int().positive(),
    chunks: z.number().int().positive(),
    reason: z.enum(["daily_reconciliation", "initial_load", "on_demand"]),
    as_of_event_id: id.nullable(),
    items: z.array(
      z.object({
        ...productRef,
        orion_warehouse_code: z.string(),
        lot_code: z.string().nullable(),
        on_hand: quantity,
        reserved: quantity,
        blocked: quantity,
        in_quarantine: quantity,
      }),
    ),
  }),
} as const;

export type O2AType = keyof typeof O2A_PAYLOADS;
export const O2A_TYPES = Object.keys(O2A_PAYLOADS) as O2AType[];

// -----------------------------------------------------------------------------
// Respostas (3.4)
// -----------------------------------------------------------------------------

export const ERROR_CODES = [
  "invalid_envelope",
  "validation_failed",
  "idempotency_conflict",
  "invalid_signature",
  "stale_timestamp",
  "unknown_key",
  "company_mismatch",
  "company_not_linked",
  "integration_suspended",
  "out_of_order",
  "document_in_progress",
  "already_shipped",
  "dependency_missing",
  "unknown_reference",
  "unsupported_type",
  "payload_too_large",
  "rate_limited",
  "internal_error",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const acceptedResponseSchema = z.object({
  status: z.literal("accepted"),
  event_id: id,
  duplicate: z.boolean(),
});
export const rejectedResponseSchema = z.object({
  status: z.literal("rejected"),
  event_id: id.nullable(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    expected_sequence: z.number().int().optional(),
    details: z.array(z.object({ path: z.string(), issue: z.string() })).optional(),
  }),
});
export const responseSchema = z.union([acceptedResponseSchema, rejectedResponseSchema]);

// -----------------------------------------------------------------------------
// SSO (2.2) e checagem de acesso (2.7)
// -----------------------------------------------------------------------------

export const launchClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.literal(SSO_AUDIENCE), z.array(z.string()).refine((a) => a.includes(SSO_AUDIENCE))]),
  sub: id,
  iat: z.number().int(),
  nbf: z.number().int(),
  exp: z.number().int(),
  jti: id,
  atlas_company_id: id,
  orion_company_id: id,
  email: z.email(),
  name: z.string().min(1).max(120),
  orion_role: role,
  access_version: z.number().int().nonnegative(),
  warehouses: z.array(z.string()).optional().nullable(),
  return_to: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
});
export type LaunchClaims = z.infer<typeof launchClaimsSchema>;

export const launchHeaderSchema = z.object({ alg: z.literal("ES256"), typ: z.literal("JWT").optional(), kid: z.string().min(1) });

export const jwksSchema = z.object({
  keys: z
    .array(
      z.object({
        kty: z.literal("EC"),
        crv: z.literal("P-256"),
        kid: z.string().min(1),
        use: z.literal("sig").optional(),
        alg: z.literal("ES256").optional(),
        x: z.string(),
        y: z.string(),
      }),
    )
    .min(1),
});

export const accessCheckRequestSchema = z.object({
  method: z.literal("GET"),
  path: z.string().startsWith("/api/integrations/orion/v1/access?atlas_user_id="),
  headers: z.object({
    "X-Astraeus-Key-Id": z.string(),
    "X-Astraeus-Timestamp": z.string().regex(/^\d+$/),
    "X-Astraeus-Signature": z.string().startsWith("sha256="),
  }),
});

export const accessCheckResponseSchema = z.discriminatedUnion("active", [
  z.object({
    atlas_user_id: id,
    atlas_company_id: id,
    active: z.literal(true),
    orion_role: role,
    access_version: z.number().int().nonnegative(),
    email: z.email(),
    name: z.string().min(1),
    warehouses: z.array(z.string()).optional().nullable(),
    checked_at: dateTime,
  }),
  z.object({
    atlas_user_id: id,
    atlas_company_id: id,
    active: z.literal(false),
    reason: z.string(),
    access_version: z.number().int().nonnegative().optional(),
    checked_at: dateTime,
  }),
]);
export type AccessCheckResponse = z.infer<typeof accessCheckResponseSchema>;

/** Corpo de POST /api/atlas/v1/links (credencial de instalação) — fixture s2s.links.request.json. */
export const linkRequestSchema = z.object({
  atlas_company_id: id,
  /** URL pública do ATLAS que pediu o vínculo (informativa: o ORION confere com ATLAS_URL e registra). */
  atlas_url: z.url().optional().nullable(),
  key_id: z.string().min(3).max(120),
  secret: z.string().min(32).max(200),
  company: z.object({
    name: z.string().min(1).max(200),
    legal_name: nullableText,
    document: nullableText,
    email: nullableText,
    phone: nullableText,
    address: nullableText,
    city: nullableText,
    state: nullableText,
    zip_code: nullableText,
  }),
  admin: z
    .object({ atlas_user_id: id, email: z.email(), name: z.string().min(1).max(120) })
    .nullable()
    .optional(),
  /** Rotação: segredo anterior continua aceito por este número de horas (padrão 24). */
  previous_secret_hours: z.number().int().min(0).max(168).optional(),
});
export type LinkRequest = z.infer<typeof linkRequestSchema>;

/** Resposta de POST /api/atlas/v1/links (201 criado, 200 atualizado/rotacionado) — fixture s2s.links.response.json. */
export const linkResponseSchema = z.object({
  status: z.enum(["activating", "active", "suspended", "disabled"]),
  atlas_company_id: id,
  orion_company_id: id,
  key_id: z.string().min(3),
});

/** POST /api/atlas/v1/events/batch (alias legado /events:batch) — fixtures s2s.events-batch.*.json. */
export const batchRequestSchema = z.object({ events: z.array(z.unknown()).min(1).max(500) });
export const batchResponseSchema = z.object({
  status: z.literal("processed"),
  results: z.array(z.object({ http_status: z.number().int(), body: z.record(z.string(), z.unknown()) })),
});

/** Valida o payload de um tipo conhecido; devolve null se o tipo não for aceito. */
export function payloadSchemaFor(type: string): z.ZodType | null {
  return (A2O_PAYLOADS as Record<string, z.ZodType>)[type] ?? null;
}

/** Envelope do ORION a partir de um evento da outbox (formato do contrato + campos legados). */
export function buildOutboundEnvelope(e: {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_seq: number | null;
  company_id: string;
  created_at: string;
  attempts: number;
  payload: Record<string, unknown>;
  atlas_company_id: string;
}): Envelope {
  const created = new Date(e.created_at.includes("T") ? e.created_at : e.created_at.replace(" ", "T"));
  const iso = Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();
  return {
    id: e.id,
    type: e.event_type,
    version: CONTRACT_VERSION,
    source: "orion",
    atlas_company_id: e.atlas_company_id,
    orion_company_id: e.company_id,
    aggregate: { type: e.aggregate_type, id: e.aggregate_id, sequence: Number(e.aggregate_seq ?? 1) },
    occurred_at: iso,
    payload: e.payload,
    company_id: e.company_id,
    created_at: iso,
    attempt: e.attempts,
  };
}
