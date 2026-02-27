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
  const { fieldName, folder } = options;

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

    const result = await cloudinary.uploader.upload(fileObj.filepath, {
      folder: folderValue,
      // Basic compression / optimization
      transformation: [
        {
          quality: "auto:good",
          fetch_format: "auto",
        },
      ],
    });

    ctx.state.uploadedFile = {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
    };

    await next();
  };

  return middleware;
}

