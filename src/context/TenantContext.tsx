import { createContext, useContext, ReactNode } from 'react';

interface TenantContextType {
  tenantId: string;
  tenantName: string;
  role: string;
  permissions: string[];
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  // TODO: Extract from JWT token when Supabase is integrated
  // For now, using placeholder data
  const tenantData: TenantContextType = {
    tenantId: 'demo-tenant-001',
    tenantName: 'Sunshine Daycare',
    role: 'admin',
    permissions: ['read', 'write', 'delete'],
  };

  return (
    <TenantContext.Provider value={tenantData}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
