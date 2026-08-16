'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AI agent integration wiring', () => {
  test('connects settings UI through preload and trusted IPC handlers', () => {
    const html = source('asset_manager.html');
    const renderer = source('renderer/render_settings_tools.js');
    const preload = source('preload.js');
    const ipc = source('lib/ipc_handlers.js');
    const main = source('main.js');

    expect(html).toContain('data-panel="agent-integration"');
    expect(html).toContain('id="agent-integration-setup"');
    expect(renderer).toContain('boothAPI.setupAgentIntegration()');
    expect(preload).toContain("ipcRenderer.invoke('get-agent-integration-status')");
    expect(preload).toContain("ipcRenderer.invoke('setup-agent-integration')");
    expect(ipc).toContain("handleIpc('get-agent-integration-status'");
    expect(ipc).toContain("handleIpc('setup-agent-integration'");
    expect(ipc).toContain('agentIntegrationService.setup({ confirmed: true })');
    expect(main).toContain('createAgentIntegrationService({');
    expect(main).toContain('agentIntegrationService,');
  });
});
