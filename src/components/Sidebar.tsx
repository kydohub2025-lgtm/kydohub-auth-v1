import { NavLink } from 'react-router-dom';
import { 
  Home, School, Users, Heart, DoorOpen, Calendar, 
  Clock, Utensils, Settings, MessageSquare, CreditCard, 
  Receipt, DollarSign, GraduationCap, UserPlus, FileText, 
  BarChart3, Menu, X, ChevronDown, ChevronRight
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const menuItems = [
  { title: 'Home', path: '/dashboard', icon: Home },
  { 
    title: 'My School', 
    icon: School,
    children: [
      { title: 'Students', path: '/students', icon: Users },
      { title: 'Parents', path: '/parents', icon: Heart },
      { title: 'Rooms', path: '/rooms', icon: DoorOpen },
      { title: 'Calendar', path: '/calendar', icon: Calendar },
      { title: 'Schedules', path: '/schedules', icon: Clock },
      { title: 'Menu', path: '/menu', icon: Utensils },
      { title: 'Settings', path: '/settings', icon: Settings },
    ]
  },
  { title: 'Messaging', path: '/messaging', icon: MessageSquare },
  { title: 'Billing', path: '/billing', icon: CreditCard },
  { title: 'Expenses', path: '/expenses', icon: Receipt },
  { title: 'Staff & Payroll', path: '/staff', icon: DollarSign },
  { title: 'Learning', path: '/learning', icon: GraduationCap },
  { title: 'Admissions', path: '/admissions', icon: UserPlus },
  { title: 'Paperwork', path: '/paperwork', icon: FileText },
  { title: 'Reporting', path: '/reporting', icon: BarChart3 },
];

export const Sidebar = () => {
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(!isMobile);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['My School']);

  const toggleGroup = (title: string) => {
    setExpandedGroups(prev =>
      prev.includes(title)
        ? prev.filter(t => t !== title)
        : [...prev, title]
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          bg-sidebar-background border-r border-sidebar-border
          transition-transform duration-300 ease-in-out
          w-64
          ${isMobile && !isOpen ? '-translate-x-full' : 'translate-x-0'}
        `}
      >
        <div className="flex flex-col h-full overflow-y-auto">
          {/* Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border/50">
            <h1 className="text-lg font-bold text-sidebar-foreground flex items-center gap-2">
              <School className="h-5 w-5" />
              Daycare Nest
            </h1>
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="text-sidebar-foreground hover:bg-sidebar-accent"
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-4 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const hasChildren = 'children' in item && item.children;
              const isExpanded = expandedGroups.includes(item.title);

              if (hasChildren) {
                return (
                  <div key={item.title} className="space-y-1">
                    <button
                      onClick={() => toggleGroup(item.title)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 flex-shrink-0" />
                        <span className="text-sm font-medium">{item.title}</span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-4 space-y-1">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <NavLink
                              key={child.path}
                              to={child.path}
                              className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm
                                ${
                                  isActive
                                    ? 'bg-white text-sidebar-background font-medium shadow-sm'
                                    : 'text-sidebar-foreground/90 hover:bg-sidebar-accent'
                                }
                                `
                              }
                              onClick={() => isMobile && setIsOpen(false)}
                            >
                              <ChildIcon className="h-4 w-4 flex-shrink-0" />
                              <span>{child.title}</span>
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                    ${
                      isActive
                        ? 'bg-white text-sidebar-background font-medium shadow-sm'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent'
                    }
                    `
                  }
                  onClick={() => isMobile && setIsOpen(false)}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{item.title}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Mobile menu button */}
      {isMobile && !isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          size="icon"
          className="fixed top-4 left-4 z-40 bg-sidebar-background text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
    </>
  );
};
