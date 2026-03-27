import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Copy, Check, Terminal, Monitor, Apple } from "lucide-react"
import { fetchClient } from "@/lib/api"

export function AddUserModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [installCode, setInstallCode] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setName(val)
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetchClient('/users', {
        method: 'POST',
        body: JSON.stringify({ name, slug })
      })
      if (res?.install_code) {
        setInstallCode(res.install_code)
      }
      onSuccess()
    } catch (err) {
      console.error(err)
      alert("Failed to create user")
    } finally {
      setLoading(false)
    }
  }

  const serverUrl = window.location.origin

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const CopyButton = ({ text, label }: { text: string; label: string }) => (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7 shrink-0"
      onClick={() => copyText(text, label)}
      title="Copy"
    >
      {copied === label ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  )

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-lg border-border relative">
        {!installCode ? (
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle>Add New Developer</CardTitle>
              <CardDescription>Create a tracking profile and generate an installation code.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input id="name" value={name} onChange={handleNameChange} placeholder="Alice" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug Identifier</Label>
                <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="alice" required />
                <p className="text-xs text-muted-foreground">Lowercase, no spaces. Used in install codes.</p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 bg-muted/20 border-t py-4">
              <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading || !name || !slug}>{loading ? 'Creating...' : 'Create User'}</Button>
            </CardFooter>
          </form>
        ) : (
          <>
            <CardHeader>
              <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mb-2 mx-auto">
                <Terminal className="w-6 h-6" />
              </div>
              <CardTitle className="text-center">User Created!</CardTitle>
              <CardDescription className="text-center">Send these instructions to {name}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Install Code */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Install Code</Label>
                <div className="flex items-center gap-2 p-3 bg-muted border rounded-md">
                  <code className="text-sm font-bold flex-1">{installCode}</code>
                  <CopyButton text={installCode} label="code" />
                </div>
              </div>

              {/* Server URL */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Server URL</Label>
                <div className="flex items-center gap-2 p-3 bg-muted border rounded-md">
                  <code className="text-sm flex-1">{serverUrl}</code>
                  <CopyButton text={serverUrl} label="server" />
                </div>
              </div>

              {/* Install Commands */}
              <div className="space-y-3 pt-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Install Commands</Label>

                {/* Windows */}
                <div className="border rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b">
                    <Monitor className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-medium text-blue-600">Windows (PowerShell)</span>
                    <CopyButton
                      text={`irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.ps1 | iex`}
                      label="windows"
                    />
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
{`irm https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.ps1 | iex`}
                  </pre>
                </div>

                {/* macOS / Linux */}
                <div className="border rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-500/10 border-b">
                    <Apple className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-medium text-gray-600">macOS / Linux</span>
                    <CopyButton
                      text={`bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.sh)`}
                      label="mac"
                    />
                  </div>
                  <pre className="p-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
{`bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install-client.sh)`}
                  </pre>
                </div>

                <p className="text-xs text-muted-foreground">
                  The script will ask for the install code and server URL shown above.
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-center border-t py-4">
              <Button onClick={onClose} className="w-full">Done</Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  )
}
