/**
 * Setup wizard HTML — first-run flow.
 * Steps: Server URL → Auth Token → Verify → Connected
 */
export const setupPageHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HowinLens Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e4e4e7;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 400px;
      padding: 32px;
    }
    .logo {
      text-align: center;
      margin-bottom: 32px;
    }
    .logo h1 {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.5px;
    }
    .logo p {
      color: #71717a;
      font-size: 13px;
      margin-top: 4px;
    }
    .step { display: none; }
    .step.active { display: block; }
    .step-indicator {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-bottom: 24px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #27272a;
      transition: background 0.2s;
    }
    .dot.active { background: #3b82f6; }
    .dot.done { background: #22c55e; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #a1a1aa;
      margin-bottom: 6px;
    }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #27272a;
      border-radius: 8px;
      background: #18181b;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #3b82f6; }
    input::placeholder { color: #52525b; }
    .hint {
      font-size: 12px;
      color: #52525b;
      margin-top: 6px;
    }
    .btn {
      width: 100%;
      padding: 10px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 20px;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-success { background: #22c55e; color: #fff; }
    .btn-ghost {
      background: transparent;
      color: #71717a;
      border: 1px solid #27272a;
      margin-top: 8px;
    }
    .error {
      background: #451a1a;
      border: 1px solid #7f1d1d;
      color: #fca5a5;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      margin-top: 12px;
      display: none;
    }
    .success-icon {
      text-align: center;
      font-size: 48px;
      margin-bottom: 16px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #ffffff40;
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>HowinLens</h1>
      <p>AI Team Operations Platform</p>
    </div>

    <div class="step-indicator">
      <div class="dot active" id="dot-1"></div>
      <div class="dot" id="dot-2"></div>
      <div class="dot" id="dot-3"></div>
    </div>

    <!-- Step 1: Server URL -->
    <div class="step active" id="step-1">
      <label for="server-url">Server URL</label>
      <input type="text" id="server-url" placeholder="https://howinlens.yourcompany.com" autofocus>
      <p class="hint">The URL of your HowinLens server (ask your admin)</p>
      <button class="btn btn-primary" id="btn-next-1">Continue</button>
      <div class="error" id="error-1"></div>
    </div>

    <!-- Step 2: Auth Token -->
    <div class="step" id="step-2">
      <label for="auth-token">Auth Token</label>
      <input type="password" id="auth-token" placeholder="Paste your auth token">
      <p class="hint">Get this from your admin dashboard under User Settings</p>
      <button class="btn btn-primary" id="btn-verify">
        Verify Connection
      </button>
      <button class="btn btn-ghost" id="btn-back-2">Back</button>
      <div class="error" id="error-2"></div>
    </div>

    <!-- Step 3: Connected -->
    <div class="step" id="step-3">
      <div class="success-icon">&#10003;</div>
      <h2 style="text-align:center;font-size:18px;margin-bottom:8px">Connected!</h2>
      <p style="text-align:center;color:#71717a;font-size:13px" id="connected-info"></p>
      <button class="btn btn-success" id="btn-start">Start HowinLens</button>
    </div>
  </div>

  <script>
    const steps = [1, 2, 3];
    let currentStep = 1;

    function goToStep(n) {
      currentStep = n;
      steps.forEach(s => {
        document.getElementById('step-' + s).classList.toggle('active', s === n);
        const dot = document.getElementById('dot-' + s);
        dot.classList.toggle('active', s === n);
        dot.classList.toggle('done', s < n);
      });
    }

    function showError(step, msg) {
      const el = document.getElementById('error-' + step);
      el.textContent = msg;
      el.style.display = 'block';
    }

    function hideError(step) {
      document.getElementById('error-' + step).style.display = 'none';
    }

    // Step 1 → 2
    document.getElementById('btn-next-1').addEventListener('click', () => {
      const url = document.getElementById('server-url').value.trim();
      hideError(1);
      if (!url) return showError(1, 'Please enter a server URL');
      try {
        new URL(url);
      } catch {
        return showError(1, 'Invalid URL format');
      }
      goToStep(2);
      document.getElementById('auth-token').focus();
    });

    // Step 2 → back to 1
    document.getElementById('btn-back-2').addEventListener('click', () => {
      goToStep(1);
    });

    // Step 2 → verify → 3
    document.getElementById('btn-verify').addEventListener('click', async () => {
      const serverUrl = document.getElementById('server-url').value.trim().replace(/\\/$/, '');
      const authToken = document.getElementById('auth-token').value.trim();
      hideError(2);

      if (!authToken) return showError(2, 'Please enter your auth token');

      const btn = document.getElementById('btn-verify');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Verifying...';

      try {
        const result = await window.howinlens.verifyConnection(serverUrl, authToken);
        if (result.ok) {
          // Save config
          await window.howinlens.saveConfig({ serverUrl, authToken });
          document.getElementById('connected-info').textContent =
            'Logged in as ' + (result.userName || 'user') + '. HowinLens will run in the background.';
          goToStep(3);
        } else {
          showError(2, result.error || 'Connection failed');
        }
      } catch (err) {
        showError(2, 'Could not reach the server. Check the URL and try again.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Verify Connection';
      }
    });

    // Step 3 → start
    document.getElementById('btn-start').addEventListener('click', async () => {
      // Reload the app — main process will detect config and start services
      window.location.reload();
    });

    // Enter key navigation
    document.getElementById('server-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-next-1').click();
    });
    document.getElementById('auth-token').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-verify').click();
    });
  </script>
</body>
</html>
`;
