/**
 * Auth and user-admin HTTP routes for @fusion/server.
 *
 * Mounted on the Fastify instance. All routes follow the path conventions
 * from spec 05-usuarios-e-permissoes.md API table.
 *
 * Routes:
 *   POST  /api/auth/login
 *   POST  /api/auth/refresh
 *   POST  /api/auth/logout
 *   GET   /api/world                (public world info)
 *   GET   /api/users                (GM only)
 *   POST  /api/users                (GM only)
 *   PATCH /api/users/:id            (GM only)
 *   POST  /api/users/:id/reset-password (GM only)
 *   DELETE /api/users/:id           (GM only — soft delete, active=false)
 *   POST  /api/users/:id/kick       (GM only)
 *
 * REQ-USR-017..030, REQ-SEC-014, REQ-SEC-056, REQ-SEC-058
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { type AuthService, AuthError } from "./service.js";
import { Role } from "./user-store.js";
import type { UserPublic } from "./user-store.js";

// ---------------------------------------------------------------------------
// Cookie name
// ---------------------------------------------------------------------------

const REFRESH_COOKIE = "fusion_refresh";

/**
 * Build cookie options for the refresh token.
 *
 * REQ-SEC-056 / DEC-SEC-04: Secure flag is set when the server sits behind a
 * TLS-terminating proxy (trustProxy=true) or when secureCookies is explicitly
 * set to true.  When running plain HTTP on a LAN (the default for desktop use)
 * the Secure flag must NOT be set or the browser will silently drop the cookie.
 */
function buildCookieOptions(secureCookies: boolean) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    ...(secureCookies ? { secure: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Zod schemas for request validation (REQ-SEC-036)
// ---------------------------------------------------------------------------

const LoginBodySchema = z.object({
  userId: z.string().min(1),
  password: z.string().optional(),
});

const CreateUserBodySchema = z.object({
  name: z.string().min(1).max(64),
  role: z.nativeEnum(Role),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  password: z.string().min(1).optional(),
});

const UpdateUserBodySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  role: z.nativeEnum(Role).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  avatar: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const ResetPasswordBodySchema = z.object({
  newPassword: z.string().min(1).optional(),
  removePassword: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Auth context added to Fastify request via decorator
// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    /** Authenticated user, set by requireAuth hook. */
    authUser?: UserPublic;
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface RegisterAuthRoutesOptions {
  /** AuthService instance for the currently open world. */
  authService: AuthService;
  /** World manifest info for the GET /api/world endpoint. */
  worldInfo: {
    id: string;
    title: string;
    systemId: string;
  };
  /**
   * When true, the server sits behind a trusted proxy that injects
   * X-Forwarded-For. Only set when Fastify is created with trustProxy=true.
   * Default: false — uses request.ip directly (DEC-SEC-04).
   */
  trustProxy?: boolean;
  /**
   * When true, the refresh token cookie will include the Secure flag.
   *
   * REQ-SEC-056 / DEC-SEC-04: Set this when the server is behind a TLS
   * proxy (e.g. nginx, Caddy). Must be false (default) for plain HTTP LAN
   * deployments — browsers silently discard Secure cookies over HTTP.
   *
   * Defaults to false for backward compatibility and safe desktop use.
   * When trustProxy=true this should typically also be true.
   */
  secureCookies?: boolean;
}

/**
 * Register all auth + user-admin routes on the given Fastify instance.
 */
export function registerAuthRoutes(
  fastify: FastifyInstance,
  options: RegisterAuthRoutesOptions,
): void {
  const { authService, worldInfo, trustProxy = false, secureCookies = false } = options;
  const cookieOptions = buildCookieOptions(secureCookies);

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Validate a Zod schema against an unknown body; throw 400 on failure. */
  function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
    const result = schema.safeParse(body);
    if (!result.success) {
      void reply.code(400).send({
        ok: false,
        code: "VALIDATION_FAILED",
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return null;
    }
    return result.data;
  }

  /** Require a valid Bearer access token; sets request.authUser. */
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers["authorization"];
    if (!header?.startsWith("Bearer ")) {
      void reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Missing token." });
      return;
    }
    const token = header.slice(7);
    const user = await authService.verifyAccessToken(token);
    if (!user) {
      void reply.code(401).send({ ok: false, code: "UNAUTHORIZED", message: "Invalid token." });
      return;
    }
    request.authUser = user;
  }

  /** Require GAMEMASTER role; must be called after requireAuth. */
  function requireGm(request: FastifyRequest, reply: FastifyReply): boolean {
    if (!request.authUser || request.authUser.role !== Role.GAMEMASTER) {
      void reply.code(403).send({
        ok: false,
        code: "PERMISSION_DENIED",
        message: "Only the Gamemaster can perform this action.",
      });
      return false;
    }
    return true;
  }

  /**
   * Extract client IP for lockout keying.
   *
   * REQ-SEC-011 / DEC-SEC-04: only trust X-Forwarded-For when Fastify was
   * created with trustProxy=true (i.e. `options.trustProxy` is set). In the
   * default direct/tunnel deployment an attacker can spoof XFF to rotate the
   * (userId, ip) lockout key — so we ignore it unless the proxy is trusted.
   *
   * When trustProxy=true Fastify resolves request.ip from XFF automatically,
   * so we can always read `request.ip` unconditionally.
   */
  function clientIp(request: FastifyRequest): string {
    if (trustProxy) {
      // Fastify has already resolved the real IP from XFF via trustProxy.
      return request.ip;
    }
    // No trusted proxy: use the direct connection IP, ignore XFF header.
    return request.socket.remoteAddress ?? request.ip;
  }

  // --------------------------------------------------------------------------
  // GET /api/world — public world info (REQ-USR-037)
  // --------------------------------------------------------------------------

  fastify.get("/api/world", async (_request, reply) => {
    const users = authService.getJoinInfo();
    return reply.send({
      ok: true,
      world: {
        id: worldInfo.id,
        title: worldInfo.title,
        systemId: worldInfo.systemId,
        users,
      },
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/auth/login (REQ-USR-019)
  // --------------------------------------------------------------------------

  fastify.post("/api/auth/login", async (request, reply) => {
    const body = parseBody(LoginBodySchema, request.body, reply);
    if (!body) return;

    try {
      const loginParams: { userId: string; ip: string; password?: string } = {
        userId: body.userId,
        ip: clientIp(request),
      };
      if (body.password !== undefined) loginParams.password = body.password;
      const result = await authService.login(loginParams);

      reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

      return await reply.code(200).send({
        ok: true,
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === "LOCKED_OUT") {
          const retryAfterSec = err.retryAfter
            ? Math.ceil((err.retryAfter.getTime() - Date.now()) / 1000)
            : 900;
          void reply.header("Retry-After", String(retryAfterSec));
          return reply.code(429).send({ ok: false, code: err.code, message: err.message });
        }
        if (err.code === "USER_INACTIVE") {
          return reply.code(403).send({ ok: false, code: err.code, message: err.message });
        }
        // INVALID_CREDENTIALS → 401 (uniform message per REQ-SEC-012)
        return reply
          .code(401)
          .send({ ok: false, code: "INVALID_CREDENTIALS", message: "Invalid credentials." });
      }
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/auth/refresh (REQ-USR-020)
  // --------------------------------------------------------------------------

  fastify.post("/api/auth/refresh", async (request, reply) => {
    const rawToken: string | undefined =
      typeof request.cookies[REFRESH_COOKIE] === "string"
        ? request.cookies[REFRESH_COOKIE]
        : undefined;

    if (!rawToken) {
      return reply
        .code(401)
        .send({ ok: false, code: "TOKEN_INVALID", message: "No refresh token." });
    }

    try {
      const result = await authService.refresh(rawToken);

      // Rotate cookie
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

      return await reply.code(200).send({
        ok: true,
        accessToken: result.accessToken,
        user: result.user,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        // Clear the cookie on any refresh failure
        reply.clearCookie(REFRESH_COOKIE, { path: "/" });
        return reply.code(401).send({ ok: false, code: err.code, message: err.message });
      }
      throw err;
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/auth/logout (REQ-USR-022)
  // --------------------------------------------------------------------------

  fastify.post(
    "/api/auth/logout",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const rawToken: string | undefined =
        typeof request.cookies[REFRESH_COOKIE] === "string"
          ? request.cookies[REFRESH_COOKIE]
          : undefined;

      if (rawToken) {
        authService.logout(rawToken);
      }

      reply.clearCookie(REFRESH_COOKIE, { path: "/" });
      return reply.code(200).send({ ok: true });
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/users (GM only, REQ-USR-025)
  // --------------------------------------------------------------------------

  fastify.get(
    "/api/users",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;
      return reply.send({ ok: true, users: authService.listUsers() });
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/users (GM only, REQ-USR-025)
  // --------------------------------------------------------------------------

  fastify.post(
    "/api/users",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;

      const body = parseBody(CreateUserBodySchema, request.body, reply);
      if (!body) return;

      try {
        const createParams: { name: string; role: Role; color?: string; password?: string } = {
          name: body.name,
          role: body.role,
        };
        if (body.color !== undefined) createParams.color = body.color;
        if (body.password !== undefined) createParams.password = body.password;
        const { user } = await authService.createUser(createParams);
        return await reply.code(201).send({ ok: true, user });
      } catch (err) {
        if (err instanceof AuthError && err.code === "NAME_TAKEN") {
          return reply.code(409).send({ ok: false, code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // --------------------------------------------------------------------------
  // PATCH /api/users/:id (GM only, REQ-USR-026)
  // --------------------------------------------------------------------------

  fastify.patch(
    "/api/users/:id",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;

      const { id } = request.params as { id: string };
      const body = parseBody(UpdateUserBodySchema, request.body, reply);
      if (!body) return;

      try {
        const patchParams: Partial<{
          name: string;
          role: Role;
          color: string;
          avatar: string | null;
          active: boolean;
        }> = {};
        if (body.name !== undefined) patchParams.name = body.name;
        if (body.role !== undefined) patchParams.role = body.role;
        if (body.color !== undefined) patchParams.color = body.color;
        if ("avatar" in body) patchParams.avatar = body.avatar ?? null;
        if (body.active !== undefined) patchParams.active = body.active;
        const user = authService.updateUser(id, patchParams);
        return await reply.send({ ok: true, user });
      } catch (err) {
        if (err instanceof AuthError) {
          if (err.code === "USER_NOT_FOUND") {
            return reply.code(404).send({ ok: false, code: err.code, message: err.message });
          }
          if (err.code === "LAST_GM") {
            return reply.code(400).send({ ok: false, code: err.code, message: err.message });
          }
        }
        throw err;
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/users/:id/reset-password (GM only, REQ-USR-027)
  // --------------------------------------------------------------------------

  fastify.post(
    "/api/users/:id/reset-password",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;

      const { id } = request.params as { id: string };
      const body = parseBody(ResetPasswordBodySchema, request.body, reply);
      if (!body) return;

      try {
        const resetOpts: { newPassword?: string; removePassword?: boolean } = {};
        if (body.newPassword !== undefined) resetOpts.newPassword = body.newPassword;
        if (body.removePassword !== undefined) resetOpts.removePassword = body.removePassword;
        const result = await authService.resetPassword(id, resetOpts);
        return await reply.send({ ok: true, password: result.password });
      } catch (err) {
        if (err instanceof AuthError && err.code === "USER_NOT_FOUND") {
          return reply.code(404).send({ ok: false, code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // --------------------------------------------------------------------------
  // DELETE /api/users/:id — soft-delete (active=false) (REQ-USR-028)
  // --------------------------------------------------------------------------

  fastify.delete(
    "/api/users/:id",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;

      const { id } = request.params as { id: string };

      try {
        authService.updateUser(id, { active: false });
        return await reply.send({ ok: true });
      } catch (err) {
        if (err instanceof AuthError) {
          if (err.code === "USER_NOT_FOUND") {
            return reply.code(404).send({ ok: false, code: err.code, message: err.message });
          }
          if (err.code === "LAST_GM") {
            return reply.code(400).send({ ok: false, code: err.code, message: err.message });
          }
        }
        throw err;
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/users/:id/kick (GM only, REQ-USR-029)
  // --------------------------------------------------------------------------

  fastify.post(
    "/api/users/:id/kick",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      if (!requireGm(request, reply)) return;

      const { id } = request.params as { id: string };

      try {
        authService.kickUser(id);
        return await reply.send({ ok: true });
      } catch (err) {
        if (err instanceof AuthError && err.code === "USER_NOT_FOUND") {
          return reply.code(404).send({ ok: false, code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
}
