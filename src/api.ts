import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const BASE_URL = "https://swisstransfer.infomaniak.com/api/1";

interface FileEntry {
  path: string;
  size: number;
  mime_type: string;
}

interface TransferFile {
  id: string;
  path: string;
  size: number;
  mime_type: string;
}

interface TransferData {
  id: string;
  title: string | null;
  message: string | null;
  created_at: number;
  expires_at: number;
  files: TransferFile[];
  total_size: number;
}

interface CreateTransferResponse {
  result: string;
  data: TransferData;
}

interface PresignedUrlResponse {
  result: string;
  data: { url: string };
}

interface CompletionResponse {
  result: string;
  data: { link: { id: string } };
}

interface TransferLinkResponse {
  result: string;
  data: {
    id: string;
    report_url: string;
    transfer: TransferData;
  };
}

export interface UploadOptions {
  title?: string;
  message?: string;
  password?: string;
  language?: string;
  expiresInDays?: number;
  maxDownload?: number;
  recipients?: string[];
}

const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB

async function apiRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return { result: "success" } as T;
}

export async function uploadFiles(
  token: string,
  filePaths: string[],
  options: UploadOptions = {},
): Promise<{ linkUrl: string; linkId: string; transfer: TransferData }> {
  // Dateiinfos sammeln
  const files: FileEntry[] = [];
  for (const fp of filePaths) {
    const s = await stat(fp);
    if (!s.isFile()) throw new Error(`Kein reguläres File: ${fp}`);
    files.push({
      path: basename(fp),
      size: s.size,
      mime_type: guessMime(fp),
    });
  }

  // Transfer erstellen
  const createBody: Record<string, unknown> = {
    language: options.language || "de",
    expires_in_days: options.expiresInDays || 30,
    max_download: options.maxDownload || 250,
    files,
  };
  if (options.title) createBody.title = options.title;
  if (options.message) createBody.message = options.message;
  if (options.password) createBody.password = options.password;
  if (options.recipients?.length) createBody.recipients = options.recipients;

  const created = await apiRequest<CreateTransferResponse>(
    token,
    "POST",
    "/transfers",
    createBody,
  );

  const transfer = created.data;

  // Dateien hochladen
  for (let i = 0; i < filePaths.length; i++) {
    const fileId = transfer.files[i].id;
    const fileSize = transfer.files[i].size;
    const fileData = await readFile(filePaths[i]);

    if (fileSize <= CHUNK_SIZE) {
      // Direkt-Upload
      const presigned = await apiRequest<PresignedUrlResponse>(
        token,
        "POST",
        `/transfers/${transfer.id}/files/${fileId}`,
      );
      await putToPresigned(presigned.data.url, fileData);
      // Datei finalisieren (ohne Etags)
      await apiRequest(
        token,
        "PATCH",
        `/transfers/${transfer.id}/files/${fileId}`,
      );
    } else {
      // Chunked Upload
      const etags: { etag: string; chunk_index: number }[] = [];
      let chunkIndex = 1;
      let offset = 0;

      while (offset < fileSize) {
        const end = Math.min(offset + CHUNK_SIZE, fileSize);
        const chunk = fileData.subarray(offset, end);

        const presigned = await apiRequest<PresignedUrlResponse>(
          token,
          "POST",
          `/transfers/${transfer.id}/files/${fileId}/chunks/${chunkIndex}`,
        );

        const etag = await putToPresigned(presigned.data.url, chunk);
        if (etag) {
          etags.push({ etag, chunk_index: chunkIndex });
        }

        offset = end;
        chunkIndex++;
      }

      // Datei mit Etags finalisieren
      await apiRequest(
        token,
        "PATCH",
        `/transfers/${transfer.id}/files/${fileId}`,
        { etags },
      );
    }
  }

  // Transfer abschließen
  const completion = await apiRequest<CompletionResponse>(
    token,
    "PATCH",
    `/transfers/${transfer.id}`,
    { status: "completed" },
  );

  const linkId = completion.data.link.id;
  return {
    linkUrl: `https://www.swisstransfer.com/d/${linkId}`,
    linkId,
    transfer,
  };
}

export async function getTransferInfo(
  token: string,
  linkId: string,
  password?: string,
): Promise<TransferLinkResponse["data"]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (password) {
    headers["Transfer-Password"] = password;
  }

  const res = await fetch(`${BASE_URL}/links/${linkId}?with=transfer`, {
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Transfer-Info fehlgeschlagen (${res.status}): ${text}`);
  }

  const json = (await res.json()) as TransferLinkResponse;
  return json.data;
}

export async function deleteTransfer(
  token: string,
  transferId: string,
): Promise<void> {
  await apiRequest(token, "DELETE", `/transfers/${transferId}`);
}

async function putToPresigned(
  url: string,
  data: Buffer | Uint8Array,
): Promise<string | null> {
  const res = await fetch(url, {
    method: "PUT",
    body: data as unknown as BodyInit,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload auf Presigned-URL fehlgeschlagen (${res.status}): ${text}`);
  }
  return res.headers.get("etag");
}

function guessMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const mimes: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    pdf: "application/pdf",
    zip: "application/zip",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    txt: "text/plain",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
  };
  return mimes[ext] || "application/octet-stream";
}
