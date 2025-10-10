# Frontend Context — Daycare SaaS

## Hosting & Delivery
- **Hosting:** Cloudflare Pages (default), fallback option AWS S3 + CloudFront.  
- **Nature of app:** Single Page Application (SPA) built with React Router.  
- **Delivery:** Static HTML/JS/CSS bundles served via global CDN.  

## Runtime Behavior
- **Dynamic content**: Pages adapt to user, role, permissions, and tenant.  
- **Personalization** happens **client-side** after API calls to backend (`/me/context`, role-based endpoints).  
- **Authentication:**  
  - Supabase handles login/SSO in browser.  
  - Session exchanged at backend → HttpOnly cookies set.  
  - Cookies automatically included in API requests.  

## API Integration
- **Backend:** FastAPI (Python) deployed on AWS Lambda via API Gateway (HTTP API).  
- **Contract:**  
  - Always consume APIs via HTTPS.  
  - Include cookies automatically; do not store tokens in JS.  
  - Handle 401 with silent refresh (retry once).  

## Frontend Responsibilities
- **Routing:** Client-side only (React Router). All paths fallback to `index.html`.  
- **UI Components:** Use shadcn/ui + Tailwind CSS.  
- **State Management:** Local state/hooks; fetch user context on load.  
- **Permissions:** Show/hide menus and actions based on `/me/context` response.  
- **File Uploads:** Call backend to request pre-signed URL, then upload directly to S3.  

## Constraints to Respect
- API payload limit: 10 MB.  
- Avoid long blocking calls; API requests should complete < 30s.  
- SPA must gracefully handle session expiry (auto-refresh or redirect to login).  

## Developer Notes
- Assume multi-tenant: UI should never allow tenant switching via client input.  
- Default theme: modern, minimal, accessible (childcare-friendly aesthetic).  
- Prepare for mobile-friendly responsive layouts.  

