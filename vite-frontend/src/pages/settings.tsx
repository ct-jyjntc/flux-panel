import { useState, useEffect } from 'react';
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { reinitializeBaseURL } from '@/api/network';
import { 
  getPanelAddresses, 
  savePanelAddress, 
  setCurrentPanelAddress, 
  deletePanelAddress, 
  validatePanelAddress,
} from '@/utils/panel';

interface PanelAddress {
  name: string;
  address: string;   
  inx: boolean;
}


export const SettingsPage = () => {
  const navigate = useNavigate();
  const [panelAddresses, setPanelAddresses] = useState<PanelAddress[]>([]);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');


  const setPanelAddressesFunc = (newAddress: PanelAddress[]) => {
    setPanelAddresses(newAddress); 
  }

  // 加载面板地址列表
  const loadPanelAddresses = async () => {
    (window as any).setPanelAddresses = setPanelAddressesFunc
    getPanelAddresses();
  };

  // 添加新面板地址
  const addPanelAddress = async () => {
    if (!newName.trim() || !newAddress.trim()) {
      toast.error('请输入名称和地址');
      return;
    }

    // 验证地址格式
    if (!validatePanelAddress(newAddress.trim())) {
      toast.error('地址格式不正确，请检查：\n• 必须是完整的URL格式\n• 必须以 http:// 或 https:// 开头\n• 支持域名、IPv4、IPv6 地址\n• 端口号范围：1-65535\n• 示例：http://192.168.1.100:3000');
      return;
    }
    (window as any).setPanelAddresses = setPanelAddressesFunc
    savePanelAddress(newName.trim(), newAddress.trim());
    setNewName('');
    setNewAddress('');
    toast.success('添加成功');
  };

  // 设置当前面板地址
  const setCurrentPanel = async (name: string) => {
    (window as any).setPanelAddresses = setPanelAddressesFunc
    setCurrentPanelAddress(name);
    reinitializeBaseURL();
  };

  // 删除面板地址
  const handleDeletePanelAddress = async (name: string) => {
    (window as any).setPanelAddresses = setPanelAddressesFunc
    deletePanelAddress(name);
    reinitializeBaseURL();
    toast.success('删除成功');
  };

  // 页面加载时获取数据
  useEffect(() => {
    loadPanelAddresses();
  }, []);

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4 mb-2">
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              onPress={() => navigate(-1)}
              className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">面板设置</h1>
      </div>

      {/* 添加面板 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary-500 rounded-full"></span>
            添加新面板地址
        </h2>
        <div className="flex flex-col gap-4 max-w-2xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="名称"
                  labelPlacement="outside"
                  placeholder="请输入面板名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  variant="bordered"
                  classNames={{
                      inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                      input: "text-sm"
                   }}
                />
                <Input
                  label="地址"
                  labelPlacement="outside"
                  placeholder="http://192.168.1.100:3000"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  variant="bordered"
                  classNames={{
                      inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                      input: "text-sm"
                   }}
                />
              </div>
              <div className="flex justify-end">
                <Button color="primary" onPress={addPanelAddress}>
                    添加地址
                </Button>
              </div>
        </div>
      </div>

      {/* 已保存列表 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
         <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary-500 rounded-full"></span>
            已保存的面板地址
        </h2>

            {panelAddresses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                 <svg className="w-12 h-12 mb-3 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                 </svg>
                 <p className="text-sm">暂无保存的面板地址</p>
              </div>
            ) : (
              <div className="border border-gray-100 dark:border-zinc-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800">
                {panelAddresses.map((panel, index) => (
                  <div key={index} className="p-4 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-gray-900 dark:text-white">{panel.name}</span>
                          {panel.inx && (
                            <span className="px-2 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-xs rounded border border-green-100 dark:border-green-800">
                              当前使用
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono bg-gray-50 dark:bg-zinc-800 inline-block px-2 py-0.5 rounded border border-gray-100 dark:border-zinc-700">
                            {panel.address}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        {!panel.inx && (
                          <Button
                            size="sm"
                            color="primary"
                            variant="flat"
                            onPress={() => setCurrentPanel(panel.name)}
                          >
                            设为当前
                          </Button>
                        )}
                        <Button
                          size="sm"
                          color="danger"
                          variant="light"
                          onPress={() => handleDeletePanelAddress(panel.name)}
                          isIconOnly
                          className="text-gray-400 hover:text-red-500"
                        >
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                           </svg>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  );
};
