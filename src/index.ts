#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { uploadFiles, getTransferInfo, deleteTransfer } from "./api.js";

const TOKEN = process.env.SWISSTRANSFER_TOKEN || process.env.INFOMANIAK_TOKEN;

if (!TOKEN) {
  console.error(
    "Fehlt: SWISSTRANSFER_TOKEN oder INFOMANIAK_TOKEN als Umgebungsvariable setzen.\n" +
      "Token erstellen: https://manager.infomaniak.com/v3/ng/profile/user/token/list",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "swisstransfer",
  version: "1.0.0",
});

server.tool(
  "upload",
  "Dateien über SwissTransfer hochladen und einen teilbaren Download-Link erhalten. Bis zu 50 GB pro Transfer.",
  {
    files: z
      .array(z.string())
      .min(1)
      .describe("Absolute Dateipfade der hochzuladenden Dateien"),
    title: z.string().optional().describe("Titel des Transfers"),
    message: z
      .string()
      .optional()
      .describe("Nachricht an den Empfänger"),
    password: z
      .string()
      .optional()
      .describe("Passwortschutz für den Download"),
    expires_in_days: z
      .number()
      .optional()
      .describe("Gültigkeit in Tagen (1, 7, 15 oder 30, Standard: 30)"),
    max_download: z
      .number()
      .optional()
      .describe("Maximale Anzahl Downloads (1, 20, 100 oder 250, Standard: 250)"),
    recipients: z
      .array(z.string())
      .optional()
      .describe("E-Mail-Adressen der Empfänger (erhalten eine Benachrichtigung)"),
  },
  async ({ files, title, message, password, expires_in_days, max_download, recipients }) => {
    try {
      const result = await uploadFiles(TOKEN, files, {
        title,
        message,
        password,
        expiresInDays: expires_in_days,
        maxDownload: max_download,
        recipients,
      });

      const fileList = result.transfer.files
        .map((f) => `  - ${f.path} (${formatSize(f.size)})`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Transfer erfolgreich erstellt.`,
              ``,
              `Download-Link: ${result.linkUrl}`,
              ``,
              `Dateien:`,
              fileList,
              ``,
              `Gesamtgröße: ${formatSize(result.transfer.total_size)}`,
              `Gültig bis: ${new Date(result.transfer.expires_at * 1000).toLocaleDateString("de-DE")}`,
              password ? `Passwortgeschützt: Ja` : "",
              recipients?.length ? `Benachrichtigt: ${recipients.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "info",
  "Informationen über einen bestehenden SwissTransfer abrufen (Status, Dateien, Downloads).",
  {
    link_id: z
      .string()
      .describe(
        "Die Link-UUID aus der SwissTransfer-URL (der Teil nach /d/ in der URL)",
      ),
    password: z
      .string()
      .optional()
      .describe("Passwort, falls der Transfer geschützt ist"),
  },
  async ({ link_id, password }) => {
    try {
      const info = await getTransferInfo(TOKEN, link_id, password);

      const fileList = info.transfer.files
        .map((f) => `  - ${f.path} (${formatSize(f.size)})`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Transfer: ${info.transfer.title || "(ohne Titel)"}`,
              info.transfer.message ? `Nachricht: ${info.transfer.message}` : "",
              ``,
              `Dateien:`,
              fileList,
              ``,
              `Gesamtgröße: ${formatSize(info.transfer.total_size)}`,
              `Erstellt: ${new Date(info.transfer.created_at * 1000).toLocaleDateString("de-DE")}`,
              `Gültig bis: ${new Date(info.transfer.expires_at * 1000).toLocaleDateString("de-DE")}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Abfrage fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "delete",
  "Einen SwissTransfer löschen (Download-Link wird deaktiviert).",
  {
    transfer_id: z.string().describe("Die Transfer-ID (nicht die Link-UUID)"),
    confirm: z
      .literal("DELETE TRANSFER")
      .describe('Zur Bestätigung exakt "DELETE TRANSFER" eingeben'),
  },
  async ({ transfer_id, confirm }) => {
    try {
      await deleteTransfer(TOKEN, transfer_id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Transfer ${transfer_id} wurde gelöscht.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Löschen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server-Fehler:", err);
  process.exit(1);
});
