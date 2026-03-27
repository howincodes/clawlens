import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Copy, Terminal } from "lucide-react"
import { fetchClient } from "@/lib/api"

export function AddUserModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [installCode, setInstallCode] = useState<string | null>(null)

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
      if (res && (res.install_code || res.token)) {
        setInstallCode(res.install_code || res.token)
      } else {
        setInstallCode(`(check server response)`)
      }
      onSuccess()
    } catch (err) {
      console.error(err)
      alert("Failed to create user")
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = () => {
    const cmd = `clawlens setup --code ${installCode} --server ${window.location.origin}`
    navigator.clipboard.writeText(cmd)
    alert("Copied!")
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-border relative">
        {!installCode ? (
          <>
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
                 </div>
               </CardContent>
               <CardFooter className="flex justify-end gap-2 bg-muted/20 border-t py-4">
                 <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
                 <Button type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create & Get Code'}</Button>
               </CardFooter>
            </form>
          </>
        ) : (
          <>
             <CardHeader>
               <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mb-2 mx-auto">
                 <Terminal className="w-6 h-6" />
               </div>
               <CardTitle className="text-center">User Created!</CardTitle>
               <CardDescription className="text-center">Run this command on {name}'s machine.</CardDescription>
             </CardHeader>
             <CardContent>
                <div className="relative">
                   <pre className="p-4 bg-muted border rounded-md w-full overflow-x-auto text-xs font-mono text-muted-foreground mr-10 whitespace-pre-wrap">
{`clawlens setup --code ${installCode} --server ${window.location.origin}`}
                   </pre>
                   <Button size="icon" variant="secondary" className="absolute top-2 right-2 h-8 w-8" onClick={copyToClipboard}>
                     <Copy className="w-4 h-4" />
                   </Button>
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
