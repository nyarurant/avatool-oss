# Avatool MCP tool workflows

All names below are exported by the local MCP server. Call the read-only tool that supplies the needed ID/path before an action. Every action tool requires `confirm: true`.

## Status and library

- `avatool_status()` — bridge/application status.
- `list_assets` `(query?, limit?)`, `search_assets` `(query, limit?)`, `get_asset` `(itemId)` — library discovery and details.
- `list_item_files(itemId, limit?)`, `list_unitypackages(itemId)`, `scan_unitypackage(itemId, packagePath?)` — item files and extracted Unity package content.
- `get_download_queue()`, `get_storage_usage()`, `get_import_history(itemId?, limit?)` — current/past local operation state.

## BOOTH and wishlist/cart

- `search_booth` `(query, page?, sort?)`, `get_booth_item` `(itemId)`, `get_booth_cart` `(shopSubdomain?)` — read BOOTH state.
- `set_wishlist(itemId, wishlisted, confirm: true)` — update Avatool/BOOTH wishlist state. Inspect independent local and BOOTH result fields.
- `import_booth_wishlist(confirm: true)` — mirror BOOTH wishlist into Avatool.
- `add_to_booth_cart(itemId, variationName?, confirm: true)` — add the chosen variation to the BOOTH cart.

## Downloads and extraction

- `sync_library(fullRescan?, confirm: true)` — synchronize the library.
- `download_item(itemId, confirm: true)` — queue/download the item.
- `control_download_queue(action, confirm: true)` — action is `stop`, `resume`, or `retry_failed`.
- `extract_item(itemId, force?, confirm: true)` — extract an item download. Confirm before `force` because it can replace extraction output.

## Unity and VPM

First call `list_unity_projects()` and use only one of its returned paths.

- `get_project_items` `(projectPath)`, `list_bootstrap_choices` `()`, `analyze_vpm_dependencies` `(projectPath, itemId?)` — read project/import prerequisites.
- `import_asset_to_unity(itemId, projectPath, importMode?, confirm: true)` — import to the registered project.
- `install_vpm_dependencies(projectPath, modularAvatar?, liltoon?, confirm: true)` — install selected VPM dependencies.
- `run_auto_bootstrap(projectPath, confirm: true)` — run project bootstrap.

## Settings, logs, and health

- `get_settings` `()`, `list_settings_profiles` `()`, `get_operation_logs` `(limit?)`, `get_runtime_logs` `(limit?)`, `run_health_check` `()`, `check_app_update` `()` — read diagnostics/configuration.
- `update_settings(patch, confirm: true)`, `apply_settings_profile(profileName, confirm: true)`, `save_settings_profile(profileName, confirm: true)`, `clear_operation_logs(confirm: true)` — mutate settings/logs.
