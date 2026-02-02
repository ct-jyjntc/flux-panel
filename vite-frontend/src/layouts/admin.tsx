import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@heroui/button";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/dropdown";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/modal";
import { Input } from "@heroui/input";
import { toast } from 'react-hot-toast';
import { Avatar } from "@heroui/avatar";

import { updatePassword } from '@/api';
import { safeLogout } from '@/utils/logout';
import { siteConfig, getCachedConfigs } from '@/config/site';
import { 
  SunFilledIcon, 
  MoonFilledIcon,
  SpeedLimitIcon,
  UserIcon,
  WebsiteConfigIcon
} from "@/components/icons";
import { useTheme } from "@heroui/use-theme";

interface MenuItem {
  key: string;
  path: string;
  label: string;
  icon: React.ReactNode;
  group?: string;
  adminOnly?: boolean;
}

interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const { theme, setTheme } = useTheme();

  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuVisible, setMobileMenuVisible] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 240;
    try {
      const saved = localStorage.getItem('sidebar-width');
      const value = saved ? parseInt(saved, 10) : 240;
      if (Number.isNaN(value)) return 240;
      return Math.min(Math.max(value, 240), 420);
    } catch {
      return 240;
    }
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarWidthRef = React.useRef(sidebarWidth);
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [visibleMenuKeys, setVisibleMenuKeys] = useState<Set<string> | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const cached = localStorage.getItem('vite_config_sidebar_visible_items');
      if (!cached) return null;
      const keys = cached.split(',').map((v) => v.trim()).filter(Boolean);
      return new Set(keys);
    } catch {
      return null;
    }
  });
  const [menuVisibilityReady, setMenuVisibilityReady] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return Boolean(localStorage.getItem('vite_config_sidebar_visible_items'));
    } catch {
      return false;
    }
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    newUsername: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // 菜单项配置
  const menuItems: MenuItem[] = [
    {
      key: '/dashboard',
      path: '/dashboard',
      label: '主页',
      group: 'main',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    {
      key: '/forward',
      path: '/forward',
      label: '转发规则',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      )
    },
    {
      key: '/tunnel',
      path: '/tunnel',
      label: '隧道管理',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    },
    {
      key: '/store',
      path: '/store',
      label: '商城',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      )
    },
    {
      key: '/orders',
      path: '/orders',
      label: '我的订单',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      )
    },
    {
      key: '/looking-glass',
      path: '/looking-glass',
      label: 'LookingGlass',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )
    },
    {
      key: '/node',
      path: '/node',
      label: '节点状态',
      group: 'features',
      icon: (
         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      )
    },
    {
      key: '/limit',
      path: '/limit',
      label: '限速管理',
      group: 'admin',
      adminOnly: true,
      icon: (
        <SpeedLimitIcon size={20} />
      )
    },
    {
      key: '/user',
      path: '/user',
      label: '用户管理',
      group: 'admin',
      adminOnly: true,
      icon: (
        <UserIcon size={20} />
      )
    },
    {
      key: '/config',
      path: '/config',
      label: '网站配置',
      group: 'admin',
      adminOnly: true,
      icon: (
        <WebsiteConfigIcon size={20} />
      )
    },
  ];

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
      if (window.innerWidth >= 1024) {
        setMobileMenuVisible(false);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    // 恢复用户信息
    const savedName = localStorage.getItem('name') || localStorage.getItem('username');
    if (savedName) setUsername(savedName);

    let adminFlag = localStorage.getItem('admin') === 'true';
    if (localStorage.getItem('admin') === null) {
      const roleId = parseInt(localStorage.getItem('role_id') || '1', 10);
      adminFlag = roleId === 0;
      localStorage.setItem('admin', adminFlag.toString());
    }
    setIsAdmin(adminFlag);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMouseMove = (event: MouseEvent) => {
      const min = 240;
      const max = 420;
      const next = Math.min(Math.max(event.clientX, min), max);
      setSidebarWidth(next);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      try {
        localStorage.setItem('sidebar-width', String(sidebarWidthRef.current));
      } catch {
        // ignore storage errors
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    const loadVisibleMenu = async () => {
      try {
        const configs = await getCachedConfigs();
        const value = configs.sidebar_visible_items;
        if (!value) {
          setVisibleMenuKeys(null);
          setMenuVisibilityReady(true);
          return;
        }
        const keys = value.split(',').map((v) => v.trim()).filter(Boolean);
        setVisibleMenuKeys(new Set(keys));
        setMenuVisibilityReady(true);
      } catch {
        setVisibleMenuKeys(null);
        setMenuVisibilityReady(true);
      }
    };
    loadVisibleMenu();
  }, []);

  const handleLogout = () => {
    safeLogout();
    navigate('/');
    toast.success('已安全退出');
  };

  const handlePasswordChange = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast.error('请填写完整信息');
      return;
    }

    try {
      setPasswordLoading(true);
      const res = await updatePassword({
        newUsername: passwordForm.newUsername || undefined,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });

      if (res.code === 200) {
        toast.success(res.msg || '修改成功，请重新登录');
        onOpenChange();
        setTimeout(() => {
          safeLogout();
          navigate('/');
        }, 1500);
      } else {
        toast.error(res.msg || '修改失败');
      }
    } catch (error) {
      toast.error('请求失败');
    } finally {
      setPasswordLoading(false);
    }
  };

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar-collapsed', next ? 'true' : 'false');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const currentPathLabel = menuItems.find(item => item.path === location.pathname)?.label || 'Flux Panel';
  const sidebarCollapsed = !isMobile && isSidebarCollapsed;
  const sidebarExpandedWidth = `${sidebarWidth}px`;
  const sidebarCollapsedWidth = '5rem';
  const contentMarginLeft = isMobile
    ? '0px'
    : `calc(${sidebarCollapsed ? sidebarCollapsedWidth : sidebarExpandedWidth} + 1rem)`;

  // Mobile Header
  const MobileHeader = () => (
    <div className="lg:hidden md-top-app-bar flex items-center justify-between px-4 h-[60px]">
      <div className="flex items-center gap-3">
         <button
          onClick={() => setMobileMenuVisible(!mobileMenuVisible)}
          className="md-icon-btn h-9 w-9 flex items-center justify-center"
          aria-label="打开菜单"
         >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
         </button>
         <span className="font-semibold tracking-tight text-sm">{siteConfig.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <Dropdown>
              <DropdownTrigger>
                <Avatar
                  size="sm"
                  name={username || "User"}
                  className="cursor-pointer bg-primary text-white"
                />
              </DropdownTrigger>
              <DropdownMenu aria-label="User Actions">
                <DropdownItem key="password" onPress={onOpen}>修改密码</DropdownItem>
                <DropdownItem key="logout" className="text-danger" color="danger" onPress={handleLogout}>
                  退出登录
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
      </div>
    </div>
  );
  
  // Sidebar Component
  const Sidebar = () => (
    <div
      className={`
      fixed left-0 top-0 bottom-0 md-nav-rail lg:top-4 lg:bottom-4 lg:left-4
      flex flex-col transition-all duration-300 z-50 lg:rounded-3xl overflow-hidden
      ${isMobile && !mobileMenuVisible ? '-translate-x-full' : 'translate-x-0'}
      lg:translate-x-0
    `}
      style={{ width: sidebarCollapsed ? sidebarCollapsedWidth : sidebarExpandedWidth }}
    >
      {/* Logo Area */}
      <div className={`h-16 flex items-center border-b border-gray-100/70 dark:border-gray-800/70 ${sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-6'}`}>
        {!sidebarCollapsed && (
          <span className="text-base font-semibold tracking-tight">
             {siteConfig.name}
          </span>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className="md-icon-btn w-8 h-8 flex items-center justify-center"
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {sidebarCollapsed ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {!isAdmin && !menuVisibilityReady ? (
          <div className="h-6" />
        ) : (
        <>
        {menuItems.map((item) => {
            // Check admin only
            if (item.adminOnly && !isAdmin) return null;
            if (!isAdmin && visibleMenuKeys && !visibleMenuKeys.has(item.key)) return null;

            const isActive = location.pathname === item.path;
            
            return (
              <div 
                key={item.path}
                onClick={() => {
                   navigate(item.path);
                   if (isMobile) setMobileMenuVisible(false);
                }}
                title={sidebarCollapsed ? item.label : undefined}
                className={`
                  md-nav-item flex items-center ${sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 cursor-pointer
                  ${isActive ? 'md-nav-item-active' : ''}
                `}
              >
                  {item.icon}
                  {!sidebarCollapsed && <span className="text-sm">{item.label}</span>}
              </div>
            );
        })}
        </>
        )}
      </div>
      {!isMobile && !sidebarCollapsed && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize"
          onMouseDown={() => setIsResizingSidebar(true)}
        />
      )}
    </div>
  );

  return (
    <div className="min-h-screen md-app flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <MobileHeader />

      {/* Sidebar */}
      <Sidebar />
      
      {/* Overlay for mobile sidebar */}
      {isMobile && mobileMenuVisible && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileMenuVisible(false)}
        />
      )}

      {/* Main Content Area */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{ marginLeft: contentMarginLeft }}
      >
        {/* Top Header (Desktop) */}
        <div className="hidden lg:flex h-[60px] md-top-app-bar px-6 items-center justify-between sticky top-0 z-30">
           {/* Breadcrumbs / Page Title */}
           <div className="font-semibold tracking-tight text-sm">
              {currentPathLabel}
           </div>

           {/* Right Actions */}
           <div className="flex items-center gap-3">
             <Button
                isIconOnly
                variant="light"
                onClick={() => {
                  const nextTheme = theme === "dark" ? "light" : "dark";
                  try {
                    localStorage.setItem('theme-preference', nextTheme);
                  } catch {
                    // ignore storage errors
                  }
                  setTheme(nextTheme);
                }}
                className="md-icon-btn h-8 w-8"
             >
                {theme === "dark" ? <SunFilledIcon size={20}/> : <MoonFilledIcon size={20}/>}
             </Button>

              <Dropdown>
                <DropdownTrigger>
                  <div className="md-chip h-8 px-3 cursor-pointer flex items-center">
                    <span className="text-sm font-medium max-w-[140px] truncate">
                      {username || '用户'}
                    </span>
                  </div>
                </DropdownTrigger>
                <DropdownMenu aria-label="User Actions">
                  <DropdownItem key="password" onPress={onOpen}>修改密码</DropdownItem>
                  <DropdownItem key="logout" className="text-danger" color="danger" onPress={handleLogout}>
                    退出登录
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
           </div>
        </div>

        {/* Page Content */}
        <div className="p-4 lg:p-6 mx-auto w-full max-w-full md-enter">
           {children}
        </div>
      </div>

       {/* 修改密码模态框 */}
       <Modal hideCloseButton isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent className="md-card md-card-elevated">
          {(onClose) => (
            <>
              <ModalHeader>修改密码</ModalHeader>
              <ModalBody>
                <Input
                  label="新用户名 (选填)"
                  placeholder="留空则不修改用户名"
                  value={passwordForm.newUsername}
                  onValueChange={(v) => setPasswordForm({ ...passwordForm, newUsername: v })}
                />
                <Input
                  label="当前密码"
                  type="password"
                  value={passwordForm.currentPassword}
                  onValueChange={(v) => setPasswordForm({ ...passwordForm, currentPassword: v })}
                />
                <Input
                  label="新密码"
                  type="password"
                  value={passwordForm.newPassword}
                  onValueChange={(v) => setPasswordForm({ ...passwordForm, newPassword: v })}
                />
                <Input
                  label="确认新密码"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onValueChange={(v) => setPasswordForm({ ...passwordForm, confirmPassword: v })}
                />
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button size="sm" color="primary" isLoading={passwordLoading} onPress={handlePasswordChange}>
                  确认修改
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
