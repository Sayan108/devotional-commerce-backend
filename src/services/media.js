import { access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { HttpError } from "./common.js";

export async function existingImage(path, required = false, config = {}) {
  if (!path && !required) return;
  if (config.cloudName && /^[a-zA-Z0-9_-]+$/.test(config.cloudName) && path.startsWith(`https://res.cloudinary.com/${config.cloudName}/image/upload/`)) {
    const url = new URL(path);
    if (!url.search && !url.hash && new RegExp(`^/${config.cloudName}/image/upload/v[0-9]+/${config.folder}/[A-Za-z0-9_-]+\\.(jpg|jpeg|png|webp)$`).test(url.pathname)) return;
    throw new HttpError(400, "INVALID_IMAGE", "Choose an image uploaded to the Naivedya folder.");
  }
  if (!/^\/media\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(path)) {
    throw new HttpError(400, "INVALID_IMAGE", "Choose an existing /media/ image path.");
  }
  try {
    await access(new URL("../../public" + path, import.meta.url));
  } catch (error) {
    if (error.code === "ENOENT") throw new HttpError(400, "INVALID_IMAGE", "The image does not exist on the server.");
    throw error;
  }
}

export async function uploadImage(data, type, config) {
    const { cloudName, apiKey, apiSecret, folder } = config;
    if (!cloudName || !apiKey || !apiSecret) throw new HttpError(503, "MEDIA_UNAVAILABLE", "Cloudinary is not configured on the server.");
    if (!/^[a-zA-Z0-9_-]+$/.test(cloudName)) throw new Error("Invalid Cloudinary cloud name.");
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > 5 * 1024 * 1024) {
      throw new HttpError(400, "INVALID_IMAGE", "Choose an image smaller than 5 MB.");
    }
    const jpeg = data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const png = data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    const webp = data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP";
    if (!((type === "image/jpeg" && jpeg) || (type === "image/png" && png) || (type === "image/webp" && webp))) {
      throw new HttpError(400, "INVALID_IMAGE", "Choose a JPEG, PNG, or WebP image.");
    }
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");
    const form = new FormData();
    form.append("file", new Blob([data], { type }), "image");
    form.append("folder", folder);
    form.append("timestamp", timestamp);
    form.append("api_key", apiKey);
    form.append("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST", body: form, signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new HttpError(502, "MEDIA_UPLOAD_FAILED", "Image upload failed. Check Cloudinary configuration and try again.");
    const result = await response.json();
    if (typeof result.secure_url !== "string") throw new HttpError(502, "MEDIA_UPLOAD_FAILED", "Cloudinary returned an invalid image URL.");
    await existingImage(result.secure_url, true, config);
    return { url: result.secure_url };
}
