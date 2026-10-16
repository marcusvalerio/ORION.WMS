/** Erro de regra de negócio: a mensagem é segura para exibir ao usuário. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = "BUSINESS_RULE",
    public readonly field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class PermissionError extends DomainError {
  constructor(message = "Você não tem permissão para executar esta ação.") {
    super(message, "FORBIDDEN");
    this.name = "PermissionError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super(`${entity} não encontrado(a).`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

const PG_MESSAGES: Record<string, string> = {
  "23514": "A operação violaria uma regra de integridade do estoque (saldo negativo, reserva ou bloqueio acima do físico).",
  "23505": "Registro duplicado: já existe um registro com estes dados.",
  "23503": "Referência inválida: o registro relacionado não existe ou está em uso.",
  P0001: "Operação não permitida pelo banco de dados.",
};

/** Converte qualquer erro em mensagem amigável, sem vazar detalhes internos. */
export function toUserMessage(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  const code = (error as { code?: string } | null)?.code;
  if (code && PG_MESSAGES[code]) {
    const detail = (error as { message?: string }).message;
    return code === "P0001" && detail ? detail : PG_MESSAGES[code];
  }
  return "Erro inesperado ao processar a operação. Tente novamente ou contate o suporte.";
}
