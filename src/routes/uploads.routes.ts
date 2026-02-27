import Router from "@koa/router";

import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { createCloudinaryUploadMiddleware, multipartBody } from "../middleware/cloudinaryUpload.js";

export const uploadsRouter = new Router({
  prefix: "/uploads",
});

// POST /api/v1/uploads/profile-photo
uploadsRouter.post(
  "/profile-photo",
  requireAuth,
  multipartBody,
  createCloudinaryUploadMiddleware({
    fieldName: "file",
    folder: (ctx) => {
      const user = ctx.state.user;
      if (!user) {
        ctx.throw(401, "Authentication required");
      }
      return `env/${env.nodeEnv}/users/${user.id}/avatar`;
    },
  }),
  async (ctx) => {
    const file = ctx.state.uploadedFile;
    if (!file) {
      ctx.throw(500, "Upload failed");
      return;
    }

    ctx.status = 201;
    ctx.body = {
      status: "success",
      data: {
        url: file.url,
        publicId: file.publicId,
      },
    };
  },
);

// POST /api/v1/uploads/products/:productId/image
uploadsRouter.post(
  "/products/:productId/image",
  requireAuth,
  multipartBody,
  createCloudinaryUploadMiddleware({
    fieldName: "file",
    folder: (ctx) => {
      const user = ctx.state.user;
      if (!user) {
        ctx.throw(401, "Authentication required");
      }
      const productId = ctx.params.productId;
      if (!productId) {
        ctx.throw(400, "productId is required in the route");
      }
      return `env/${env.nodeEnv}/businesses/${user.businessId}/products/${productId}/images`;
    },
  }),
  async (ctx) => {
    const file = ctx.state.uploadedFile;
    if (!file) {
      ctx.throw(500, "Upload failed");
      return;
    }

    ctx.status = 201;
    ctx.body = {
      status: "success",
      data: {
        url: file.url,
        publicId: file.publicId,
      },
    };
  },
);

