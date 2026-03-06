import type { Context, Middleware } from "koa";
import { koaBody } from "koa-body";

import { cloudinary } from "../lib/cloudinary.js";

// Cast needed: koa-body's Middleware uses its own @types/koa, which conflicts with project @types/koa
export const multipartBody = koaBody({
  multipart: true,
  formidable: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
  },
}) as unknown as Middleware;

/** Eager transformation for profile avatars: resize and compress. */
export const AVATAR_EAGER = [
  {
    width: 400,
    height: 400,
    crop: "fill",
    gravity: "face",
    quality: "auto:good",
    fetch_format: "auto",
  },
];

type CloudinaryUploadOptions = {
  /**
   * Name of the file input field in the multipart form.
   * e.g. "avatar", "image", "file"
   */
  fieldName: string;
  /**
   * Cloudinary folder to store the file in.
   * Can be a static string or derived dynamically from the request context.
   */
  folder: string | ((ctx: Context) => string);
  /**
   * Optional eager transformations. If provided, the first transformation's secure_url
   * is used (e.g. for profile avatars to store a compressed 400x400 version).
   */
  eager?: Array<Record<string, unknown>>;
};

declare module "koa" {
  interface DefaultState {
    uploadedFile?: {
      url: string;
      publicId: string;
      resourceType: string;
    };
  }
}

export function createCloudinaryUploadMiddleware(
  options: CloudinaryUploadOptions,
): Middleware {
  const { fieldName, folder, eager } = options;

  const middleware: Middleware = async (ctx, next) => {
    const anyCtx = ctx as any;
    const files = anyCtx.request.files ?? {};
    const file = files[fieldName];

    if (!file) {
      ctx.throw(400, `No file provided for field "${fieldName}"`);
    }

    const fileObj = Array.isArray(file) ? file[0] : file;

    if (!fileObj.filepath) {
      ctx.throw(400, "Invalid file upload payload");
    }

    const folderValue = typeof folder === "function" ? folder(ctx) : folder;

    const uploadOptions: Record<string, unknown> = {
      folder: folderValue,
      quality: "auto:good",
      fetch_format: "auto",
    };
    if (eager && eager.length > 0) {
      uploadOptions.eager = eager;
    }

    const result = await cloudinary.uploader.upload(fileObj.filepath, uploadOptions as any);

    // If eager was used, prefer the first eager URL (resized/compressed); otherwise use original.
    const url =
      result.eager?.[0]?.secure_url ?? result.secure_url;

    ctx.state.uploadedFile = {
      url,
      publicId: result.public_id,
      resourceType: result.resource_type,
    };

    await next();
  };

  return middleware;
}

