# Repo Split MCP Client Quickstart

## Purpose

This guide fixes the minimum client-side integration path for `Repo Split MCP v0.1`.

Use it to verify that the server can:

- start under an MCP client
- expose tools
- expose static resources and artifact resource templates
- complete the non-destructive `plan -> preview -> confirmation` path
- reject an invalid destructive execution request through the guard layer

## Minimum Client Configuration

For MCP clients that use the common `mcpServers` JSON shape, use this Windows configuration:

```json
{
  "mcpServers": {
    "repo-split": {
      "command": "npm.cmd",
      "args": ["run", "mcp:repo-split"],
      "cwd": "C:\\Users\\zeros\\.gemini\\antigravity\\scratch\\project_manuals"
    }
  }
}
```

Notes:

- Use `npm.cmd` on Windows clients that spawn commands directly.
- Keep `cwd` pinned to the `project_manuals` repo root.
- The server is a stdio MCP server, so a healthy idle session usually produces no output.

## Expected Public Surface

Tools:

- `repo_split.plan`
- `repo_split.preview`
- `repo_split.create_confirmation`
- `repo_split.execute_confirmed`
- `repo_split.get_plan_artifact`
- `repo_split.get_preview_artifact`
- `repo_split.get_execution_artifact`

Static resources:

- `repo-split://runbook/main`
- `repo-split://checklist/cognitive-lab-phase1`
- `repo-split://checklist/lab-experiments`
- `repo-split://spec/v0.1`
- `repo-split://guide/client-quickstart`

Artifact resource templates:

- `repo-split://artifact/plan/{artifactId}`
- `repo-split://artifact/preview/{artifactId}`
- `repo-split://artifact/execution/{artifactId}`

## One-Command Smoke Test

Run:

```powershell
npm run mcp:repo-split:smoke
```

This test performs a real stdio MCP round-trip and checks:

- tool listing
- static resource listing
- artifact resource template listing
- `repo_split.plan`
- `repo_split.preview`
- `repo_split.create_confirmation`
- guard failure on `repo_split.execute_confirmed`
- by-id plan and preview artifact resource reads

Expected result:

- JSON summary printed to stdout
- `guardFailure` contains `PLAN_HASH_MISMATCH`
- `planArtifactResourceRead` and `previewArtifactResourceRead` echo their artifact URIs

## Manual Non-Destructive Flow

1. Call `repo_split.plan` with `{"layout":"recommended","format":"summary"}`.
2. Save `planHash` and `artifactId` from the result.
3. Call `repo_split.preview` with `layout`, `phase`, `planHash`, and `planArtifactId`.
4. Save the returned preview `artifactId`.
5. Call `repo_split.create_confirmation` with the same `planHash`, `planArtifactId`, and `previewArtifactId`.
6. Optionally validate the guard path by calling `repo_split.execute_confirmed` with a deliberately incorrect `planHash` and confirming that the server returns `PLAN_HASH_MISMATCH`.

This sequence validates transport, tool registration, state linkage, and confirmation storage without running a destructive phase.

## Artifact Resource Usage

Artifact IDs contain `/`, so they must be URL-encoded inside resource URIs.

Example:

```text
artifactId: repo-split/plan/20260315T120000Z-ab12cd34
resource: repo-split://artifact/plan/repo-split%2Fplan%2F20260315T120000Z-ab12cd34
```

The same encoding rule applies to preview and execution artifact resources.

## Error Codes To Expect During Integration

- `CONFIRMATION_NOT_FOUND`
- `PLAN_ARTIFACT_NOT_FOUND`
- `PREVIEW_ARTIFACT_NOT_FOUND`
- `EXECUTION_ARTIFACT_NOT_FOUND`
- `PLAN_HASH_MISMATCH`
- `PREVIEW_ARTIFACT_MISMATCH`
- `EXECUTION_FAILED`

These are the public integration-facing failures to verify first. Persistent storage and richer output schemas can wait until after client round-trips are stable.
