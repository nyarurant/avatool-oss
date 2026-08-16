---
name: avatool-mcp
description: Operate the local Avatool desktop asset library through the `avatool` MCP server. Use when searching or inspecting the Avatool library, its connected BOOTH assets, downloads, Unity projects and imports, VPM dependencies, wishlists, carts, settings, logs, storage, or health; and when performing an explicitly confirmed Avatool action.
---

# Avatool MCP

Use the local `avatool` MCP server for Avatool state. Treat it as the source of truth instead of reading or editing Avatool data files directly.

## Operating rules

- Start read-first: check status and inspect the smallest relevant data set before proposing or taking an action.
- Keep results compact. Search with a narrow query and low `limit`; call `get_asset`, `get_booth_item`, or file/package details only for the selected item. Do not list whole libraries or logs unless needed.
- Use a `projectPath` only after `list_unity_projects`, and copy a path returned there. Never import, bootstrap, install VPM packages, inspect project items, or analyze dependencies for an unregistered Unity project.
- For every mutation, obtain the user's explicit instruction or confirmation first, describe the target and effect, then send `confirm: true`. Never infer consent merely to satisfy the tool schema.
- Never call a mutating tool without `confirm: true`; see the exact tool list in [references/tool-workflows.md](references/tool-workflows.md).
- Treat partial work as partial: inspect `ok`, `error`, `errors`, `partial`, per-item results, and queue/import state. Do not report success if local work succeeded but BOOTH sync, extraction, download, import, or dependency installation failed.
- For long-running work, acknowledge that it has started, then check the narrowest status tool at a sensible interval. Do not busy-poll or request broad logs repeatedly. Report the final known state and any unfinished/failed item IDs.

## Read workflow

1. Call `avatool_status` when availability is unknown or a previous action may still be running.
2. Use `search_assets` for a library query; use `get_asset` for one matching item. Use `search_booth` and then `get_booth_item` only when BOOTH information is needed.
3. Inspect the specific prerequisite before suggesting an operation:
   - files/packages: `list_item_files`, `list_unitypackages`, or `scan_unitypackage`
   - queue/storage: `get_download_queue` or `get_storage_usage`
   - Unity: `list_unity_projects`, `get_project_items`, `get_import_history`, or `analyze_vpm_dependencies`
   - diagnostics: `run_health_check`, `get_operation_logs`, or `get_runtime_logs`
4. Present the selected item/project, intended effect, and relevant risk or expected duration; ask for confirmation if the user has not already explicitly authorized it.

## Mutating workflow

After confirmation, call the exact action with `confirm: true`, using verified IDs and registered project paths.

- Library and files: `sync_library`, `download_item`, `control_download_queue`, `extract_item`
- Unity and VPM: `import_asset_to_unity`, `install_vpm_dependencies`, `run_auto_bootstrap`
- BOOTH: `set_wishlist`, `import_booth_wishlist`, `add_to_booth_cart`
- Settings/logs: `update_settings`, `apply_settings_profile`, `save_settings_profile`, `clear_operation_logs`

For downloads, extraction, or imports, inspect the relevant queue, files, import history, or runtime logs after completion. For `set_wishlist`, preserve and report independent local and BOOTH outcomes; a failed BOOTH sync is not a successful wishlist update.

## Scope notes

- Do not expose or request BOOTH cookies, bridge tokens, or sensitive setting values. `get_settings` deliberately returns only non-sensitive settings.
- Prefer `scan_unitypackage` before a Unity import when the package contents or dependencies are unknown. Then use `analyze_vpm_dependencies` on the registered project before `install_vpm_dependencies`.
- `import_asset_to_unity` can be long-running. Use its selected `importMode` only after explaining it; do not substitute a different project or mode.
- Use `check_app_update` to inspect availability only; do not describe it as downloading or installing an update.

Read [references/tool-workflows.md](references/tool-workflows.md) when selecting a tool or its required parameters.
