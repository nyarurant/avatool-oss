'use strict';

const { assertConfirmation, callBridge, readEndpointConfig } = require('./client');
const { version: avatoolVersion } = require('../package.json');

const TOOL_SPECS = [
  ['avatool_status', 'Get Avatool bridge and application status.', {}],
  ['list_assets', 'List assets in the Avatool library.', { query: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }],
  ['get_asset', 'Get one asset by ID.', { itemId: { type: 'string' } }],
  ['search_assets', 'Search assets by text.', { query: { type: 'string' }, limit: { type: 'number', optional: true } }],
  ['list_unity_projects', 'List configured Unity projects.', {}],
  ['sync_library', 'Synchronize the Avatool asset library.', { fullRescan: { type: 'boolean', optional: true }, confirm: { type: 'boolean' } }],
  ['download_item', 'Download an Avatool item.', { itemId: { type: 'string' }, confirm: { type: 'boolean' } }],
  ['import_asset_to_unity', 'Import an asset into a Unity project.', { itemId: { type: 'string' }, projectPath: { type: 'string' }, importMode: { type: 'string', optional: true }, confirm: { type: 'boolean' } }],
  ['get_download_queue', 'Get the current download queue.', {}],
  ['get_settings', 'Get non-sensitive Avatool settings.', {}],
  ['get_operation_logs', 'Get recent operation logs.', { limit: { type: 'number', optional: true } }],
  ['run_health_check', 'Run an Avatool health check.', {}],
  ['get_storage_usage', 'Get Avatool storage usage.', {}],
  ['list_item_files', 'List files belonging to an item.', { itemId: { type: 'string' }, limit: { type: 'number', optional: true } }],
  ['list_unitypackages', 'List Unity packages extracted for an item.', { itemId: { type: 'string' } }],
  ['get_project_items', 'List items imported into a Unity project.', { projectPath: { type: 'string' } }],
  ['search_booth', 'Search BOOTH items.', { query: { type: 'string' }, page: { type: 'number', optional: true }, sort: { type: 'string', optional: true } }],
  ['get_booth_item', 'Get a BOOTH item by ID.', { itemId: { type: 'string' } }],
  ['list_bootstrap_choices', 'List available bootstrap choices.', {}],
  ['control_download_queue', 'Control the download queue.', { action: { type: 'string' }, confirm: { type: 'boolean' } }],
  ['extract_item', 'Extract an item download.', { itemId: { type: 'string' }, force: { type: 'boolean', optional: true }, confirm: { type: 'boolean' } }],
  ['install_vpm_dependencies', 'Install VPM dependencies into a Unity project.', { projectPath: { type: 'string' }, modularAvatar: { type: 'boolean', optional: true }, liltoon: { type: 'boolean', optional: true }, confirm: { type: 'boolean' } }],
  ['run_auto_bootstrap', 'Run automatic Unity project bootstrap.', { projectPath: { type: 'string' }, confirm: { type: 'boolean' } }],
  ['get_booth_cart', 'Get the current BOOTH cart.', { shopSubdomain: { type: 'string', optional: true } }],
  ['list_settings_profiles', 'List saved Avatool settings profiles.', {}],
  ['get_import_history', 'Get Unity import history.', { itemId: { type: 'string', optional: true }, limit: { type: 'number', optional: true } }],
  ['scan_unitypackage', 'Scan a Unity package belonging to an extracted Avatool item.', { itemId: { type: 'string' }, packagePath: { type: 'string', optional: true } }],
  ['analyze_vpm_dependencies', 'Analyze VPM dependencies for a Unity project and optional item.', { projectPath: { type: 'string' }, itemId: { type: 'string', optional: true } }],
  ['get_runtime_logs', 'Get recent Avatool runtime logs.', { limit: { type: 'number', optional: true } }],
  ['check_app_update', 'Check whether an Avatool application update is available.', {}],
  ['set_wishlist', 'Add or remove an item from the Avatool wishlist.', { itemId: { type: 'string' }, wishlisted: { type: 'boolean' }, confirm: { type: 'boolean' } }],
  ['import_booth_wishlist', 'Import the BOOTH wishlist into Avatool.', { confirm: { type: 'boolean' } }],
  ['add_to_booth_cart', 'Add an Avatool item to the BOOTH cart.', { itemId: { type: 'string' }, variationName: { type: 'string', optional: true }, confirm: { type: 'boolean' } }],
  ['update_settings', 'Update allowed Avatool settings.', { patch: { type: 'object' }, confirm: { type: 'boolean' } }],
  ['apply_settings_profile', 'Apply a saved Avatool settings profile.', { profileName: { type: 'string' }, confirm: { type: 'boolean' } }],
  ['save_settings_profile', 'Save the current allowed settings as a profile.', { profileName: { type: 'string' }, confirm: { type: 'boolean' } }],
  ['clear_operation_logs', 'Clear stored Avatool operation logs.', { confirm: { type: 'boolean' } }],
];

const TOOL_ANNOTATIONS = Object.freeze({
  avatool_status: { readOnlyHint: true }, list_assets: { readOnlyHint: true }, get_asset: { readOnlyHint: true },
  search_assets: { readOnlyHint: true }, list_unity_projects: { readOnlyHint: true }, get_download_queue: { readOnlyHint: true },
  get_settings: { readOnlyHint: true }, get_operation_logs: { readOnlyHint: true }, run_health_check: { readOnlyHint: true },
  get_storage_usage: { readOnlyHint: true }, list_item_files: { readOnlyHint: true }, list_unitypackages: { readOnlyHint: true },
  get_project_items: { readOnlyHint: true }, search_booth: { readOnlyHint: true }, get_booth_item: { readOnlyHint: true },
  list_bootstrap_choices: { readOnlyHint: true }, sync_library: { destructiveHint: false }, download_item: { destructiveHint: false },
  import_asset_to_unity: { destructiveHint: false }, control_download_queue: { destructiveHint: true }, extract_item: { destructiveHint: true },
  install_vpm_dependencies: { destructiveHint: true }, run_auto_bootstrap: { destructiveHint: true },
  get_booth_cart: { readOnlyHint: true }, list_settings_profiles: { readOnlyHint: true }, get_import_history: { readOnlyHint: true },
  scan_unitypackage: { readOnlyHint: true }, analyze_vpm_dependencies: { readOnlyHint: true }, get_runtime_logs: { readOnlyHint: true },
  check_app_update: { destructiveHint: false }, set_wishlist: { destructiveHint: false }, import_booth_wishlist: { destructiveHint: false },
  add_to_booth_cart: { destructiveHint: false }, update_settings: { destructiveHint: false }, apply_settings_profile: { destructiveHint: false },
  save_settings_profile: { destructiveHint: false }, clear_operation_logs: { destructiveHint: true },
});

function jsonSchema(properties) {
  return { type: 'object', properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { type: value.type }])), additionalProperties: false };
}

function zodRawShape(properties) {
  // Loaded only when the real SDK's registerTool path is used. This keeps
  // pure unit tests and lightweight test doubles independent of zod.
  const { z } = require('zod');
  return Object.fromEntries(Object.entries(properties).map(([key, spec]) => {
    let schema = spec.type === 'number' ? z.number()
      : spec.type === 'boolean' ? z.boolean()
        : spec.type === 'object' ? z.object({}).passthrough()
          : z.string();
    if (spec.optional) schema = schema.optional();
    return [key, schema];
  }));
}

function toolResult(value) {
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const structuredContent = isPlainObject ? value : { value: value ?? null };
  return { content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }], structuredContent };
}

function registerTools(server, config, bridge = callBridge, configLoader = readEndpointConfig) {
  const register = (name, description, properties) => {
    const handler = async (args = {}) => {
      assertConfirmation(name, args);
      const params = { ...args };
      delete params.confirm;
      const resolvedConfig = config || configLoader();
      return toolResult(await bridge(resolvedConfig, name, params));
    };
    // registerTool requires a Zod raw shape in current SDK releases. Keep the
    // legacy tool() fallback useful for lightweight test doubles/older SDKs.
    if (typeof server.registerTool === 'function') {
      server.registerTool(name, { description, inputSchema: zodRawShape(properties), annotations: TOOL_ANNOTATIONS[name] }, handler);
    } else {
      server.tool(name, description, jsonSchema(properties), handler);
    }
  };
  for (const [name, description, properties] of TOOL_SPECS) register(name, description, properties);
  return server;
}

async function createServer({ config, bridge = callBridge, configLoader = readEndpointConfig } = {}) {
  let sdk;
  try {
    sdk = await import('@modelcontextprotocol/sdk/server/mcp.js');
  } catch (error) {
    throw new Error('MCP SDK is not installed. Install @modelcontextprotocol/sdk@^1.30.0 (Node >=18).', { cause: error });
  }
  const server = new sdk.McpServer({ name: 'avatool', version: avatoolVersion });
  registerTools(server, config, bridge, configLoader);
  return server;
}

async function main() {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = await createServer();
  await server.connect(new StdioServerTransport());
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

module.exports = { TOOL_SPECS, TOOL_ANNOTATIONS, jsonSchema, zodRawShape, toolResult, registerTools, createServer };
