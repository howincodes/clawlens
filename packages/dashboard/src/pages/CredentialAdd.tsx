import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startOAuthFlow, exchangeOAuthCode } from '../lib/api';

type Step = 'login' | 'code' | 'success';

export default function CredentialAdd() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('login');
  const [flowId, setFlowId] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const handleStartFlow = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await startOAuthFlow();
      setFlowId(data.flowId);
      setAuthUrl(data.authUrl);
      window.open(data.authUrl, '_blank');
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth flow');
    } finally {
      setLoading(false);
    }
  };

  const handleExchangeCode = async () => {
    if (!code.trim()) {
      setError('Please paste the code from the callback page');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await exchangeOAuthCode(flowId, code.trim());
      setResult(data);
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to exchange code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add Claude Subscription</h1>
        <p className="text-muted-foreground">Connect a Claude account via OAuth to manage its credentials.</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 text-sm">
        <div className={`flex items-center gap-1.5 ${step === 'login' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === 'login' ? 'bg-primary text-primary-foreground' : step === 'code' || step === 'success' ? 'bg-green-500 text-white' : 'bg-muted'}`}>
            {step === 'code' || step === 'success' ? '✓' : '1'}
          </span>
          Login
        </div>
        <div className="w-8 h-px bg-border" />
        <div className={`flex items-center gap-1.5 ${step === 'code' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === 'code' ? 'bg-primary text-primary-foreground' : step === 'success' ? 'bg-green-500 text-white' : 'bg-muted'}`}>
            {step === 'success' ? '✓' : '2'}
          </span>
          Verify
        </div>
        <div className="w-8 h-px bg-border" />
        <div className={`flex items-center gap-1.5 ${step === 'success' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === 'success' ? 'bg-green-500 text-white' : 'bg-muted'}`}>3</span>
          Done
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm border border-red-200">
          {error}
        </div>
      )}

      {/* Step 1: Login */}
      {step === 'login' && (
        <div className="border rounded-lg p-6 space-y-4">
          <h2 className="font-semibold">Step 1: Open Claude Login</h2>
          <p className="text-sm text-muted-foreground">
            Click the button below to open Claude's login page in a new tab.
            Log in with the account you want to add to the vault.
          </p>
          <button
            onClick={handleStartFlow}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm disabled:opacity-50"
          >
            {loading ? 'Opening...' : 'Open Claude Login'}
          </button>
        </div>
      )}

      {/* Step 2: Paste code */}
      {step === 'code' && (
        <div className="border rounded-lg p-6 space-y-4">
          <h2 className="font-semibold">Step 2: Paste the Authorization Code</h2>
          <p className="text-sm text-muted-foreground">
            After logging in, you'll be redirected to a page showing a code.
            Copy the entire text (including the part after #) and paste it below.
          </p>
          <p className="text-xs text-muted-foreground">
            If the login page didn't open, <a href={authUrl} target="_blank" rel="noopener" className="text-primary underline">click here</a>.
            The code expires in 5 minutes.
          </p>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste code here..."
            className="w-full px-3 py-2 border rounded-md text-sm font-mono bg-background"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleExchangeCode}
              disabled={loading || !code.trim()}
              className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Add Subscription'}
            </button>
            <button
              onClick={() => { setStep('login'); setCode(''); setError(''); }}
              className="px-4 py-2 rounded-md border text-sm hover:bg-muted"
            >
              Start Over
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success */}
      {step === 'success' && result && (
        <div className="border rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <span className="text-xl">✓</span>
            <h2 className="font-semibold">{result.isReauth ? 'Re-authenticated Successfully' : 'Subscription Added'}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Email</p>
              <p className="font-medium">{result.credential?.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Organization</p>
              <p className="font-medium">{result.credential?.organizationName || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Subscription</p>
              <p className="font-medium capitalize">{result.credential?.subscriptionType || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Expires</p>
              <p className="font-medium">{result.credential?.expiresAt ? new Date(result.credential.expiresAt).toLocaleString() : 'N/A'}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Tokens are encrypted and stored securely. The server will automatically refresh them before they expire.
          </p>
          <button
            onClick={() => navigate('/credentials')}
            className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm"
          >
            Go to Credential Vault
          </button>
        </div>
      )}
    </div>
  );
}
