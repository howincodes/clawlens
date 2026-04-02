/**
 * Error page — shown when the dashboard cannot be loaded.
 */
export function errorPageHtml(serverUrl: string, errorMessage: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HowinLens — Offline</title>
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
    .container { text-align: center; padding: 32px; max-width: 360px; }
    .icon { font-size: 48px; margin-bottom: 16px; opacity: 0.6; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    p { color: #71717a; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
    .server-url {
      font-family: monospace;
      font-size: 12px;
      color: #52525b;
      background: #18181b;
      padding: 6px 10px;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 16px;
    }
    .error-detail {
      font-size: 12px;
      color: #7f1d1d;
      background: #451a1a;
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 16px;
      display: ${errorMessage ? 'block' : 'none'};
    }
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: #3b82f6;
      color: #fff;
      margin: 4px;
    }
    .btn:hover { opacity: 0.9; }
    .btn-ghost {
      background: transparent;
      color: #71717a;
      border: 1px solid #27272a;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#9888;</div>
    <h2>Server Unreachable</h2>
    <p>Can't connect to the HowinLens server. Background services are still running — data will sync when the connection is restored.</p>
    <div class="server-url">${serverUrl}</div>
    <div class="error-detail">${errorMessage}</div>
    <div>
      <button class="btn" onclick="window.location.reload()">Retry</button>
      <button class="btn btn-ghost" onclick="window.howinlens.openSettings()">Settings</button>
    </div>
  </div>
</body>
</html>
`;
}
