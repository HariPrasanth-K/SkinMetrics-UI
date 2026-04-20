// src/awsConfig.js
// YOUR bucket structure:
//   mltrainingodf/dataset/acne/          ← images directly here (no raw/ subfolder yet)
//   mltrainingodf/dataset/pigment/
//   mltrainingodf/dataset/wrinkles/
//   rPPG model: mltrainingodf/open_rppg_models/open-rppg/SCAMPS/SCAMPS_DeepPhys.pth

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SageMakerRuntimeClient,
  InvokeEndpointCommand,
} from "@aws-sdk/client-sagemaker-runtime";

// ── Env ───────────────────────────────────────────────────────────────────────
export const AWS_REGION = import.meta.env.VITE_AWS_REGION || "ap-south-1";
export const S3_BUCKET  = import.meta.env.VITE_S3_BUCKET  || "";

// ⚠️ Set this to match YOUR exact S3 folder name
// Your bucket has:  mltrainingodf/dataset/acne/   (no 's' at end)
export const S3_PREFIX  = "datasets";   // ← "dataset" not "datasets"

export const RPPG_MODEL_KEY = "open_rppg_models/open-rppg/SCAMPS/SCAMPS_DeepPhys.pth";

const ACCESS_KEY = import.meta.env.VITE_AWS_ACCESS_KEY_ID     || "";
const SECRET_KEY = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || "";

export const SKIN_ENDPOINTS = {
  acne:     import.meta.env.VITE_ENDPOINT_ACNE     || "",
  pigment:  import.meta.env.VITE_ENDPOINT_PIGMENT  || "",
  wrinkles: import.meta.env.VITE_ENDPOINT_WRINKLES || "",
  others:   import.meta.env.VITE_ENDPOINT_OTHERS   || "",
};

export const RPPG_ENDPOINT = import.meta.env.VITE_RPPG_ENDPOINT || "";

// ── AWS Clients ───────────────────────────────────────────────────────────────
const credentials = { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY };
export const s3        = new S3Client({ region: AWS_REGION, credentials });
export const sagemaker = new SageMakerRuntimeClient({ region: AWS_REGION, credentials });

// ── List ALL keys under a prefix (handles pagination) ─────────────────────────
export async function listAllKeys(prefix) {
  const all = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    all.push(...(res.Contents || []).map(o => o.Key));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return all;
}

// ── List only image keys ──────────────────────────────────────────────────────
export async function listImages(prefix) {
  const keys = await listAllKeys(prefix);
  return keys.filter(k => /\.(jpe?g|png|webp|bmp)$/i.test(k));
}

// ── List only JSON keys ───────────────────────────────────────────────────────
export async function listJsons(prefix) {
  const keys = await listAllKeys(prefix);
  return keys.filter(k => k.endsWith(".json"));
}

// ── Pre-signed URL (1 hour) ───────────────────────────────────────────────────
export async function presign(key) {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 });
}

// ── Fetch and parse JSON from S3 ─────────────────────────────────────────────
export async function fetchJson(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const reader = res.Body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let len = 0; chunks.forEach(c => len += c.length);
  const merged = new Uint8Array(len);
  let off = 0; chunks.forEach(c => { merged.set(c, off); off += c.length; });
  return JSON.parse(new TextDecoder().decode(merged));
}

// ── Download raw bytes (for SageMaker) ───────────────────────────────────────
export async function getBytes(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const reader = res.Body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ── SageMaker: invoke endpoint ────────────────────────────────────────────────
export async function invokeEndpoint(endpointName, body, contentType = "image/jpeg") {
  if (!endpointName) throw new Error("Endpoint name not configured.");
  const res = await sagemaker.send(new InvokeEndpointCommand({
    EndpointName: endpointName,
    ContentType: contentType,
    Body: body,
  }));
  const text = new TextDecoder().decode(res.Body);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ── SageMaker: invoke rPPG endpoint ──────────────────────────────────────────
export async function invokeRppg(videoBlob, endpointName) {
  const ep = endpointName || RPPG_ENDPOINT;
  const ab = await videoBlob.arrayBuffer();
  return invokeEndpoint(ep, new Uint8Array(ab), videoBlob.type || "video/webm");
}

// ── Build S3 path ─────────────────────────────────────────────────────────────
// Flexible: if subfolder is empty, just returns  dataset/acne/
// If subfolder given, returns  dataset/acne/raw/
export function buildPath(category, subfolder = "") {
  if (subfolder) return `${S3_PREFIX}/${category}/${subfolder}/`;
  return `${S3_PREFIX}/${category}/`;
}

// ── Debug: list everything under dataset/ ────────────────────────────────────
export async function debugListBucket() {
  const res = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: S3_PREFIX + "/",
    MaxKeys: 50,
  }));
  return (res.Contents || []).map(o => o.Key);
}
