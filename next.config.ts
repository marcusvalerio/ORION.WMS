import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite carrega arquivos WASM em tempo de execução e o driver pg usa módulos nativos opcionais.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  agentRules: false,
  outputFileTracingIncludes: { "/**": ["./supabase/migrations/*.sql"] },
};

export default nextConfig;
