#!/bin/bash
# ClawLens v0.1 -> v0.2 Migration
# Removes old Go-based installation and cleans up

echo "ClawLens v0.1 Cleanup"
echo "====================="

# Remove old client binary + config
rm -rf ~/.clawlens
rm -f /usr/local/bin/clawlens

# Remove old managed settings (v0.1 wrote directly to managed-settings.json)
if [ "$(uname -s)" = "Darwin" ]; then
  sudo rm -f "/Library/Application Support/ClaudeCode/managed-settings.json"
else
  sudo rm -f /etc/claude-code/managed-settings.json
fi

# Remove old managed-settings.d entries from v0.2 beta testing
if [ "$(uname -s)" = "Darwin" ]; then
  sudo rm -f "/Library/Application Support/ClaudeCode/managed-settings.d/10-clawlens.json"
  sudo rm -f "/Library/Application Support/ClaudeCode/clawlens-hook.sh"
  sudo rm -f "/Library/Application Support/ClaudeCode/clawlens-gate.sh"
else
  sudo rm -f /etc/claude-code/managed-settings.d/10-clawlens.json
  sudo rm -f /etc/claude-code/clawlens-hook.sh
  sudo rm -f /etc/claude-code/clawlens-gate.sh
fi

# Remove old plugin if installed
claude plugin uninstall clawlens@howincodes 2>/dev/null || true

# Clean clawlens hooks from settings.json
if [ -f ~/.claude/settings.json ]; then
  node -e "
    const fs = require('fs');
    const p = '$HOME/.claude/settings.json';
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (s.hooks) {
        for (const [event, groups] of Object.entries(s.hooks)) {
          s.hooks[event] = groups.filter(g => !JSON.stringify(g).includes('clawlens'));
          if (s.hooks[event].length === 0) delete s.hooks[event];
        }
        if (Object.keys(s.hooks).length === 0) delete s.hooks;
      }
      if (s.env) {
        delete s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
        delete s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
        if (Object.keys(s.env).length === 0) delete s.env;
      }
      if (s.enabledPlugins) {
        delete s.enabledPlugins['clawlens@howincodes'];
        if (Object.keys(s.enabledPlugins).length === 0) delete s.enabledPlugins;
      }
      fs.writeFileSync(p, JSON.stringify(s, null, 2));
      console.log('Cleaned settings.json');
    } catch (e) {
      console.log('No settings.json changes needed');
    }
  " 2>/dev/null
fi

rm -f ~/.claude/hooks/clawlens-hook.sh

echo ""
echo "v0.1 cleanup complete."
echo "To install v0.2:"
echo "  bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)"
