/**
 * Settings panel HTML — in-app config editor.
 */
export const settingsPageHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HowinLens Settings</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e4e4e7;
      padding: 24px;
    }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #71717a;
      margin-bottom: 12px;
    }
    .field { margin-bottom: 16px; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #a1a1aa;
      margin-bottom: 4px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #27272a;
      border-radius: 6px;
      background: #18181b;
      color: #fff;
      font-size: 14px;
      outline: none;
    }
    input:focus { border-color: #3b82f6; }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #1e1e22;
    }
    .toggle-label { font-size: 14px; }
    .toggle-desc { font-size: 12px; color: #52525b; }
    .toggle {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: #27272a;
      border-radius: 22px;
      transition: background 0.2s;
    }
    .toggle-slider:before {
      content: "";
      position: absolute;
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle input:checked + .toggle-slider { background: #3b82f6; }
    .toggle input:checked + .toggle-slider:before { transform: translateX(18px); }
    .btn-row { display: flex; gap: 8px; margin-top: 24px; }
    .btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:hover { opacity: 0.9; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-ghost { background: transparent; color: #71717a; border: 1px solid #27272a; }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #22c55e;
      color: #fff;
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      display: none;
    }
    .version {
      text-align: center;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <h1>Settings</h1>

  <div class="section">
    <div class="section-title">Connection</div>
    <div class="field">
      <label for="server-url">Server URL</label>
      <input type="text" id="server-url" placeholder="https://howinlens.yourcompany.com">
    </div>
    <div class="field">
      <label for="auth-token">Auth Token</label>
      <input type="password" id="auth-token" placeholder="Your auth token">
    </div>
  </div>

  <div class="section">
    <div class="section-title">Preferences</div>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Auto-start</div>
        <div class="toggle-desc">Launch HowinLens on system startup</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="auto-start">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Notifications</div>
        <div class="toggle-desc">Show alerts for credential rotations and usage warnings</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="notifications">
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <div class="btn-row">
    <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
    <button class="btn btn-primary" id="btn-save">Save</button>
  </div>

  <div class="toast" id="toast">Settings saved</div>
  <div class="version">HowinLens v0.3.0</div>

  <script>
    // Load current config
    (async () => {
      try {
        const config = await window.howinlens.getFullConfig();
        if (config) {
          document.getElementById('server-url').value = config.serverUrl || '';
          document.getElementById('auth-token').value = config.authToken || '';
          document.getElementById('auto-start').checked = config.autoStart !== false;
          document.getElementById('notifications').checked = config.notificationsEnabled !== false;
        }
      } catch {}
    })();

    // Save
    document.getElementById('btn-save').addEventListener('click', async () => {
      const config = {
        serverUrl: document.getElementById('server-url').value.trim().replace(/\\/$/, ''),
        authToken: document.getElementById('auth-token').value.trim(),
        autoStart: document.getElementById('auto-start').checked,
        notificationsEnabled: document.getElementById('notifications').checked,
      };

      try {
        await window.howinlens.saveConfig(config);
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2000);
      } catch (err) {
        alert('Failed to save: ' + err.message);
      }
    });

    // Cancel
    document.getElementById('btn-cancel').addEventListener('click', () => {
      window.close();
    });
  </script>
</body>
</html>
`;
