import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import type { Ctx, SessionUser } from "../context";
import { createToken, verifyToken } from "./token";
import { loadSessionUser } from "./users";

export const SESSION_COOKIE = "orion_session";
const TTL_SECONDS = 60 * 60 * 12; // 12 horas (um turno)

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createToken(userId, TTL_SECONDS), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.WMS_INSECURE_COOKIES !== "true",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Usuário da requisição atual; recarregado do banco (perfil/inativação têm efeito imediato). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const payload = verifyToken(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const db = await getDb();
  return loadSessionUser(db, payload.uid);
});

/** Contexto autenticado para páginas e ações; redireciona ao login se não houver sessão. */
export async function requireCtx(): Promise<Ctx> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return { db: await getDb(), user };
}
