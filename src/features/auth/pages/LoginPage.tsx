import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/http';
import { authLoggedIn } from '@/lib/auth/events';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

async function supabasePasswordSignIn(email: string, password: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase env not configured (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY)');
  }
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({} as any));
    const msg = err?.error_description || err?.msg || `Supabase auth failed (${res.status})`;
    throw new Error(msg);
  }
  const data = await res.json();
  const token = data?.access_token as string | undefined;
  if (!token) throw new Error('No access token from Supabase');
  return token;
}

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [params] = useSearchParams();
  const next = useMemo(() => params.get('next') || '/dashboard', [params]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn('Supabase env not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // 1) Supabase sign-in to obtain access_token
      const accessToken = await supabasePasswordSignIn(email.trim(), password);

      // 2) Exchange token with backend (mints httpOnly cookies)
      const res: any = await api.post('/auth/exchange', {
        provider: 'supabase',
        token: accessToken,
        client: 'web',
      });

      // 209 → multiple tenants
      if (res && (res as any).tenants && Array.isArray((res as any).tenants)) {
        toast({ title: 'Choose an organization', description: 'Multiple memberships found for this user.' });
        // You can store tenants in sessionStorage and navigate to a tenant picker screen if present.
        sessionStorage.setItem('tenantChoices', JSON.stringify((res as any).tenants));
        // For now, redirect to dashboard; backend may require an explicit switch.
      }

      // Notify app and navigate
      authLoggedIn({});
      toast({ title: 'Welcome back!' });
      navigate(next, { replace: true });
    } catch (error: any) {
      const msg = error?.message || 'Failed to login. Please check your credentials.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Welcome Back</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to access your daycare dashboard
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@daycare.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Logging in...' : 'Login'}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              Don't have an account?{' '}
              <Link to="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export default LoginPage;
