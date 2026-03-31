import { useState, useEffect } from 'react'
import { getTeam, updateTeam, getModelCredits, updateModelCredit } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Save, AlertTriangle, CheckCircle2, Brain } from 'lucide-react'

interface TeamSettings {
  collection_level?: string
  secret_scrub?: string
  collect_responses?: boolean
  prompt_retention_days?: number
  summary_interval?: number
  provider?: string
  api_key?: string
  custom_url?: string
  slack_webhook?: string
  discord_webhook?: string
  alert_on_block?: boolean
  alert_on_stuck?: boolean
  alert_on_secret?: boolean
  alert_on_kill?: boolean
  daily_digest?: boolean
  weekly_digest?: boolean
  weight_opus?: number
  weight_sonnet?: number
  weight_haiku?: number
  target_version?: string
  [key: string]: unknown
}

export function Settings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Local form state
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<TeamSettings>({})
  const [ccCredits, setCcCredits] = useState<any[]>([])
  const [codexCredits, setCodexCredits] = useState<any[]>([])
  const [creditsLoading, setCreditsLoading] = useState(true)

  const [aiSettings, setAiSettings] = useState({
    sessionIntelligence: true,
    profileHours: 2,
    pulseTime: '09:00',
    model: 'sonnet',
    profileDepth: 'full',
  })

  useEffect(() => {
    async function load() {
      try {
        const res = await getTeam()
        if (res) {
          setName(res.name || '')
          // Settings may come as a JSON string or an object
          let parsed: TeamSettings = {}
          if (typeof res.settings === 'string') {
            try { parsed = JSON.parse(res.settings) } catch { parsed = {} }
          } else if (res.settings && typeof res.settings === 'object') {
            parsed = res.settings as TeamSettings
          }
          setSettings(parsed)
        }
      } catch (_err) {
        console.error('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    Promise.all([
      getModelCredits('claude_code'),
      getModelCredits('codex'),
    ]).then(([cc, codex]) => {
      setCcCredits(cc?.data || [])
      setCodexCredits(codex?.data || [])
    }).finally(() => setCreditsLoading(false))
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    try {
      await updateTeam({ name, settings })
      setSaveMsg({ type: 'success', text: 'Settings saved successfully.' })
      setTimeout(() => setSaveMsg(null), 5000)
    } catch (_err) {
      setSaveMsg({ type: 'error', text: 'Failed to save settings.' })
    } finally {
      setSaving(false)
    }
  }

  const toggleSetting = (key: keyof TeamSettings) => {
    setSettings(s => ({ ...s, [key]: !s[key] }))
  }

  const updateSetting = (key: keyof TeamSettings, val: unknown) => {
    setSettings(s => ({ ...s, [key]: val }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure data collection, limits, and integrations.</p>
      </div>

      {/* Save message */}
      {saveMsg && (
        <div className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          saveMsg.type === 'success'
            ? 'bg-green-500/10 text-green-600 border border-green-200'
            : 'bg-red-500/10 text-red-600 border border-red-200'
        }`}>
          {saveMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {saveMsg.text}
        </div>
      )}

      <form onSubmit={handleSave} className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Team Profile</CardTitle>
            <CardDescription>Basic information about your deployment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Team Name</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Engineering Team"
              />
            </div>
            <div className="space-y-2">
              <Label>Target Version (Auto Update)</Label>
              <Input
                value={settings.target_version || ''}
                onChange={e => updateSetting('target_version', e.target.value)}
                placeholder="e.g. 1.2.0 (Leave blank for latest)"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Collection & Privacy</CardTitle>
            <CardDescription>Determine what hooks pull from user machines.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Collection Level</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={settings.collection_level || 'full'}
                  onChange={e => updateSetting('collection_level', e.target.value)}
                >
                  <option value="off">Off (No prompt text)</option>
                  <option value="summaries">Summaries Only</option>
                  <option value="full">Full Text</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Secret Scrubbing</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={settings.secret_scrub || 'redact'}
                  onChange={e => updateSetting('secret_scrub', e.target.value)}
                >
                  <option value="off">Off</option>
                  <option value="alert">Alert Only</option>
                  <option value="redact">Redact</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
              <div className="space-y-0.5">
                <Label>Collect Responses</Label>
                <p className="text-xs text-muted-foreground">Store the full Claude response text</p>
              </div>
              <Button type="button" variant={settings.collect_responses ? 'default' : 'secondary'} size="sm" onClick={() => toggleSetting('collect_responses')}>
                {settings.collect_responses ? 'Enabled' : 'Disabled'}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Prompt Retention (Days)</Label>
              <Input
                type="number"
                value={settings.prompt_retention_days || 90}
                onChange={e => updateSetting('prompt_retention_days', parseInt(e.target.value) || 90)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Summary Settings</CardTitle>
            <CardDescription>Configure how and when intelligence briefs are generated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Summary Interval (Hours)</Label>
                <Input type="number" value={settings.summary_interval || 0} onChange={e => updateSetting('summary_interval', parseInt(e.target.value) || 0)} />
                <p className="text-xs text-muted-foreground">0 to disable auto-generation</p>
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={settings.provider || 'claude-code'}
                  onChange={e => updateSetting('provider', e.target.value)}
                >
                  <option value="claude-code">Claude Code Built-in</option>
                  <option value="anthropic-api">Anthropic API</option>
                  <option value="openai">OpenAI</option>
                  <option value="custom">Custom Endpoint</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>API Key</Label>
              <Input type="password" value={settings.api_key || ''} onChange={e => updateSetting('api_key', e.target.value)} placeholder="Enter API key..." />
            </div>
            {settings.provider === 'custom' && (
              <div className="space-y-2">
                <Label>Custom URL</Label>
                <Input type="url" value={settings.custom_url || ''} onChange={e => updateSetting('custom_url', e.target.value)} placeholder="https://..." />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts & Webhooks</CardTitle>
            <CardDescription>Get notified of team events directly where you work.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Slack Webhook URL</Label>
              <Input
                type="url"
                value={settings.slack_webhook || ''}
                onChange={e => updateSetting('slack_webhook', e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
            <div className="space-y-2">
              <Label>Discord Webhook URL</Label>
              <Input
                type="url"
                value={settings.discord_webhook || ''}
                onChange={e => updateSetting('discord_webhook', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
              />
            </div>

            <div className="grid gap-2 grid-cols-2 mt-4">
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.alert_on_block} onChange={() => toggleSetting('alert_on_block')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Alert on Rate Limits</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.alert_on_stuck} onChange={() => toggleSetting('alert_on_stuck')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Alert on Dev Stuck</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.alert_on_secret} onChange={() => toggleSetting('alert_on_secret')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Alert on Secret Exposure</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.alert_on_kill} onChange={() => toggleSetting('alert_on_kill')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Alert on User Kill/Pause</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.daily_digest} onChange={() => toggleSetting('daily_digest')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Send Daily Digest</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer p-3 border rounded hover:bg-muted/30">
                <input type="checkbox" checked={!!settings.weekly_digest} onChange={() => toggleSetting('weekly_digest')} className="rounded accent-primary" />
                <span className="text-sm font-medium">Send Weekly Digest</span>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rate Limiting Weights</CardTitle>
            <CardDescription>Adjust internal cost multipliers for credit tracking.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Opus Weight</Label>
                <Input type="number" step="0.1" value={settings.weight_opus ?? 15} onChange={e => updateSetting('weight_opus', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Sonnet Weight</Label>
                <Input type="number" step="0.1" value={settings.weight_sonnet ?? 3} onChange={e => updateSetting('weight_sonnet', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Haiku Weight</Label>
                <Input type="number" step="0.1" value={settings.weight_haiku ?? 0.25} onChange={e => updateSetting('weight_haiku', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Configuration
          </Button>
        </div>
      </form>

      {/* AI Intelligence Settings (display-only for now) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Intelligence
          </CardTitle>
          <CardDescription>Configure automated AI analysis features.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Session Intelligence</div>
              <div className="text-xs text-muted-foreground">Auto-analyze completed sessions</div>
            </div>
            <button className={`w-10 h-5 rounded-full transition-colors ${aiSettings.sessionIntelligence ? 'bg-green-500' : 'bg-gray-300'}`}
              onClick={() => setAiSettings(s => ({ ...s, sessionIntelligence: !s.sessionIntelligence }))}>
              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${aiSettings.sessionIntelligence ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Developer Profile Updates</div>
              <div className="text-xs text-muted-foreground">Rolling behavioral profiles</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Every</span>
              <input type="number" className="w-16 h-8 rounded border px-2 text-sm"
                value={aiSettings.profileHours} onChange={e => setAiSettings(s => ({ ...s, profileHours: parseInt(e.target.value) || 2 }))} />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Daily Team Pulse</div>
              <div className="text-xs text-muted-foreground">Auto-generate executive briefing</div>
            </div>
            <input type="time" className="h-8 rounded border px-2 text-sm"
              value={aiSettings.pulseTime} onChange={e => setAiSettings(s => ({ ...s, pulseTime: e.target.value }))} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">AI Model</div>
              <div className="text-xs text-muted-foreground">Used for all AI analysis</div>
            </div>
            <select className="h-8 rounded border px-2 text-sm"
              value={aiSettings.model} onChange={e => setAiSettings(s => ({ ...s, model: e.target.value }))}>
              <option value="sonnet">Sonnet (recommended)</option>
              <option value="opus">Opus (higher quality, 3x cost)</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Profile Depth</div>
              <div className="text-xs text-muted-foreground">How detailed behavioral analysis should be</div>
            </div>
            <select className="h-8 rounded border px-2 text-sm"
              value={aiSettings.profileDepth} onChange={e => setAiSettings(s => ({ ...s, profileDepth: e.target.value }))}>
              <option value="full">Full behavioral</option>
              <option value="work_only">Work only</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Claude Code Model Credits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Claude Code Model Credits</CardTitle>
          <CardDescription>Credit cost per prompt for each Claude model.</CardDescription>
        </CardHeader>
        <CardContent>
          {creditsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium">Tier</th>
                  <th className="py-2 font-medium w-24">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ccCredits.map((mc: any) => (
                  <tr key={mc.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 font-medium">{mc.model}</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${mc.tier === 'unknown' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>
                        {mc.tier || 'unknown'}{mc.tier === 'unknown' ? ' ⚠' : ''}
                      </span>
                    </td>
                    <td className="py-2">
                      <Input
                        type="number"
                        className="h-7 w-20"
                        defaultValue={mc.credits}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                          const val = Number(e.target.value)
                          if (val !== mc.credits && val >= 0) {
                            updateModelCredit(mc.id, val, mc.tier)
                            setCcCredits(prev => prev.map(c => c.id === mc.id ? { ...c, credits: val } : c))
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Codex Model Credits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Codex Model Credits</CardTitle>
          <CardDescription>Credit cost per prompt for each OpenAI Codex model.</CardDescription>
        </CardHeader>
        <CardContent>
          {creditsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium">Tier</th>
                  <th className="py-2 font-medium w-24">Credits</th>
                </tr>
              </thead>
              <tbody>
                {codexCredits.map((mc: any) => (
                  <tr key={mc.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 font-medium">{mc.model}</td>
                    <td className="py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${mc.tier === 'unknown' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>
                        {mc.tier || 'unknown'}{mc.tier === 'unknown' ? ' ⚠' : ''}
                      </span>
                    </td>
                    <td className="py-2">
                      <Input
                        type="number"
                        className="h-7 w-20"
                        defaultValue={mc.credits}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                          const val = Number(e.target.value)
                          if (val !== mc.credits && val >= 0) {
                            updateModelCredit(mc.id, val, mc.tier)
                            setCodexCredits(prev => prev.map(c => c.id === mc.id ? { ...c, credits: val } : c))
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
