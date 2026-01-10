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
import { siteConfig } from '@/config/site';
import { 
  SunFilledIcon, 
  MoonFilledIcon 
} from "@/components/icons";
import { useTheme } from "next-themes";

interface MenuItem {
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
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
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
      path: '/profile',
      label: '个人中心',
       group: 'main',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      )
    },
    {
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
      path: '/tunnel',
      label: '单端口隧道',
      group: 'features',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    },
    {
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
      path: '/node',
      label: '节点状态',
      group: 'features',
      icon: (
         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
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
    const savedName = localStorage.getItem('username');
    const roleId = localStorage.getItem('role_id');
    if (savedName) setUsername(savedName);
    if (roleId === '1') setIsAdmin(true);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogout = () => {
    safeLogout();
    navigate('/login');
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
          navigate('/login');
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

  const currentPathLabel = menuItems.find(item => item.path === location.pathname)?.label || 'Flux Panel';

  // Mobile Header
  const MobileHeader = () => (
    <div className="lg:hidden flex items-center justify-between p-4 bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2">
         <button onClick={() => setMobileMenuVisible(!mobileMenuVisible)}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
         </button>
         <span className="font-bold text-lg">{siteConfig.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <Dropdown>
              <DropdownTrigger>
                <Avatar 
                  size="sm" 
                  name={username || "User"} 
                  className="cursor-pointer bg-blue-500 text-white"
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
    <div className={`
      fixed left-0 top-0 bottom-0 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-gray-800
      w-64 flex flex-col transition-transform duration-300 z-50
      ${isMobile && !mobileMenuVisible ? '-translate-x-full' : 'translate-x-0'}
      lg:translate-x-0
    `}>
      {/* Logo Area */}
      <div className="h-16 flex items-center px-6 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-cyan-500">
           {siteConfig.name}
        </span>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {menuItems.map((item) => {
            // Check admin only
            if (item.adminOnly && !isAdmin) return null;

            const isActive = location.pathname === item.path;
            
            return (
              <div 
                key={item.path}
                onClick={() => {
                   navigate(item.path);
                   if (isMobile) setMobileMenuVisible(false);
                }}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all
                  ${isActive 
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 font-medium' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800'}
                `}
              >
                  {item.icon}
                  <span className="text-sm">{item.label}</span>
              </div>
            );
        })}
      </div>

      {/* Footer / Version if needed */}
      <div className="p-4 text-xs text-gray-400 text-center">
         v{siteConfig.version}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col lg:flex-row">
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
      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        {/* Top Header (Desktop) */}
        <div className="hidden lg:flex h-16 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-gray-800 px-6 items-center justify-between sticky top-0 z-30">
           {/* Breadcrumbs / Page Title */}
           <div className="font-bold text-gray-800 dark:text-white">
              {currentPathLabel}
           </div>

           {/* Right Actions */}
           <div className="flex items-center gap-4">
             <Button
                isIconOnly
                variant="light"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
             >
                {theme === "dark" ? <SunFilledIcon size={20}/> : <MoonFilledIcon size={20}/>}
             </Button>

              <Dropdown>
                <DropdownTrigger>
                  <div className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 p-1.5 rounded-full pr-3 transition-colors border border-transparent hover:border-gray-200">
                    <Avatar 
                       size="sm" 
                       name={username || "User"} 
                       className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-cyan-500 text-white"
                     />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200 max-w-[100px] truncate">
                      {username || '用户'}
                    </span>
                  </div>
                </DropdownTrigger>
                <DropdownMenu aria-label="User Actions">
                  <DropdownItem key="username" className="h-14 gap-2" textValue="Signed in as">
                    <p className="font-semibold">Signed in as</p>
                    <p className="font-semibold">{username}</p>
                  </DropdownItem>
                  <DropdownItem key="password" onPress={onOpen}>修改密码</DropdownItem>
                  <DropdownItem key="logout" className="text-danger" color="danger" onPress={handleLogout}>
                    退出登录
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
           </div>
        </div>

        {/* Page Content */}
        <div className="p-4 lg:p-6 mx-auto w-full max-w-full">
           {children}
        </div>
      </div>

       {/* 修改密码模态框 */}
       <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
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
                <Button variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button color="primary" isLoading={passwordLoading} onPress={handlePasswordChange}>
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
