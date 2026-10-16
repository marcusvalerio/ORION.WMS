"use server";

import { redirect } from "next/navigation";
import { getDb } from "../db";
import { authenticate } from "../auth/users";
import { endSession, getSessionUser, startSession } from "../auth/session";
import type { ActionState } from "@/lib/action-state";

export async function loginAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, message: "Informe e-mail e senha.", ts: Date.now() };
  const db = await getDb();
  const user = await authenticate(db, email, password);
  if (!user) return { ok: false, message: "E-mail ou senha inválidos.", ts: Date.now() };
  await startSession(user.id);
  await db.query(
    `insert into wms.audit_log (company_id, user_id, action, entity_type, entity_id, entity_code) values ($1, $2, 'auth.login', 'user', $2, $3)`,
    [user.companyId, user.id, user.email],
  );
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) {
    const db = await getDb();
    await db.query(
      `insert into wms.audit_log (company_id, user_id, action, entity_type, entity_id, entity_code) values ($1, $2, 'auth.logout', 'user', $2, $3)`,
      [user.companyId, user.id, user.email],
    );
  }
  await endSession();
  redirect("/login");
}
