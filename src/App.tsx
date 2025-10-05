import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layouts/AppLayout";
import { TenantLayout } from "@/components/layouts/TenantLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Students from "./pages/Students";
import Staff from "./pages/Staff";
import Parents from "./pages/Parents";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/login"
              element={
                <AppLayout>
                  <Login />
                </AppLayout>
              }
            />
            <Route
              path="/signup"
              element={
                <AppLayout>
                  <Signup />
                </AppLayout>
              }
            />

            {/* Protected routes */}
            <Route
              path="/dashboard"
              element={
                <TenantLayout>
                  <Dashboard />
                </TenantLayout>
              }
            />
            <Route
              path="/students"
              element={
                <TenantLayout>
                  <Students />
                </TenantLayout>
              }
            />
            <Route
              path="/staff"
              element={
                <TenantLayout>
                  <Staff />
                </TenantLayout>
              }
            />
            <Route
              path="/parents"
              element={
                <TenantLayout>
                  <Parents />
                </TenantLayout>
              }
            />
            <Route
              path="/settings"
              element={
                <TenantLayout>
                  <Settings />
                </TenantLayout>
              }
            />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
