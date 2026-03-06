import Router from "@koa/router";
import { and, eq } from "drizzle-orm";

import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { createCloudinaryUploadMiddleware, multipartBody, AVATAR_EAGER } from "../middleware/cloudinaryUpload.js";
import type { AuthUser } from "../services/auth.service.js";
import { db } from "../db/index.js";
import { users, products } from "../db/schema/schema.js";
import { cloudinary } from "../lib/cloudinary.js";

export const uploadsRouter = new Router({
  prefix: "/uploads",
});

// POST /api/v1/uploads/profile-photo — upload to Cloudinary, then update user record (url + publicId)
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
    eager: AVATAR_EAGER,
  }),
  async (ctx) => {
    const file = ctx.state.uploadedFile;
    const currentUser = ctx.state.user as AuthUser;
    if (!file) {
      ctx.throw(500, "Upload failed");
      return;
    }

    const [existing] = await db
      .select({ avatarPublicId: users.avatarPublicId })
      .from(users)
      .where(eq(users.id, currentUser.id))
      .limit(1);

    if (existing?.avatarPublicId) {
      try {
        await cloudinary.uploader.destroy(existing.avatarPublicId, { resource_type: "image" });
      } catch (err) {
        console.error("[uploads] Failed to delete old avatar from Cloudinary:", err);
        // Continue: still update user with new image
      }
    }

    await db
      .update(users)
      .set({
        avatarUrl: file.url,
        avatarPublicId: file.publicId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, currentUser.id));

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

// DELETE /api/v1/uploads/profile-photo — remove current user's avatar (Cloudinary + DB)
uploadsRouter.delete("/profile-photo", requireAuth, async (ctx) => {
  const currentUser = ctx.state.user as AuthUser;
  const [existing] = await db
    .select({ avatarPublicId: users.avatarPublicId })
    .from(users)
    .where(eq(users.id, currentUser.id))
    .limit(1);

  if (existing?.avatarPublicId) {
    try {
      await cloudinary.uploader.destroy(existing.avatarPublicId, { resource_type: "image" });
    } catch (err) {
      console.error("[uploads] Failed to delete avatar from Cloudinary:", err);
    }
  }

  await db
    .update(users)
    .set({
      avatarUrl: null,
      avatarPublicId: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, currentUser.id));

  ctx.status = 200;
  ctx.body = { status: "success", data: { message: "Profile photo removed" } };
});

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
    const currentUser = ctx.state.user as AuthUser;
    if (!file) {
      ctx.throw(500, "Upload failed");
      return;
    }

    const productIdParam = ctx.params.productId;
    const productId = Number(productIdParam);
    if (!Number.isFinite(productId) || productId <= 0) {
      // Clean up uploaded file if product id is invalid
      try {
        await cloudinary.uploader.destroy(file.publicId, { resource_type: "image" });
      } catch (err) {
        console.error("[uploads] Failed to delete orphaned product image:", err);
      }
      ctx.throw(400, "Invalid product id");
      return;
    }

    const [existing] = await db
      .select({
        id: products.id,
        imagePublicId: products.imagePublicId,
      })
      .from(products)
      .where(
        and(
          eq(products.id, productId),
          eq(products.businessId, currentUser.businessId),
        ),
      )
      .limit(1);

    if (!existing) {
      // Product not found for this business; clean up uploaded asset
      try {
        await cloudinary.uploader.destroy(file.publicId, { resource_type: "image" });
      } catch (err) {
        console.error("[uploads] Failed to delete orphaned product image:", err);
      }
      ctx.throw(404, "Product not found");
      return;
    }

    if (existing.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.imagePublicId, {
          resource_type: "image",
        });
      } catch (err) {
        console.error(
          "[uploads] Failed to delete old product image from Cloudinary:",
          err,
        );
      }
    }

    await db
      .update(products)
      .set({
        imageUrl: file.url,
        imagePublicId: file.publicId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(products.id, productId),
          eq(products.businessId, currentUser.businessId),
        ),
      );

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

// DELETE /api/v1/uploads/products/:productId/image — remove product image (Cloudinary + DB)
uploadsRouter.delete("/products/:productId/image", requireAuth, async (ctx) => {
  const currentUser = ctx.state.user as AuthUser;
  const productId = Number(ctx.params.productId);
  if (!Number.isFinite(productId) || productId <= 0) {
    ctx.status = 400;
    ctx.body = { message: "Invalid product id", error: { message: "Invalid product id" } };
    return;
  }

  const [existing] = await db
    .select({
      id: products.id,
      imagePublicId: products.imagePublicId,
    })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.businessId, currentUser.businessId),
      ),
    )
    .limit(1);

  if (!existing) {
    ctx.status = 404;
    ctx.body = { message: "Product not found", error: { message: "Product not found" } };
    return;
  }

  if (existing.imagePublicId) {
    try {
      await cloudinary.uploader.destroy(existing.imagePublicId, {
        resource_type: "image",
      });
    } catch (err) {
      console.error(
        "[uploads] Failed to delete product image from Cloudinary:",
        err,
      );
    }
  }

  await db
    .update(products)
    .set({
      imageUrl: null,
      imagePublicId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, productId),
        eq(products.businessId, currentUser.businessId),
      ),
    );

  ctx.status = 200;
  ctx.body = {
    status: "success",
    data: { message: "Product image removed" },
  };
});

