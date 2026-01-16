import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import { Select, SelectItem } from "@heroui/select";
import toast from 'react-hot-toast';
import { updateConfigs } from '@/api';
import { isAdmin } from '@/utils/auth';
import { getCachedConfigs, clearConfigCache, updateSiteConfig } from '@/config/site';

// 简单的保存图标组件
const SaveIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17,21 17,13 7,13 7,21" />
    <polyline points="7,3 7,8 15,8" />
  </svg>
);

interface ConfigItem {
  key: string;
  label: string;
  placeholder?: string;
  description?: string;
  type: 'input' | 'switch' | 'select' | 'multi-select';
  options?: { label: string; value: string; description?: string }[];
  dependsOn?: string; // 依赖的配置项key
  dependsValue?: string; // 依赖的配置项值
}

const NODE_MONITOR_VISIBLE_KEY = 'node_monitor_visible_fields';
const NODE_MONITOR_FIELDS = [
  { key: 'name', label: '节点名称' },
  { key: 'inIp', label: '入口IP' },
  { key: 'portRange', label: '端口范围' },
  { key: 'ratio', label: '倍率' },
  { key: 'version', label: '版本' },
  { key: 'status', label: '状态' },
  { key: 'uptime', label: '在线时长' },
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: '内存' },
  { key: 'speed', label: '实时速率' },
  { key: 'traffic', label: '总流量' }
];
const NODE_MONITOR_DEFAULT_VALUE = NODE_MONITOR_FIELDS.map((field) => field.key).join(',');
const NODE_MONITOR_DEFAULTS: Record<string, string> = {
  [NODE_MONITOR_VISIBLE_KEY]: NODE_MONITOR_DEFAULT_VALUE
};
const NODE_MONITOR_LEGACY_KEYS: Record<string, string> = {
  name: 'node_monitor_show_name',
  inIp: 'node_monitor_show_in_ip',
  portRange: 'node_monitor_show_port_range',
  ratio: 'node_monitor_show_ratio',
  version: 'node_monitor_show_version',
  status: 'node_monitor_show_status',
  uptime: 'node_monitor_show_uptime',
  cpu: 'node_monitor_show_cpu',
  memory: 'node_monitor_show_memory',
  speed: 'node_monitor_show_speed',
  traffic: 'node_monitor_show_traffic'
};

const resolveNodeMonitorVisibleFields = (configMap: Record<string, string>): string => {
  if (Object.prototype.hasOwnProperty.call(configMap, NODE_MONITOR_VISIBLE_KEY)) {
    return configMap[NODE_MONITOR_VISIBLE_KEY] ?? '';
  }

  let hasLegacy = false;
  const selected: string[] = [];
  NODE_MONITOR_FIELDS.forEach((field) => {
    const legacyKey = NODE_MONITOR_LEGACY_KEYS[field.key];
    if (legacyKey && Object.prototype.hasOwnProperty.call(configMap, legacyKey)) {
      hasLegacy = true;
      if (configMap[legacyKey] === 'true') {
        selected.push(field.key);
      }
      return;
    }
    selected.push(field.key);
  });

  if (hasLegacy) {
    return selected.join(',');
  }

  return NODE_MONITOR_DEFAULT_VALUE;
};

// 网站配置项定义
const CONFIG_ITEMS: ConfigItem[] = [
  {
    key: 'ip',
    label: '面板后端地址',
    placeholder: '请输入面板后端IP:PORT',
    description: '格式“ip:port”,用于对接节点时使用,ip是你安装面板服务器的公网ip,端口是安装脚本内输入的后端端口。不要套CDN,不支持https,通讯数据有加密',
    type: 'input'
  },
  {
    key: 'app_name',
    label: '应用名称',
    placeholder: '请输入应用名称',
    description: '在浏览器标签页和导航栏显示的应用名称',
    type: 'input'
  },
  {
    key: 'captcha_enabled',
    label: '启用验证码',
    description: '开启后，用户登录时需要完成验证码验证',
    type: 'switch'
  },
  {
    key: 'captcha_type',
    label: '验证码类型',
    description: '选择验证码的显示类型，不同类型有不同的安全级别',
    type: 'select',
    dependsOn: 'captcha_enabled',
    dependsValue: 'true',
    options: [
      { 
        label: '随机类型', 
        value: 'RANDOM', 
        description: '系统随机选择验证码类型' 
      },
      { 
        label: '滑块验证码', 
        value: 'SLIDER', 
        description: '拖动滑块完成拼图验证' 
      },
      { 
        label: '文字点选验证码', 
        value: 'WORD_IMAGE_CLICK', 
        description: '按顺序点击指定文字' 
      },
      { 
        label: '旋转验证码', 
        value: 'ROTATE', 
        description: '旋转图片到正确角度' 
      },
      { 
        label: '拼图验证码', 
        value: 'CONCAT', 
        description: '拖动滑块完成图片拼接' 
      }
    ]
  },
  {
    key: NODE_MONITOR_VISIBLE_KEY,
    label: '节点监控 - 可见字段',
    description: '选择普通用户在节点监控中可查看的信息',
    type: 'multi-select',
    options: NODE_MONITOR_FIELDS.map((field) => ({
      label: field.label,
      value: field.key
    }))
  }
];

// 初始化时从缓存读取配置，避免闪烁
const getInitialConfigs = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  
  const configKeys = [
    'app_name',
    'captcha_enabled',
    'captcha_type',
    'ip',
    NODE_MONITOR_VISIBLE_KEY,
    ...Object.values(NODE_MONITOR_LEGACY_KEYS)
  ];
  const cachedConfigs: Record<string, string> = {};
  const initialConfigs: Record<string, string> = { ...NODE_MONITOR_DEFAULTS };
  
  try {
    configKeys.forEach(key => {
      const cachedValue = localStorage.getItem('vite_config_' + key);
      if (cachedValue !== null) {
        cachedConfigs[key] = cachedValue;
      }
    });
  } catch (error) {
  }

  const resolvedVisibleFields = resolveNodeMonitorVisibleFields(cachedConfigs);
  return {
    ...initialConfigs,
    ...cachedConfigs,
    [NODE_MONITOR_VISIBLE_KEY]: resolvedVisibleFields
  };
};

export default function ConfigPage() {
  const navigate = useNavigate();
  const initialConfigs = getInitialConfigs();
  const [configs, setConfigs] = useState<Record<string, string>>(initialConfigs);
  const [loading, setLoading] = useState(Object.keys(initialConfigs).length === 0); // 如果有缓存数据，不显示loading
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalConfigs, setOriginalConfigs] = useState<Record<string, string>>(initialConfigs);

  // 权限检查
  useEffect(() => {
    if (!isAdmin()) {
      toast.error('权限不足，只有管理员可以访问此页面');
      navigate('/dashboard', { replace: true });
      return;
    }
  }, [navigate]);

  // 加载配置数据（优先从缓存）
  const loadConfigs = async (currentConfigs?: Record<string, string>) => {
    const configsToCompare = currentConfigs || configs;
    const hasInitialData = Object.keys(configsToCompare).length > 0;
    
    // 如果已有缓存数据，不显示loading，静默更新
    if (!hasInitialData) {
      setLoading(true);
    }
    
    try {
      const configData = await getCachedConfigs();
      const resolvedVisibleFields = resolveNodeMonitorVisibleFields(configData);
      const mergedConfigData = {
        ...NODE_MONITOR_DEFAULTS,
        ...configData,
        [NODE_MONITOR_VISIBLE_KEY]: resolvedVisibleFields
      };
      
      // 只有在数据有变化时才更新
      const hasDataChanged = JSON.stringify(mergedConfigData) !== JSON.stringify(configsToCompare);
      if (hasDataChanged) {
        setConfigs(mergedConfigData);
        setOriginalConfigs({ ...mergedConfigData });
        setHasChanges(false);
      } else {
      }
    } catch (error) {
      // 只有在没有缓存数据时才显示错误
      if (!hasInitialData) {
        toast.error('加载配置出错，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 延迟加载，避免阻塞初始渲染
    const timer = setTimeout(() => {
      loadConfigs(initialConfigs);
    }, 100);

    return () => clearTimeout(timer);
  }, []); // 只在组件挂载时执行一次

  // 处理配置项变更
  const handleConfigChange = (key: string, value: string) => {
    let newConfigs = { ...configs, [key]: value };
    
    // 特殊处理：启用验证码时，如果验证码类型未设置，默认为随机
    if (key === 'captcha_enabled' && value === 'true') {
      if (!newConfigs.captcha_type) {
        newConfigs.captcha_type = 'RANDOM';
      }
    }
    
    setConfigs(newConfigs);
    
    // 检查是否有变更
    const hasChangesNow = Object.keys(newConfigs).some(
      k => newConfigs[k] !== originalConfigs[k]
    ) || Object.keys(originalConfigs).some(
      k => originalConfigs[k] !== newConfigs[k]
    );
    setHasChanges(hasChangesNow);
  };

  // 保存配置
  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await updateConfigs(configs);
      if (response.code === 0) {
        toast.success('配置保存成功');
        
        // 清除所有配置缓存，强制下次重新获取
        clearConfigCache();
        
        // 获取变更的配置项
        const changedKeys = Object.keys(configs).filter(
          key => configs[key] !== originalConfigs[key]
        );
        
        setOriginalConfigs({ ...configs });
        setHasChanges(false);
        
        // 如果应用名称发生变化，立即更新网站配置
        if (changedKeys.includes('app_name')) {
          await updateSiteConfig();
        }
        
        // 触发配置更新事件，通知其他组件
        window.dispatchEvent(new CustomEvent('configUpdated', { 
          detail: { changedKeys } 
        }));
      } else {
        toast.error('保存配置失败: ' + response.msg);
      }
    } catch (error) {
      toast.error('保存配置出错，请重试');
    } finally {
      setSaving(false);
    }
  };



  // 检查配置项是否应该显示（依赖检查）
  const shouldShowItem = (item: ConfigItem): boolean => {
    if (!item.dependsOn || !item.dependsValue) {
      return true;
    }
    return configs[item.dependsOn] === item.dependsValue;
  };

  // 渲染不同类型的配置项
  const renderConfigItem = (item: ConfigItem) => {
    const isChanged = hasChanges && configs[item.key] !== originalConfigs[item.key];
    
    switch (item.type) {
      case 'input':
        return (
          <Input
            value={configs[item.key] || ''}
            onChange={(e) => handleConfigChange(item.key, e.target.value)}
            placeholder={item.placeholder}
            variant="bordered"
            size="sm"
            classNames={{
                inputWrapper: `bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg ${isChanged ? "!border-orange-400" : ""}`,
                input: "text-sm",
            }}
          />
        );

      case 'switch':
        return (
          <Switch
            isSelected={configs[item.key] === 'true'}
            onValueChange={(checked) => handleConfigChange(item.key, checked ? 'true' : 'false')}
            color="primary"
            size="sm"
            classNames={{
              wrapper: isChanged ? "group-data-[selected=true]:bg-orange-400" : ""
            }}
          >
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {configs[item.key] === 'true' ? '已启用' : '已禁用'}
            </span>
          </Switch>
        );

      case 'select':
        return (
          <Select
            selectedKeys={configs[item.key] ? [configs[item.key]] : []}
            onSelectionChange={(keys) => {
              const selectedKey = Array.from(keys)[0] as string;
              if (selectedKey) {
                handleConfigChange(item.key, selectedKey);
              }
            }}
            placeholder="请选择配置项"
            variant="bordered"
            size="sm"
            classNames={{
                trigger: `bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg ${isChanged ? "!border-orange-400" : ""}`,
                value: "text-sm"
            }}
          >
            {item.options?.map((option) => (
              <SelectItem 
                key={option.value}
                description={option.description}
              >
                {option.label}
              </SelectItem>
            )) || []}
          </Select>
        );
      case 'multi-select': {
        const rawValue = configs[item.key] || '';
        const selectedValues = rawValue
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        return (
          <Select
            selectionMode="multiple"
            selectedKeys={new Set(selectedValues)}
            onSelectionChange={(keys) => {
              const values = Array.from(keys).map((value) => value.toString()).sort();
              handleConfigChange(item.key, values.join(','));
            }}
            placeholder="请选择可见字段"
            variant="bordered"
            size="sm"
            classNames={{
              trigger: `bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg ${isChanged ? "!border-orange-400" : ""}`,
              value: "text-sm"
            }}
          >
            {item.options?.map((option) => (
              <SelectItem key={option.value} description={option.description}>
                {option.label}
              </SelectItem>
            )) || []}
          </Select>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6">
        {/* 顶部工具栏 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
             <div className="flex items-center justify-between">
                 <div className="flex flex-col">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">系统配置</h2>
                    <p className="text-xs text-gray-500 mt-0.5">管理面板的核心设置选项</p>
                 </div>
                 
                 <Button
                    size="sm"
                    color={hasChanges ? "warning" : "primary"}
                    startContent={<SaveIcon className="w-4 h-4" />}
                    onPress={handleSave}
                    isLoading={saving}
                    isDisabled={!hasChanges}
                    className="font-medium"
                  >
                    {saving ? '保存中...' : hasChanges ? '保存变更' : '已保存'}
                  </Button>
             </div>
        </div>

        {/* 配置表单 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 min-h-[400px]">
           {loading ? (
             <div className="flex items-center justify-center h-64">
               <div className="flex flex-col items-center gap-3">
                 <Spinner size="lg" color="primary" />
                 <span className="text-gray-500 text-sm">正在加载配置...</span>
               </div>
             </div>
           ) : (
             <div className="space-y-6 max-w-3xl">
                {CONFIG_ITEMS.map((item) => {
                  if (!shouldShowItem(item)) return null;
                  
                  const isChanged = hasChanges && configs[item.key] !== originalConfigs[item.key];
                  
                  return (
                    <div key={item.key} className={`pb-6 last:pb-0 border-b border-gray-100 dark:border-zinc-800 last:border-0 ${isChanged ? "bg-orange-50/50 dark:bg-orange-900/10 -mx-4 px-4 py-4 rounded-lg border-transparent transition-colors" : ""}`}>
                       <div className="flex flex-col md:flex-row md:items-start gap-4">
                          <div className="md:w-1/3 flex flex-col gap-1">
                             <label className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                {item.label}
                                {isChanged && <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>}
                             </label>
                             {item.description && (
                               <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                 {item.description}
                               </p>
                             )}
                          </div>
                          <div className="md:w-2/3">
                             {renderConfigItem(item)}
                          </div>
                       </div>
                    </div>
                  );
                })}

                {hasChanges && (
                    <div className="fixed bottom-6 right-6 z-20 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 px-4 py-3 rounded-xl border border-orange-200 dark:border-orange-800 shadow-lg flex items-center gap-3 animate-slide-up">
                        <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></div>
                        <span className="text-sm font-medium">配置已修改，请记得保存</span>
                        <Button 
                           size="sm" 
                           color="warning" 
                           variant="flat" 
                           onPress={handleSave} 
                           isLoading={saving}
                           className="ml-2"
                        >
                            保存
                        </Button>
                    </div>
                )}
             </div>
           )}
        </div>
    </div>
  );
} 
