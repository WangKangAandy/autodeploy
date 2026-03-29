# Injection Sources

This directory contains source files for static content injection into OpenClaw workspace.

## Files

| File | Target | Markers | Purpose |
|------|--------|---------|---------|
| AGENTS.autodeploy.md | AGENTS.md | `<!-- AUTODEPLOY:BEGIN/END -->` | Platform rules |
| IDENTITY.autodeploy.md | IDENTITY.md | `<!-- AUTODEPLOY:IDENTITY:BEGIN/END -->` | Agent identity |

## Injection Mechanism

Files are injected by `src/utils/inject-manager.js` during plugin initialization:

1. Read source content from `inject/` directory
2. Check target file exists (create if missing)
3. Check if block exists in target (by markers)
4. Replace existing block or append new block
5. Atomic write (temp file + rename)

## Adding New Sources

To add a new injection source:

1. Create source file in `inject/` directory (e.g., `SOUL.autodeploy.md`)
2. Add entry to `INJECT_SOURCES` array in `inject-manager.js`:

```javascript
{
  key: "soul",
  sourceFile: "SOUL.autodeploy.md",
  targetFile: "SOUL.md",
  markers: { begin: "<!-- AUTODEPLOY:SOUL:BEGIN -->", end: "<!-- AUTODEPLOY:SOUL:END -->" },
  required: false,  // optional source
}
```

No other code changes needed - the declarative list drives all injection logic.

## Manual Refresh

```bash
node scripts/install.js install ~/.openclaw/workspace
```