import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, UserCog, Heart, Settings, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const menuItems = [
  { title: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { title: 'Students', path: '/students', icon: Users },
  { title: 'Staff', path: '/staff', icon: UserCog },
  { title: 'Parents', path: '/parents', icon: Heart },
  { title: 'Settings', path: '/settings', icon: Settings },
];

export const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <>
      {/* Mobile overlay */}
      {!isCollapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsCollapsed(true)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          bg-sidebar-background
          transition-all duration-300 ease-in-out
          ${isCollapsed ? '-translate-x-full lg:translate-x-0 lg:w-20' : 'translate-x-0 w-64'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="h-16 flex items-center justify-between px-6">
            {!isCollapsed && (
              <h1 className="text-xl font-bold text-sidebar-foreground flex items-center gap-2">
                <LayoutDashboard className="h-6 w-6" />
                Daycare Nest
              </h1>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="lg:flex text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              {isCollapsed ? <Menu className="h-5 w-5" /> : <X className="h-5 w-5" />}
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-md transition-all
                    ${
                      isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }
                    ${isCollapsed ? 'justify-center' : ''}
                    `
                  }
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && <span className="text-sm">{item.title}</span>}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Mobile menu button */}
      {isCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(false)}
          className="fixed bottom-4 left-4 z-40 lg:hidden bg-sidebar-background border border-sidebar-border"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
    </>
  );
};
