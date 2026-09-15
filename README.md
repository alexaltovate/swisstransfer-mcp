# SwissTransfer MCP Server

MCP server for [SwissTransfer](https://www.swisstransfer.com) file sharing. Upload files up to 50 GB, get shareable download links, check transfer status — all from Claude Code, Cursor, or any MCP client.

## Features

- **Upload files** — Send any file via SwissTransfer and get a download link
- **Transfer info** — Check status, files, and expiration of existing transfers
- **Delete transfers** — Remove transfers and deactivate download links
- **Configurable** — Set expiration, download limits, password protection, email notifications

## Setup

### 1. Get an Infomaniak API Token

1. Go to [Infomaniak Token Manager](https://manager.infomaniak.com/v3/ng/profile/user/token/list)
2. Create a new API token (free Infomaniak account required)
3. Copy the token — it's shown only once

### 2. Install

#### Claude Code

```bash
claude mcp add swisstransfer -- npx swisstransfer-mcp
```

Then set the token in your environment:

```bash
export SWISSTRANSFER_TOKEN=your_token_here
```

Or add it to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "swisstransfer": {
      "command": "npx",
      "args": ["swisstransfer-mcp"],
      "env": {
        "SWISSTRANSFER_TOKEN": "your_token_here"
      }
    }
  }
}
```

#### From source

```bash
git clone https://github.com/altovate/swisstransfer-mcp.git
cd swisstransfer-mcp
npm install
npm run build
```

Then add to your MCP config:

```json
{
  "mcpServers": {
    "swisstransfer": {
      "command": "node",
      "args": ["/path/to/swisstransfer-mcp/dist/index.js"],
      "env": {
        "SWISSTRANSFER_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Tools

### `upload`

Upload files and get a shareable download link.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `files` | string[] | Yes | Absolute file paths to upload |
| `title` | string | No | Transfer title |
| `message` | string | No | Message for the recipient |
| `password` | string | No | Password-protect the download |
| `expires_in_days` | number | No | Validity: 1, 7, 15, or 30 days (default: 30) |
| `max_download` | number | No | Max downloads: 1, 20, 100, or 250 (default: 250) |
| `recipients` | string[] | No | Email addresses to notify |

### `info`

Get information about an existing transfer.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `link_id` | string | Yes | The link UUID from the SwissTransfer URL (part after `/d/`) |
| `password` | string | No | Password if the transfer is protected |

### `delete`

Delete a transfer and deactivate its download link.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `transfer_id` | string | Yes | The transfer ID |
| `confirm` | string | Yes | Must be exactly `DELETE TRANSFER` |

## Environment Variables

| Variable | Description |
|---|---|
| `SWISSTRANSFER_TOKEN` | Infomaniak API token (preferred) |
| `INFOMANIAK_TOKEN` | Alternative name for the same token |

## Limits

- Max transfer size: **50 GB**
- Max file count per transfer: unlimited (within size limit)
- Chunk size for large files: 50 MB (handled automatically)
- API rate limit: 60 requests/minute

## License

MIT
