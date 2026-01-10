import React, { useState, useEffect } from 'react';
import { Button } from "@heroui/button";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/modal";
import { Input } from "@heroui/input";
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { isWebViewFunc } from '@/utils/panel';
import { siteConfig } from '@/config/site';
import { updatePassword } from '@/api';
import { safeLogout } from '@/utils/logout';
interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}


interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [username, setUsername] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    newUsername: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    // 获取用户信息
    const name = localStorage.getItem('name') || 'Admin';
    
    // 兼容处理：如果没有admin字段，根据role_id判断（0为管理员）
    let adminFlag = localStorage.getItem('admin') === 'true';
    if (localStorage.getItem('admin') === null) {
      const roleId = parseInt(localStorage.getItem('role_id') || '1', 10);
      adminFlag = roleId === 0;
      // 补充设置admin字段，避免下次再次判断
      localStorage.setItem('admin', adminFlag.toString());
    }
    
    setUsername(name);
    setIsAdmin(adminFlag);
  }, []);

  // 管理员菜单项
  const adminMenuItems: MenuItem[] = [
    {
      path: '/limit',
      label: '限速管理',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      ),
      color: 'bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400',
      description: '管理用户限速策略'
    },
    {
      path: '/user',
      label: '用户管理',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
      color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
      description: '管理系统用户'
    },
    {
      path: '/config',
      label: '网站配置',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
      ),
      color: 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400',
      description: '配置网站设置'
    }
  ];

  // 退出登录
  const handleLogout = () => {
    safeLogout();
    navigate('/', { replace: true });
  };

  // 密码表单验证
  const validatePasswordForm = (): boolean => {
    if (!passwordForm.newUsername.trim()) {
      toast.error('请输入新用户名');
      return false;
    }
    if (passwordForm.newUsername.length < 3) {
      toast.error('用户名长度至少3位');
      return false;
    }
    if (!passwordForm.currentPassword) {
      toast.error('请输入当前密码');
      return false;
    }
    if (!passwordForm.newPassword) {
      toast.error('请输入新密码');
      return false;
    }
    if (passwordForm.newPassword.length < 6) {
      toast.error('新密码长度不能少于6位');
      return false;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('两次输入密码不一致');
      return false;
    }
    return true;
  };

  // 提交密码修改
  const handlePasswordSubmit = async () => {
    if (!validatePasswordForm()) return;

    setPasswordLoading(true);
    try {
      const response = await updatePassword(passwordForm);
      if (response.code === 0) {
        toast.success('密码修改成功，请重新登录');
        onOpenChange();
        handleLogout();
      } else {
        toast.error(response.msg || '密码修改失败');
      }
    } catch (error) {
      toast.error('修改密码时发生错误');
      console.error('修改密码错误:', error);
    } finally {
      setPasswordLoading(false);
    }
  };

  // 重置密码表单
  const resetPasswordForm = () => {
    setPasswordForm({
      newUsername: '',
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* 用户信息卡片 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center text-blue-500">
             <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
               <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
             </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{username}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                isAdmin 
                  ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-900/50' 
                  : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-900/50'
              }`}>
                {isAdmin ? '管理员' : '普通用户'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                登录于 {new Date().toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 功能菜单 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-500 mb-4 px-1">快捷菜单</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* 管理员功能 */}
          {isAdmin && adminMenuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/30 hover:bg-white hover:border-gray-200 hover:shadow-sm dark:hover:bg-zinc-800 transition-all duration-200 group"
            >
              <div className={`w-10 h-10 ${item.color} rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                {item.icon}
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.label}</span>
              <span className="text-xs text-gray-400 mt-1">{item.description}</span>
            </button>
          ))}
          
          {/* 修改密码 */}
          <button
            onClick={onOpen}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/30 hover:bg-white hover:border-gray-200 hover:shadow-sm dark:hover:bg-zinc-800 transition-all duration-200 group"
          >
            <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">修改密码</span>
            <span className="text-xs text-gray-400 mt-1">更新账户安全设置</span>
          </button>
          
          {/* 退出登录 */}
          <button
            onClick={handleLogout}
            className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/30 hover:bg-white hover:border-red-100 hover:shadow-sm dark:hover:bg-red-900/10 transition-all duration-200 group"
          >
            <div className="w-10 h-10 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">退出登录</span>
            <span className="text-xs text-gray-400 mt-1">安全退出系统</span>
          </button>
        </div>
      </div>

       <div className="mt-auto pt-8 pb-4 text-center">
         <p className="text-xs text-gray-400 dark:text-gray-600">
           Powered by{' '}
           <a 
             href="https://github.com/bqlpfy/flux-panel" 
             target="_blank" 
             rel="noopener noreferrer"
             className="text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-400 transition-colors"
           >
             flux-panel
           </a>
         </p>
         <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
           v{ isWebViewFunc() ? siteConfig.app_version : siteConfig.version}
         </p>
       </div>

      {/* 修改密码弹窗 */}
      <Modal 
        isOpen={isOpen} 
        onOpenChange={() => {
          onOpenChange();
          resetPasswordForm();
        }}
        size="md"
        backdrop="blur"
        placement="center"
        scrollBehavior="outside"
        classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
        }}
      >
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader className="text-lg font-bold text-gray-900 dark:text-gray-100">修改密码</ModalHeader>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  <Input
                    label="新用户名"
                    labelPlacement="outside"
                    placeholder="请输入新用户名"
                    value={passwordForm.newUsername}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm(prev => ({ ...prev, newUsername: e.target.value }))}
                    variant="bordered"
                    classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                        input: "text-sm"
                     }}
                  />
                  <Input
                    label="当前密码"
                    labelPlacement="outside"
                    type="password"
                    placeholder="请输入当前密码"
                    value={passwordForm.currentPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                    variant="bordered"
                    classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                        input: "text-sm"
                     }}
                  />
                  <Input
                    label="新密码"
                    labelPlacement="outside"
                    type="password"
                    placeholder="请输入新密码（至少6位）"
                    value={passwordForm.newPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                    variant="bordered"
                    classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                        input: "text-sm"
                     }}
                  />
                  <Input
                    label="确认密码"
                    labelPlacement="outside"
                    type="password"
                    placeholder="请再次输入新密码"
                    value={passwordForm.confirmPassword}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    variant="bordered"
                    classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                        input: "text-sm"
                     }}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button size="sm" variant="light" onPress={onClose}>
                  取消
                </Button>
                <Button 
                  size="sm"
                  color="primary" 
                  onPress={handlePasswordSubmit}
                  isLoading={passwordLoading}
                >
                  确定
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
