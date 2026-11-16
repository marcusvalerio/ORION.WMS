/** Mensagens (pt-BR) das recusas do login pelo ATLAS; o motivo técnico fica só na auditoria. */
export const SSO_ERROR_MESSAGES: Record<string, string> = {
  token_expired: "O link de acesso expirou. Abra o ORION novamente pelo ATLAS.",
  token_replayed: "Este link de acesso já foi usado. Abra o ORION novamente pelo ATLAS.",
  state_mismatch: "A sessão de login não confere. Clique em “Entrar com ATLAS” novamente.",
  company_not_linked: "Sua empresa não está vinculada ao ORION ou a integração está suspensa.",
  access_revoked: "Seu acesso ao ORION foi revogado ou alterado no ATLAS.",
  session_expired: "Sua sessão do ATLAS precisa ser renovada. Entre novamente pelo ATLAS.",
  sso_disabled: "Login pelo ATLAS não configurado neste servidor.",
  jwks_unavailable: "Não foi possível validar o acesso com o ATLAS agora. Tente novamente em instantes.",
  default: "Não foi possível entrar com o ATLAS. Tente novamente pelo menu do ATLAS.",
};
