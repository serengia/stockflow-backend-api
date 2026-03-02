import Router from "@koa/router";
import type { Context } from "koa";
import { z } from "zod";
import { requireAuth, type AuthState } from "../middleware/auth.js";
import * as branchesService from "../services/branches.service.js";

interface RequestWithBody {
  body?: unknown;
}

const createBranchBody = z.object({
  name: z.string().min(1, "Name is required").max(255),
  code: z.string().min(1, "Code is required").max(100),
});

const updateBranchBody = z
  .object({
    name: z.string().min(1, "Name is required").max(255).optional(),
    code: z.string().min(1, "Code is required").max(100).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.code !== undefined || data.active !== undefined,
    {
      message: "At least one field (name, code, active) must be provided",
    },
  );

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return (issue && "message" in issue ? String(issue.message) : undefined) ?? "Validation failed";
}

export const branchesRouter = new Router({ prefix: "/branches" });

branchesRouter.use(requireAuth as unknown as Router.Middleware<unknown, AuthState>);

branchesRouter.get("/", async (ctx: Context & { state: AuthState }) => {
  const { user } = ctx.state;

  const list = await branchesService.listBranches({ businessId: user.businessId });

  ctx.status = 200;
  ctx.body = {
    data: list.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      active: b.active,
    })),
  };
});

branchesRouter.post("/", async (ctx: Context & { state: AuthState }) => {
  const body = (ctx.request as RequestWithBody).body;
  const parsed = createBranchBody.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { user } = ctx.state;
  const branch = await branchesService.createBranch({
    businessId: user.businessId,
    name: parsed.data.name,
    code: parsed.data.code,
  });

  ctx.status = 201;
  ctx.body = {
    data: {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      active: branch.active,
    },
  };
});

branchesRouter.get("/:id", async (ctx: Context & { state: AuthState }) => {
  const { id } = ctx.params;
  const branchId = Number(id);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    ctx.status = 400;
    ctx.body = {
      message: "Invalid branch id",
      error: { message: "Invalid branch id" },
    };
    return;
  }

  const { user } = ctx.state;
  const branch = await branchesService.getBranchById({
    id: branchId,
    businessId: user.businessId,
  });

  if (!branch) {
    ctx.status = 404;
    ctx.body = {
      message: "Branch not found",
      error: { message: "Branch not found" },
    };
    return;
  }

  ctx.status = 200;
  ctx.body = {
    data: {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      active: branch.active,
    },
  };
});

branchesRouter.patch("/:id", async (ctx: Context & { state: AuthState }) => {
  const { id } = ctx.params;
  const branchId = Number(id);

  if (!Number.isInteger(branchId) || branchId <= 0) {
    ctx.status = 400;
    ctx.body = {
      message: "Invalid branch id",
      error: { message: "Invalid branch id" },
    };
    return;
  }

  const body = (ctx.request as RequestWithBody).body;
  const parsed = updateBranchBody.safeParse(body);

  if (!parsed.success) {
    ctx.status = 400;
    const msg = firstIssueMessage(parsed.error);
    ctx.body = { message: msg, error: { message: msg } };
    return;
  }

  const { user } = ctx.state;

  const branch = await branchesService.updateBranch({
    id: branchId,
    businessId: user.businessId,
    name: parsed.data.name,
    code: parsed.data.code,
    active: parsed.data.active,
  });

  ctx.status = 200;
  ctx.body = {
    data: {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      active: branch.active,
    },
  };
});

