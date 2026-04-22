"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE_NAME, createGateToken } from "@/lib/gate-token";

const MAX_AGE_SEC = 60 * 60 * 24 * 7;

export type GateState = { error: string | null };

function verifyCodeAgainstStoredHash(code: string, expectedSha256Hex: string): boolean {
  const normalized = expectedSha256Hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return false;
  if (code.length > 4096) return false;
  const submittedHex = createHash("sha256").update(code, "utf8").digest("hex").toLowerCase();
  const a = Buffer.from(submittedHex, "hex");
  const b = Buffer.from(normalized, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function submitSecretCode(_prev: GateState, formData: FormData): Promise<GateState> {
  const code = formData.get("code");
  const nextRaw = formData.get("next");
  const nextPath =
    typeof nextRaw === "string" && nextRaw.startsWith("/") && !nextRaw.startsWith("//")
      ? nextRaw
      : "/";

  if (typeof code !== "string") {
    return { error: "Wrong code." };
  }

  const expectedHex = process.env.GATE_SECRET_SHA256?.trim();
  const sessionSecret = process.env.GATE_SESSION_SECRET?.trim();
  if (!expectedHex || !sessionSecret) {
    return { error: "This page is not set up yet." };
  }

  if (!verifyCodeAgainstStoredHash(code, expectedHex)) {
    return { error: "Wrong code." };
  }

  const token = await createGateToken(sessionSecret, MAX_AGE_SEC);
  const jar = await cookies();
  jar.set(GATE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });

  redirect(nextPath);
}

export async function leaveSite() {
  const jar = await cookies();
  jar.set(GATE_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  redirect("/login");
}
