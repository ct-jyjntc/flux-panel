import { useState, useEffect } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Textarea } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Spinner } from "@heroui/spinner";
import { Checkbox } from "@heroui/checkbox";
import toast from 'react-hot-toast';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";


import { 
  createForward, 
  getForwardList, 
  updateForward, 
  deleteForward,
  forceDeleteForward,
  userTunnel, 
  pauseForwardService,
  resumeForwardService,
  diagnoseForward,
  updateForwardOrder,
  batchDeleteForwards,
  batchUpdateForwardTunnel,
  getUserPackageInfo
} from "@/api";
import { JwtUtil } from "@/utils/jwt";
import { SearchIcon, ActivityIcon } from "@/components/icons";

interface UserInfo {
  flow: number;
  inFlow: number;
  outFlow: number;
  num: number;
  expTime?: string | number;
  flowResetTime?: number;
}

interface Forward {
  id: number;
  name: string;
  tunnelId: number;
  tunnelName: string;
  inIp: string;
  inNodeName?: string;
  inPort: number;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
  status: number;
  inFlow: number;
  outFlow: number;
  serviceRunning: boolean;
  createdTime: string;
  userName?: string;
  userId?: number;
  inx?: number;
}

interface Tunnel {
  id: number;
  name: string;
  inNodePortSta?: number;
  inNodePortEnd?: number;
}

interface ForwardForm {
  id?: number;
  userId?: number;
  name: string;
  tunnelId: number | null;
  inPort: number | null;
  remoteAddr: string;
  interfaceName?: string;
  strategy: string;
}

interface AddressItem {
  id: number;
  address: string;
  label?: string;
  copying: boolean;
}

interface DiagnosisResult {
  forwardName: string;
  timestamp: number;
  results: Array<{
    success: boolean;
    description: string;
    nodeName: string;
    nodeId: string;
    targetIp: string;
    targetPort?: number;
    message?: string;
    averageTime?: number;
    packetLoss?: number;
  }>;
}

// 添加分组接口
export default function ForwardPage() {
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<UserInfo>({ flow: 0, inFlow: 0, outFlow: 0, num: 0 });
  const [forwards, setForwards] = useState<Forward[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [filterTunnelId, setFilterTunnelId] = useState<string>("all");
  const [searchKeyword, setSearchKeyword] = useState('');
  
  // 拖拽排序相关状态
  const [forwardOrder, setForwardOrder] = useState<number[]>([]);
  
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [forwardToDelete, setForwardToDelete] = useState<Forward | null>(null);
  const [currentDiagnosisForward, setCurrentDiagnosisForward] = useState<Forward | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [addressModalTitle, setAddressModalTitle] = useState('');
  const [addressList, setAddressList] = useState<AddressItem[]>([]);
  
  // 导出相关状态
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportData, setExportData] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedTunnelForExport, setSelectedTunnelForExport] = useState<number | null>(null);
  
  // 导入相关状态
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [selectedTunnelForImport, setSelectedTunnelForImport] = useState<number | null>(null);
  const [importResults, setImportResults] = useState<Array<{
    line: string;
    success: boolean;
    message: string;
    forwardName?: string;
  }>>([]);
  
  // 表单状态
  const [form, setForm] = useState<ForwardForm>({
    name: '',
    tunnelId: null,
    inPort: null,
    remoteAddr: '',
    interfaceName: '',
    strategy: 'fifo'
  });
  
  // 表单验证错误
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [selectedTunnel, setSelectedTunnel] = useState<Tunnel | null>(null);
  const [selectedForwardKeys, setSelectedForwardKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [bulkUpdateModalOpen, setBulkUpdateModalOpen] = useState(false);
  const [bulkTunnelId, setBulkTunnelId] = useState<number | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // 加载所有数据
  const loadData = async (lod = true) => {
    setLoading(lod);
    try {
      const [forwardsRes, tunnelsRes, userRes] = await Promise.all([
        getForwardList(),
        userTunnel(),
        getUserPackageInfo()
      ]);
      
      if (userRes.code === 0) {
        const packageInfo = userRes.data || {};
        const info = packageInfo.userInfo || packageInfo;
        setUserInfo(info);
      }

      if (forwardsRes.code === 0) {
        const forwardsData = forwardsRes.data?.map((forward: any) => ({
          ...forward,
          serviceRunning: forward.status === 1
        })) || [];
        setForwards(forwardsData);
        
        // 初始化转发排序顺序（仅当前用户）
        const currentUserId = JwtUtil.getUserIdFromToken();
        let userForwards = forwardsData;
        if (currentUserId !== null) {
          userForwards = forwardsData.filter((f: Forward) => f.userId === currentUserId);
        }
        
        // 检查数据库中是否有排序信息
        const hasDbOrdering = userForwards.some((f: Forward) => f.inx !== undefined && f.inx !== 0);
        
        if (hasDbOrdering) {
          // 使用数据库中的排序信息
          const dbOrder = userForwards
            .sort((a: Forward, b: Forward) => (a.inx ?? 0) - (b.inx ?? 0))
            .map((f: Forward) => f.id);
          setForwardOrder(dbOrder);
          
          // 同步到localStorage
          try {
            localStorage.setItem('forward-order', JSON.stringify(dbOrder));
          } catch (error) {
            console.warn('无法保存排序到localStorage:', error);
          }
        } else {
          // 使用本地存储的顺序
          const savedOrder = localStorage.getItem('forward-order');
          if (savedOrder) {
            try {
              const orderIds = JSON.parse(savedOrder);
              // 验证保存的顺序是否仍然有效（只包含当前用户的转发）
              const validOrder = orderIds.filter((id: number) => 
                userForwards.some((f: Forward) => f.id === id)
              );
              // 添加新的转发ID（如果存在）
              userForwards.forEach((forward: Forward) => {
                if (!validOrder.includes(forward.id)) {
                  validOrder.push(forward.id);
                }
              });
              setForwardOrder(validOrder);
            } catch {
              setForwardOrder(userForwards.map((f: Forward) => f.id));
            }
          } else {
            setForwardOrder(userForwards.map((f: Forward) => f.id));
          }
        }
      } else {
        toast.error(forwardsRes.msg || '获取转发列表失败');
      }
      
      if (tunnelsRes.code === 0) {
        setTunnels(tunnelsRes.data || []);
      } else {
        console.warn('获取隧道列表失败:', tunnelsRes.msg);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    
    if (!form.name.trim()) {
      newErrors.name = '请输入转发名称';
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = '转发名称长度应在2-50个字符之间';
    }
    
    if (!form.tunnelId) {
      newErrors.tunnelId = '请选择关联隧道';
    }
    
    const trimmedRemoteAddr = form.remoteAddr.trim();
    if (!trimmedRemoteAddr) {
      newErrors.remoteAddr = '请输入远程地址';
    } else {
      // 验证地址格式
      const addresses = trimmedRemoteAddr.split('\n').map(addr => addr.trim()).filter(addr => addr);
      if (addresses.length > 1 || trimmedRemoteAddr.includes(',')) {
        newErrors.remoteAddr = '目标地址仅支持一个';
      } else {
      const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):\d+$/;
      const ipv6FullPattern = /^\[((([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4}|:))|(([0-9a-fA-F]{1,4}:){6}(:[0-9a-fA-F]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){5}(((:[0-9a-fA-F]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-fA-F]{1,4}:){4}(((:[0-9a-fA-F]{1,4}){1,3})|((:[0-9a-fA-F]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){3}(((:[0-9a-fA-F]{1,4}){1,4})|((:[0-9a-fA-F]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){2}(((:[0-9a-fA-F]{1,4}){1,5})|((:[0-9a-fA-F]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-fA-F]{1,4}:){1}(((:[0-9a-fA-F]{1,4}){1,6})|((:[0-9a-fA-F]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-fA-F]{1,4}){1,7})|((:[0-9a-fA-F]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))\]:\d+$/;
      const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*:\d+$/;
        const addr = addresses[0];
        if (!ipv4Pattern.test(addr) && !ipv6FullPattern.test(addr) && !domainPattern.test(addr)) {
          newErrors.remoteAddr = '目标地址格式错误';
        }
      }
    }
    
    if (form.inPort !== null && (form.inPort < 1 || form.inPort > 65535)) {
      newErrors.inPort = '端口号必须在1-65535之间';
    }
    
    if (selectedTunnel && selectedTunnel.inNodePortSta && selectedTunnel.inNodePortEnd && form.inPort) {
      if (form.inPort < selectedTunnel.inNodePortSta || form.inPort > selectedTunnel.inNodePortEnd) {
        newErrors.inPort = `端口号必须在${selectedTunnel.inNodePortSta}-${selectedTunnel.inNodePortEnd}范围内`;
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增转发
  const handleAdd = () => {
    setIsEdit(false);
    setShowAdvanced(false);
    setForm({
      name: '',
      tunnelId: null,
      inPort: null,
      remoteAddr: '',
      interfaceName: '',
      strategy: 'fifo'
    });
    setSelectedTunnel(null);
    setErrors({});
    setModalOpen(true);
  };

  // 编辑转发
  const handleEdit = (forward: Forward) => {
    setIsEdit(true);
    setShowAdvanced(false);
    setForm({
      id: forward.id,
      userId: forward.userId,
      name: forward.name,
      tunnelId: forward.tunnelId,
      inPort: forward.inPort,
      remoteAddr: forward.remoteAddr,
      interfaceName: forward.interfaceName || '',
      strategy: forward.strategy || 'fifo'
    });
    const tunnel = tunnels.find(t => t.id === forward.tunnelId);
    setSelectedTunnel(tunnel || null);
    setErrors({});
    setModalOpen(true);
  };

  // 显示删除确认
  const handleDelete = (forward: Forward) => {
    setForwardToDelete(forward);
    setDeleteModalOpen(true);
  };

  // 确认删除转发
  const confirmDelete = async () => {
    if (!forwardToDelete) return;
    
    setDeleteLoading(true);
    try {
      const res = await deleteForward(forwardToDelete.id);
      if (res.code === 0) {
        toast.success('删除成功');
        setDeleteModalOpen(false);
        loadData();
      } else {
        // 删除失败，询问是否强制删除
        const confirmed = window.confirm(`常规删除失败：${res.msg || '删除失败'}\n\n是否需要强制删除？\n\n⚠️ 注意：强制删除不会去验证节点端是否已经删除对应的转发服务。`);
        if (confirmed) {
          const forceRes = await forceDeleteForward(forwardToDelete.id);
          if (forceRes.code === 0) {
            toast.success('强制删除成功');
            setDeleteModalOpen(false);
            loadData();
          } else {
            toast.error(forceRes.msg || '强制删除失败');
          }
        }
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 处理隧道选择变化
  const handleTunnelChange = (tunnelId: string) => {
    const tunnel = tunnels.find(t => t.id === parseInt(tunnelId));
    setSelectedTunnel(tunnel || null);
    setForm(prev => ({ ...prev, tunnelId: parseInt(tunnelId) }));
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setSubmitLoading(true);
    try {
      const processedRemoteAddr = form.remoteAddr.trim();
      
      let res;
      if (isEdit) {
        // 更新时确保包含必要字段
        const updateData = {
          id: form.id,
          userId: form.userId,
          name: form.name,
          tunnelId: form.tunnelId,
          inPort: form.inPort,
          remoteAddr: processedRemoteAddr,
          interfaceName: form.interfaceName,
          strategy: 'fifo'
        };
        res = await updateForward(updateData);
      } else {
        // 创建时不需要id和userId（后端会自动设置）
        const createData = {
          name: form.name,
          tunnelId: form.tunnelId,
          inPort: form.inPort,
          remoteAddr: processedRemoteAddr,
          interfaceName: form.interfaceName,
          strategy: 'fifo'
        };
        res = await createForward(createData);
      }
      
      if (res.code === 0) {
        toast.success(isEdit ? '修改成功' : '创建成功');
        setModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || '操作失败');
      }
    } catch (error) {
      console.error('提交失败:', error);
      toast.error('操作失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 处理服务开关
  const handleServiceToggle = async (forward: Forward) => {
    if (forward.status !== 1 && forward.status !== 0) {
      toast.error('转发状态异常，无法操作');
      return;
    }

    const targetState = !forward.serviceRunning;
    
    try {
      // 乐观更新UI
      setForwards(prev => prev.map(f => 
        f.id === forward.id 
          ? { ...f, serviceRunning: targetState }
          : f
      ));

      let res;
      if (targetState) {
        res = await resumeForwardService(forward.id);
      } else {
        res = await pauseForwardService(forward.id);
      }
      
      if (res.code === 0) {
        toast.success(targetState ? '服务已启动' : '服务已暂停');
        // 更新转发状态
        setForwards(prev => prev.map(f => 
          f.id === forward.id 
            ? { ...f, status: targetState ? 1 : 0 }
            : f
        ));
      } else {
        // 操作失败，恢复UI状态
        setForwards(prev => prev.map(f => 
          f.id === forward.id 
            ? { ...f, serviceRunning: !targetState }
            : f
        ));
        toast.error(res.msg || '操作失败');
      }
    } catch (error) {
      // 操作失败，恢复UI状态
      setForwards(prev => prev.map(f => 
        f.id === forward.id 
          ? { ...f, serviceRunning: !targetState }
          : f
      ));
      console.error('服务开关操作失败:', error);
      toast.error('网络错误，操作失败');
    }
  };

  // 诊断转发
  const handleDiagnose = async (forward: Forward) => {
    setCurrentDiagnosisForward(forward);
    setDiagnosisModalOpen(true);
    setDiagnosisLoading(true);
    setDiagnosisResult(null);

    try {
      const response = await diagnoseForward(forward.id);
      if (response.code === 0) {
        setDiagnosisResult(response.data);
      } else {
        toast.error(response.msg || '诊断失败');
        setDiagnosisResult({
          forwardName: forward.name,
          timestamp: Date.now(),
          results: [{
            success: false,
            description: '诊断失败',
            nodeName: '-',
            nodeId: '-',
            targetIp: forward.remoteAddr.split(',')[0] || '-',
            message: response.msg || '诊断过程中发生错误'
          }]
        });
      }
    } catch (error) {
      console.error('诊断失败:', error);
      toast.error('网络错误，请重试');
      setDiagnosisResult({
        forwardName: forward.name,
        timestamp: Date.now(),
        results: [{
          success: false,
          description: '网络错误',
          nodeName: '-',
          nodeId: '-',
          targetIp: forward.remoteAddr.split(',')[0] || '-',
          message: '无法连接到服务器'
        }]
      });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // 获取连接质量
  const getQualityDisplay = (averageTime?: number, packetLoss?: number) => {
    if (averageTime === undefined || packetLoss === undefined) return null;
    
    if (averageTime < 30 && packetLoss === 0) return { text: '🚀 优秀', color: 'success' };
    if (averageTime < 50 && packetLoss === 0) return { text: '✨ 很好', color: 'success' };
    if (averageTime < 100 && packetLoss < 1) return { text: '👍 良好', color: 'primary' };
    if (averageTime < 150 && packetLoss < 2) return { text: '😐 一般', color: 'warning' };
    if (averageTime < 200 && packetLoss < 5) return { text: '😟 较差', color: 'warning' };
    return { text: '😵 很差', color: 'danger' };
  };

  // 格式化流量
  const formatFlow = (value: number, unit: 'bytes' | 'gb' = 'bytes'): string => {
    if (unit === 'gb') {
      return `${value} GB`;
    }
    if (value === 0) return '0 B';
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(2) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MB';
    return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const formatExpireTime = (expTime?: string | number) => {
    if (!expTime) {
      return '永久有效';
    }
    const date = new Date(expTime);
    if (Number.isNaN(date.getTime())) {
      return String(expTime);
    }
    return date.toLocaleString();
  };

  // 格式化入口地址
  const formatInAddress = (ipString: string, port: number): string => {
    if (!ipString || !port) return '';
    
    const ips = ipString.split(',').map(ip => ip.trim()).filter(ip => ip);
    if (ips.length === 0) return '';
    
    if (ips.length === 1) {
      const ip = ips[0];
      if (ip.includes(':') && !ip.startsWith('[')) {
        return `[${ip}]:${port}`;
      } else {
        return `${ip}:${port}`;
      }
    }
    
    const firstIp = ips[0];
    let formattedFirstIp;
    if (firstIp.includes(':') && !firstIp.startsWith('[')) {
      formattedFirstIp = `[${firstIp}]`;
    } else {
      formattedFirstIp = firstIp;
    }
    
    return `${formattedFirstIp}:${port} (+${ips.length - 1})`;
  };



  // 显示地址列表弹窗
  const showAddressModal = (addressString: string, port: number | null, title: string, nameString?: string) => {
    if (!addressString) return;
    
    let addresses: string[];
    let labels: string[] = [];
    if (port !== null) {
      // 入口地址处理
      const ips = addressString.split(',').map(ip => ip.trim()).filter(ip => ip);
      const names = nameString ? nameString.split(',').map(name => name.trim()).filter(name => name) : [];
      if (ips.length <= 1) {
        copyToClipboard(formatInAddress(addressString, port), title);
        return;
      }
      addresses = ips.map((ip) => {
        const ipPort = ip.includes(':') && !ip.startsWith('[') ? `[${ip}]:${port}` : `${ip}:${port}`;
        return ipPort;
      });
      labels = names;
    } else {
      // 远程地址处理
      addresses = addressString.split(',').map(addr => addr.trim()).filter(addr => addr);
      if (addresses.length <= 1) {
        copyToClipboard(addressString, title);
        return;
      }
    }
    
    setAddressList(addresses.map((address, index) => ({
      id: index,
      address,
      label: labels[index],
      copying: false
    })));
    setAddressModalTitle(`${title} (${addresses.length}个)`);
    setAddressModalOpen(true);
  };

  // 复制到剪贴板
  const copyToClipboard = async (text: string, label: string = '内容') => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`已复制${label}`);
    } catch (error) {
      toast.error('复制失败');
    }
  };

  // 复制地址
  const copyAddress = async (addressItem: AddressItem) => {
    try {
      setAddressList(prev => prev.map(item => 
        item.id === addressItem.id ? { ...item, copying: true } : item
      ));
      await copyToClipboard(addressItem.address, '地址');
    } catch (error) {
      toast.error('复制失败');
    } finally {
      setAddressList(prev => prev.map(item => 
        item.id === addressItem.id ? { ...item, copying: false } : item
      ));
    }
  };

  // 复制所有地址
  const copyAllAddresses = async () => {
    if (addressList.length === 0) return;
    const allAddresses = addressList.map(item => item.address).join('\n');
    await copyToClipboard(allAddresses, '所有地址');
  };

    // 导出转发数据
  const handleExport = () => {
    setSelectedTunnelForExport(null);
    setExportData('');
    setExportModalOpen(true);
  };

  // 执行导出
  const executeExport = () => {
    if (!selectedTunnelForExport) {
      toast.error('请选择要导出的隧道');
      return;
    }

    setExportLoading(true);
    
    try {
      const forwardsToExport = getSortedForwards().filter(
        forward => forward.tunnelId === selectedTunnelForExport
      );
      
      if (forwardsToExport.length === 0) {
        toast.error('所选隧道没有转发数据');
        setExportLoading(false);
        return;
      }
      
      // 格式化导出数据：remoteAddr|name|inPort
      const exportLines = forwardsToExport.map(forward => {
        return `${forward.remoteAddr}|${forward.name}|${forward.inPort}`;
      });
      
      const exportText = exportLines.join('\n');
      setExportData(exportText);
    } catch (error) {
      console.error('导出失败:', error);
      toast.error('导出失败');
    } finally {
      setExportLoading(false);
    }
  };

  // 复制导出数据
  const copyExportData = async () => {
    await copyToClipboard(exportData, '转发数据');
  };

  // 导入转发数据
  const handleImport = () => {
    setImportData('');
    setImportResults([]);
    setSelectedTunnelForImport(null);
    setImportModalOpen(true);
  };

  // 执行导入
  const executeImport = async () => {
    if (!importData.trim()) {
      toast.error('请输入要导入的数据');
      return;
    }

    if (!selectedTunnelForImport) {
      toast.error('请选择要导入的隧道');
      return;
    }

    setImportLoading(true);
    setImportResults([]); // 清空之前的结果

    try {
      const lines = importData.trim().split('\n').filter(line => line.trim());
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const parts = line.split('|');
        
        if (parts.length < 2) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '格式错误：需要至少包含目标地址和转发名称'
          }, ...prev]);
          continue;
        }

        const [remoteAddr, name, inPort] = parts;
        
        if (!remoteAddr.trim() || !name.trim()) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '目标地址和转发名称不能为空'
          }, ...prev]);
          continue;
        }

        if (remoteAddr.includes(',')) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '目标地址仅支持一个，请移除多余地址'
          }, ...prev]);
          continue;
        }

        const trimmedRemoteAddr = remoteAddr.trim();
        const isValidFormat = (() => {
          if (!trimmedRemoteAddr) return false;
          if (trimmedRemoteAddr.startsWith('[')) {
            const endBracket = trimmedRemoteAddr.indexOf(']');
            if (endBracket <= 0) return false;
            const portPart = trimmedRemoteAddr.slice(endBracket + 1);
            if (!portPart.startsWith(':')) return false;
            const port = portPart.slice(1);
            return /^\d+$/.test(port);
          }
          return /^[^:\s]+:\d+$/.test(trimmedRemoteAddr);
        })();
        
        if (!isValidFormat) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '目标地址格式错误，应为 地址:端口 或 [IPv6]:端口'
          }, ...prev]);
          continue;
        }

        try {
          // 处理入口端口
          let portNumber: number | null = null;
          if (inPort && inPort.trim()) {
            const port = parseInt(inPort.trim());
            if (isNaN(port) || port < 1 || port > 65535) {
              setImportResults(prev => [{
                line,
                success: false,
                message: '入口端口格式错误，应为1-65535之间的数字'
              }, ...prev]);
              continue;
            }
            portNumber = port;
          }

          // 调用创建转发接口
          const response = await createForward({
            name: name.trim(),
            tunnelId: selectedTunnelForImport, // 使用用户选择的隧道
            inPort: portNumber, // 使用指定端口或自动分配
            remoteAddr: trimmedRemoteAddr,
            strategy: 'fifo'
          });

          if (response.code === 0) {
            setImportResults(prev => [{
              line,
              success: true,
              message: '创建成功',
              forwardName: name.trim()
            }, ...prev]);
          } else {
            setImportResults(prev => [{
              line,
              success: false,
              message: response.msg || '创建失败'
            }, ...prev]);
          }
        } catch (error) {
          setImportResults(prev => [{
            line,
            success: false,
            message: '网络错误，创建失败'
          }, ...prev]);
        }
      }
      
      
      toast.success(`导入执行完成`);
      
      // 导入完成后刷新转发列表
      await loadData(false);
    } catch (error) {
      console.error('导入失败:', error);
      toast.error('导入过程中发生错误');
    } finally {
      setImportLoading(false);
    }
  };

  // 获取状态显示
  const getStatusDisplay = (status: number) => {
    switch (status) {
      case 1:
        return { color: 'success', text: '正常' };
      case 0:
        return { color: 'warning', text: '暂停' };
      case -1:
        return { color: 'danger', text: '异常' };
      default:
        return { color: 'default', text: '未知' };
    }
  };

  // 根据排序顺序获取转发列表
  const getSortedForwards = (): Forward[] => {
    // 确保 forwards 数组存在且有效
    if (!forwards || forwards.length === 0) {
      return [];
    }
    
    // 仅显示当前用户的转发
    let filteredForwards = forwards;
    const currentUserId = JwtUtil.getUserIdFromToken();
    if (currentUserId !== null) {
      filteredForwards = forwards.filter(forward => forward.userId === currentUserId);
    }

    if (filterTunnelId !== "all") {
      const tunnelId = Number(filterTunnelId);
      if (!Number.isNaN(tunnelId)) {
        filteredForwards = filteredForwards.filter(forward => forward.tunnelId === tunnelId);
      }
    }

    const normalizedKeyword = searchKeyword.trim().toLowerCase();
    if (normalizedKeyword) {
      filteredForwards = filteredForwards.filter((forward) => {
        const haystack = [
          forward.name,
          forward.tunnelName,
          forward.remoteAddr,
          forward.inIp
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(normalizedKeyword);
      });
    }
    
    // 确保过滤后的转发列表有效
    if (!filteredForwards || filteredForwards.length === 0) {
      return [];
    }
    
    // 优先使用数据库中的 inx 字段进行排序
    const sortedForwards = [...filteredForwards].sort((a, b) => {
      const aInx = a.inx ?? 0;
      const bInx = b.inx ?? 0;
      return aInx - bInx;
    });
    
    // 如果数据库中没有排序信息，则使用本地存储的顺序
    if (forwardOrder && forwardOrder.length > 0 && sortedForwards.every(f => f.inx === undefined || f.inx === 0)) {
      const forwardMap = new Map(filteredForwards.map(f => [f.id, f]));
      const localSortedForwards: Forward[] = [];
      
      forwardOrder.forEach(id => {
        const forward = forwardMap.get(id);
        if (forward) {
          localSortedForwards.push(forward);
        }
      });
      
      // 添加不在排序列表中的转发（新添加的）
      filteredForwards.forEach(forward => {
        if (!forwardOrder.includes(forward.id)) {
          localSortedForwards.push(forward);
        }
      });
      
      return localSortedForwards;
    }
    
    return sortedForwards;
  };

  const selectedForwardIds = Array.from(selectedForwardKeys).map(key => Number(key)).filter(id => !Number.isNaN(id));
  const selectedForwardCount = selectedForwardIds.length;
  const visibleForwardIds = getSortedForwards().map(forward => forward.id);
  const allVisibleSelected = visibleForwardIds.length > 0 &&
    visibleForwardIds.every(id => selectedForwardKeys.has(id.toString()));
  const currentUserId = JwtUtil.getUserIdFromToken();
  const userForwardCount = currentUserId !== null
    ? forwards.filter((forward) => forward.userId === currentUserId).length
    : forwards.length;
  const tunnelFilterItems = [
    { id: 'all', name: '全部隧道' },
    ...tunnels.map((tunnel) => ({ id: tunnel.id.toString(), name: tunnel.name }))
  ];

  const handleBulkDelete = () => {
    if (selectedForwardCount === 0) return;
    setBulkDeleteModalOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (selectedForwardCount === 0) return;
    setBulkActionLoading(true);
    try {
      const res = await batchDeleteForwards(selectedForwardIds);
      if (res.code === 0) {
        const failed = res.data?.failed || 0;
        if (failed > 0) {
          toast.success(`已删除 ${res.data?.success || 0} 条，失败 ${failed} 条`);
        } else {
          toast.success('批量删除成功');
        }
        setSelectedForwardKeys(new Set());
        setBulkDeleteModalOpen(false);
        await loadData(false);
      } else {
        toast.error(res.msg || '批量删除失败');
      }
    } catch (error) {
      console.error('批量删除失败:', error);
      toast.error('网络错误，请重试');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkUpdateTunnel = () => {
    if (selectedForwardCount === 0) return;
    setBulkUpdateModalOpen(true);
  };

  const confirmBulkUpdateTunnel = async () => {
    if (selectedForwardCount === 0 || !bulkTunnelId) return;
    setBulkActionLoading(true);
    try {
      const res = await batchUpdateForwardTunnel(selectedForwardIds, bulkTunnelId);
      if (res.code === 0) {
        const failed = res.data?.failed || 0;
        if (failed > 0) {
          toast.success(`已更新 ${res.data?.success || 0} 条，失败 ${failed} 条`);
        } else {
          toast.success('批量更换隧道成功');
        }
        setSelectedForwardKeys(new Set());
        setBulkUpdateModalOpen(false);
        setBulkTunnelId(null);
        await loadData(false);
      } else {
        toast.error(res.msg || '批量更换隧道失败');
      }
    } catch (error) {
      console.error('批量更换隧道失败:', error);
      toast.error('网络错误，请重试');
    } finally {
      setBulkActionLoading(false);
    }
  };

  const SortableForwardRow = ({ forward }: { forward: Forward }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      setActivatorNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: forward.id });
    
    // Hide drag styles as we removed the handle column for cleaner look (kept functional if needed via row drag?)
    // Actually we keep it simple.
    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.6 : 1,
    };
    const statusDisplay = getStatusDisplay(forward.status);
    
    // Address processing
    const inIps = forward.inIp ? forward.inIp.split(',').map(ip => ip.trim()).filter(Boolean) : [];
    const hasMultiple = inIps.length > 1;
    const inNames = forward.inNodeName ? forward.inNodeName.split(',').map(name => name.trim()).filter(Boolean) : [];
    const hasMultipleNames = inNames.length > 1;
    const primaryName = inNames[0] || '';
    const primaryIp = inIps[0] || '';
    const formattedPrimaryIp = primaryIp && primaryIp.includes(':') && !primaryIp.startsWith('[')
      ? `[${primaryIp}]`
      : primaryIp;
    const inAddrDisplay = primaryIp
      ? (forward.inPort ? `${formattedPrimaryIp}:${forward.inPort}` : formattedPrimaryIp)
      : (forward.inIp || '未分配');

    return (
      <tr ref={setNodeRef} style={style} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors group">
        <td className="w-12 px-4 py-4 align-middle">
          <Checkbox
            aria-label={`Select ${forward.name}`}
            isSelected={selectedForwardKeys.has(forward.id.toString())}
            onValueChange={(checked) => {
              const nextKeys = new Set(selectedForwardKeys);
              if (checked) {
                nextKeys.add(forward.id.toString());
              } else {
                nextKeys.delete(forward.id.toString());
              }
              setSelectedForwardKeys(nextKeys);
            }}
          />
        </td>
        
        {/* Name */}
        <td className="px-4 py-3 align-middle">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <button
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                type="button"
                className="inline-flex items-center justify-center w-6 h-6 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600 cursor-grab active:cursor-grabbing"
                title="拖拽排序"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="4" r="1.2" />
                  <circle cx="11" cy="4" r="1.2" />
                  <circle cx="5" cy="8" r="1.2" />
                  <circle cx="11" cy="8" r="1.2" />
                  <circle cx="5" cy="12" r="1.2" />
                  <circle cx="11" cy="12" r="1.2" />
                </svg>
              </button>
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100 flex items-center gap-2">
                {forward.name}
                <span className="text-xs text-gray-400 font-normal">(#{forward.id})</span>
              </span>
            </div>
          </div>
        </td>

        {/* Ingress */}
        <td className="px-4 py-3 align-middle">
           <div className="flex flex-col gap-1">
             <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
               <span className="bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 px-1.5 py-0.5 rounded text-xs border border-orange-200 dark:border-orange-900/50">入口</span>
                {primaryName ? (
                  <>
                    <span className="font-medium text-gray-900 dark:text-gray-100" title={inNames.join(', ')}>
                      {primaryName}
                    </span>
                    {(hasMultipleNames || hasMultiple) && (
                      <span
                        className="bg-orange-50 text-orange-500 dark:bg-orange-900/20 dark:text-orange-400 px-1 rounded text-[10px] border border-orange-100 dark:border-orange-900/50 cursor-pointer"
                        onClick={() => showAddressModal(forward.inIp, forward.inPort, forward.name, forward.inNodeName)}
                      >
                        +{(hasMultipleNames ? inNames.length : inIps.length) - 1}
                      </span>
                    )}
                  </>
                ) : (
                 <>
                   <span>{inAddrDisplay}</span>
                   {hasMultiple && (
                     <span
                       className="bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400 px-1 rounded text-[10px] border border-red-100 dark:border-red-900/50 cursor-pointer"
                        onClick={() => showAddressModal(forward.inIp, forward.inPort, forward.name, forward.inNodeName)}
                     >
                       +{inIps.length - 1}
                     </span>
                   )}
                 </>
               )}
             </div>
              {primaryName && (
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span>{inAddrDisplay}</span>
                </div>
              )}
           </div>
        </td>

        {/* Egress */}
        <td className="px-4 py-3 align-middle">
           <div className="flex flex-col gap-1">
             <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded text-xs border border-green-200 dark:border-green-900/50">目标</span>
                <button
                  type="button"
                  className="truncate max-w-[200px] text-left hover:text-blue-600 dark:hover:text-blue-400 cursor-copy"
                  title="点击复制目标地址"
                  onClick={() => showAddressModal(forward.remoteAddr, null, "目标地址")}
                >
                   {forward.remoteAddr}
                </button>
             </div>
             <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                <span className="bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 px-1 rounded text-[10px]">倍率 1.0</span>
                <span className="truncate max-w-[150px]">{forward.tunnelName}</span>
             </div>
           </div>
        </td>

        {/* Traffic */}
        <td className="px-4 py-3 align-middle">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {formatFlow((forward.inFlow || 0) + (forward.outFlow || 0))}
          </span>
        </td>

        {/* Status */}
        <td className="px-4 py-3 align-middle">
           <span className={`text-sm ${forward.status === 1 ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
             {statusDisplay.text}
           </span>
        </td>

        {/* Actions */}
        <td className="px-4 py-3 align-middle text-right w-[180px]">
          <div className="flex justify-end gap-1">
            {/* Start/Stop */}
            <button 
              className={`w-7 h-7 rounded border bg-white dark:bg-zinc-900 flex items-center justify-center transition-colors ${forward.serviceRunning 
                ? 'border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-900/20' 
                : 'border-green-200 text-green-500 hover:bg-green-50 dark:border-green-900/60 dark:text-green-400 dark:hover:bg-green-900/20'}`}
              onClick={() => handleServiceToggle(forward)}
              title={forward.serviceRunning ? "暂停" : "启动"}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {forward.serviceRunning ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3L19 12L5 21V3Z" />
                )}
              </svg>
            </button>

            {/* Diagnose */}
            <button 
              className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors" 
              onClick={() => handleDiagnose(forward)} 
              title="诊断"
            >
              <ActivityIcon className="w-3.5 h-3.5" />
            </button>

             {/* Edit */}
             <button 
               className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors" 
               onClick={() => handleEdit(forward)} 
               title="编辑"
              >
               <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
               </svg>
            </button>
            
            {/* Delete */}
            <button 
              className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-500 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-red-900/20 dark:hover:text-red-400 flex items-center justify-center transition-colors" 
              onClick={() => handleDelete(forward)} 
              title="删除"
            >
               <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
               </svg>
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const visibleIds = getSortedForwards().map((forward) => forward.id);
    const oldIndex = visibleIds.indexOf(Number(active.id));
    const newIndex = visibleIds.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const newVisibleOrder = arrayMove(visibleIds, oldIndex, newIndex);
    const currentUserId = JwtUtil.getUserIdFromToken();
    const allForwardIds = forwards
      .filter((forward) => currentUserId === null || forward.userId === currentUserId)
      .map((forward) => forward.id);
    const baseOrder = forwardOrder.length > 0 ? forwardOrder : allForwardIds;
    const visibleSet = new Set(visibleIds);
    const updatedOrder: number[] = [];
    const queue = [...newVisibleOrder];
    baseOrder.forEach((id) => {
      if (visibleSet.has(id)) {
        const nextId = queue.shift();
        if (nextId !== undefined) {
          updatedOrder.push(nextId);
        }
      } else {
        updatedOrder.push(id);
      }
    });
    queue.forEach((id) => updatedOrder.push(id));

    setForwardOrder(updatedOrder);
    localStorage.setItem('forward-order', JSON.stringify(updatedOrder));
    setForwards((prev) => {
      const inxMap = new Map(updatedOrder.map((id, index) => [id, index + 1]));
      return prev.map((forward) => {
        const nextInx = inxMap.get(forward.id);
        if (!nextInx) return forward;
        return { ...forward, inx: nextInx };
      });
    });
    try {
      const res = await updateForwardOrder({
        forwards: updatedOrder.map((id, index) => ({ id, inx: index + 1 })),
      });
      if (res.code !== 0) {
        toast.error(res.msg || "同步排序失败");
      }
    } catch (error) {
      console.error("同步排序失败:", error);
      toast.error("同步排序失败，请重试");
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <span className="text-default-600">正在加载...</span>
          </div>
        </div>
      
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Toolbar */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
         {/* Stats and Controls Header */}
         <div className="flex flex-wrap items-center justify-between gap-4 text-sm mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
             <div className="flex items-center gap-6">
               <div className="flex items-center gap-2">
                   <span className="text-gray-500">流量:</span>
                   <span className="font-semibold text-gray-900 dark:text-gray-100">
                     {formatFlow((userInfo.inFlow || 0) + (userInfo.outFlow || 0))} / {formatFlow(userInfo.flow || 0, 'gb')}
                   </span>
               </div>
               <div className="flex items-center gap-2">
                   <span className="text-gray-500">到期:</span>
                   <span className="font-semibold text-gray-900 dark:text-gray-100">{formatExpireTime(userInfo.expTime)}</span>
               </div>
               <div className="flex items-center gap-2">
                   <span className="text-gray-500">规则数:</span>
                   <span className="font-semibold text-gray-900 dark:text-gray-100">{userForwardCount} / {userInfo.num}</span>
               </div>
             </div>
             
             {/* Action Buttons */}
             <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  color="primary" 
                  startContent={<span className="text-lg">+</span>}
                  onPress={handleAdd}
                >
                  添加规则
                </Button>
                <Button size="sm" variant="bordered" onPress={handleImport}>批量导入</Button>
                <Button size="sm" variant="bordered" onPress={handleExport}>批量导出</Button>
                <Button
                  size="sm"
                  variant="bordered"
                  onPress={handleBulkUpdateTunnel}
                  isDisabled={selectedForwardCount === 0}
                >
                  批量切换
                </Button>
                <Button
                  size="sm"
                  variant="bordered"
                  color="danger"
                  onPress={handleBulkDelete}
                  isDisabled={selectedForwardCount === 0}
                >
                  删除选中
                </Button>
             </div>
         </div>
         
         {/* Filter/Search Row */}
         <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 w-full max-w-xl flex-wrap">
                 <Input 
                   size="sm" 
                   placeholder="搜索规则" 
                   startContent={<SearchIcon size={16} />}
                   className="w-[240px]"
                   isClearable
                   value={searchKeyword}
                   onValueChange={(value) => setSearchKeyword(value)}
                   classNames={{
                      inputWrapper: "bg-gray-50 dark:bg-zinc-800 border-none shadow-none"
                   }}
                 />
                 <Select
                   size="sm"
                   className="w-[200px]"
                   selectedKeys={[filterTunnelId]}
                   onSelectionChange={(keys) => {
                     const selectedKey = Array.from(keys)[0] as string;
                     if (selectedKey) {
                       setFilterTunnelId(selectedKey);
                     }
                   }}
                   items={tunnelFilterItems}
                   classNames={{
                     trigger: "bg-gray-50 dark:bg-zinc-800 border-none shadow-none",
                     value: "text-sm"
                   }}
                 >
                   {(item) => (
                     <SelectItem key={item.id} textValue={item.name}>
                       {item.name}
                     </SelectItem>
                   )}
                 </Select>
                 <Button size="sm" variant="light" isIconOnly onPress={() => loadData(true)} title="刷新">
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                 </Button>
            </div>
            
             <div className="flex items-center gap-3">
                 <div className="text-xs text-gray-400">
                   共 {forwards.length} 条
                 </div>
                 {/* Pagination Placeholders */}
                 <div className="flex gap-1">
                    <button className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-xs hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-zinc-800">&lt;</button>
                    <button className="w-6 h-6 flex items-center justify-center rounded bg-blue-50 text-blue-600 text-xs font-bold border border-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-900/50">1</button>
                    <button className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-xs hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-zinc-800">&gt;</button>
                 </div>
             </div>
         </div>
      </div>

      {/* 2. Content Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden min-h-[400px]">
          {getSortedForwards().length > 0 ? (
            <div className="overflow-x-auto">
               <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={getSortedForwards().map((forward) => forward.id)}
                strategy={verticalListSortingStrategy}
              >
               <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                     <tr>
                        <th className="w-12 px-4 py-3">
                           <Checkbox
                            aria-label="全选"
                            isSelected={allVisibleSelected}
                            onValueChange={(checked) => {
                              const nextKeys = new Set(selectedForwardKeys);
                              if (checked) {
                                visibleForwardIds.forEach(id => nextKeys.add(id.toString()));
                              } else {
                                visibleForwardIds.forEach(id => nextKeys.delete(id.toString()));
                              }
                              setSelectedForwardKeys(nextKeys);
                            }}
                          />
                        </th>
                        <th className="px-4 py-3">规则名</th>
                        <th className="px-4 py-3">入口</th>
                        <th className="px-4 py-3">目标</th>
                        <th className="px-4 py-3">已用流量</th>
                        <th className="px-4 py-3">状态</th>
                        <th className="px-4 py-3 text-right">操作</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                      {getSortedForwards().map((forward) => (
                        <SortableForwardRow key={forward.id} forward={forward} />
                      ))}
                  </tbody>
               </table>
               </SortableContext>
            </DndContext>
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p>暂无转发规则</p>
                <Button size="sm" variant="light" color="primary" className="mt-2" onPress={handleAdd}>立即创建</Button>
             </div>
          )}
      </div>

        {/* 新增/编辑模态框 */}
        <Modal 
          isOpen={modalOpen} 
          onOpenChange={setModalOpen}
          size="lg"
          backdrop="blur"
          placement="center"
          scrollBehavior="outside"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-default-100 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isEdit ? '编辑转发' : '添加规则'}</h2>
                </ModalHeader>
                <ModalBody>
                  <div className="flex flex-col gap-6">
                    {/* 名称 */}
                    <div className="flex flex-col gap-2">
                       <label className="text-sm font-medium text-gray-700 dark:text-gray-300">名称</label>
                       <Input
                          placeholder="请输入规则名称"
                          value={form.name}
                          onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                          isInvalid={!!errors.name}
                          errorMessage={errors.name}
                          variant="bordered"
                          classNames={{
                             inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                             input: "text-sm"
                          }}
                        />
                    </div>
                    
                     {/* 入口 */}
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">入口</label>
                        <Select
                          placeholder="选择隧道节点"
                          selectedKeys={form.tunnelId ? [form.tunnelId.toString()] : []}
                          onSelectionChange={(keys) => {
                            const selectedKey = Array.from(keys)[0] as string;
                            if (selectedKey) {
                              handleTunnelChange(selectedKey);
                            }
                          }}
                          isInvalid={!!errors.tunnelId}
                          errorMessage={errors.tunnelId}
                          variant="bordered"
                          classNames={{
                             trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus:!border-blue-500 rounded-lg",
                             value: "text-sm",
                             popoverContent: "bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-800 shadow-lg rounded-lg"
                          }}
                        >
                          {tunnels.map((tunnel) => (
                            <SelectItem key={tunnel.id} >
                              {tunnel.name}
                            </SelectItem>
                          ))}
                        </Select>
                    </div>

                    
                    {/* 监听端口 */}
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">监听端口</label>
                        <Input
                          placeholder="留空则随机"
                          type="number"
                          value={form.inPort?.toString() || ''}
                          onChange={(e) => setForm(prev => ({ 
                            ...prev, 
                            inPort: e.target.value ? parseInt(e.target.value) : null 
                          }))}
                          isInvalid={!!errors.inPort}
                          //errorMessage={errors.inPort}
                          variant="bordered"
                          classNames={{
                             inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                             input: "text-sm"
                          }}
                        />
                        {errors.inPort && <span className="text-xs text-red-500">{errors.inPort}</span>}
                        {selectedTunnel && selectedTunnel.inNodePortSta && selectedTunnel.inNodePortEnd && (
                            <div className="text-xs text-gray-400">
                                允许范围: {selectedTunnel.inNodePortSta}-{selectedTunnel.inNodePortEnd}
                            </div>
                        )}
                    </div>
                    
                    {/* 目标地址 */}
                    <div className="flex flex-col gap-2">
                         <label className="text-sm font-medium text-gray-700 dark:text-gray-300">目标地址</label>
                         <Textarea
                           minRows={4}
                           placeholder={`一行一个，空行会被忽略，格式如下：

1.2.3.4:5678
[2001::]:80
example.com:443`}
                           value={form.remoteAddr}
                           onChange={(e) => setForm(prev => ({ ...prev, remoteAddr: e.target.value }))}
                           isInvalid={!!errors.remoteAddr}
                           errorMessage={errors.remoteAddr}
                           variant="bordered"
                           classNames={{
                             inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                             input: "text-sm font-mono placeholder:text-gray-400"
                          }}
                         />
                    </div>
                    
                    {/* 高级选项 (Accordion style toggler) */}
                     <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                        <button 
                           className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                           onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                           <span>高级选项</span>
                           <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                           </svg>
                        </button>
                        {showAdvanced && (
                          <div className="p-3 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-gray-800">
                             <Input
                              label="出口网卡名或IP"
                              labelPlacement="outside"
                              placeholder="请输入出口网卡名或IP"
                              value={form.interfaceName}
                              onChange={(e) => setForm(prev => ({ ...prev, interfaceName: e.target.value }))}
                              isInvalid={!!errors.interfaceName}
                              errorMessage={errors.interfaceName}
                              variant="bordered"
                              classNames={{
                                 inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                              }}
                              description="用于多IP服务器指定使用那个IP请求远程地址"
                            />
                        </div>
                        )}
                     </div>
                    
                  </div>
                </ModalBody>
                <ModalFooter className="gap-2">
                  <Button size="sm" variant="bordered" onPress={onClose} className="border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300">
                    取消
                  </Button>
                  <Button 
                    size="sm"
                    color="primary" 
                    onPress={handleSubmit}
                    isLoading={submitLoading}
                    className="bg-blue-600 font-medium shadow-sm"
                  >
                    确定
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 删除确认模态框 */}
        <Modal 
          isOpen={deleteModalOpen}
          onOpenChange={setDeleteModalOpen}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-danger">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p className="text-default-600">
                    确定要删除转发 <span className="font-semibold text-foreground">"{forwardToDelete?.name}"</span> 吗？
                  </p>
                  <p className="text-small text-default-500 mt-2">
                    此操作无法撤销，删除后该转发将永久消失。
                  </p>
                </ModalBody>
                <ModalFooter>
                  <Button size="sm" variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button 
                    size="sm"
                    color="danger" 
                    onPress={confirmDelete}
                    isLoading={deleteLoading}
                  >
                    确认删除
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 地址列表弹窗 */}
        <Modal 
          isOpen={addressModalOpen} 
          onClose={() => setAddressModalOpen(false)} 
          size="lg" 
          scrollBehavior="outside" 
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            <ModalHeader className="flex items-center justify-between gap-3">
              <span className="text-base">{addressModalTitle}</span>
              {addressList.length > 1 && (
                <Button size="sm" variant="light" onClick={copyAllAddresses} className="h-7 px-2">
                  复制全部
                </Button>
              )}
            </ModalHeader>
            <ModalBody className="pb-6">
              <div className="space-y-2 max-h-60 overflow-y-auto pt-1">
                {addressList.map((item) => (
                  <div
                    key={item.id}
                    className={`relative border border-default-200 dark:border-default-100 rounded-lg px-3 ${item.label ? "pt-4 pb-2" : "py-2"}`}
                  >
                    {item.label && (
                      <span className="absolute -top-2.5 left-3 px-2 text-[10px] leading-4 text-gray-500 bg-white dark:bg-[#18181b] z-10">
                        {item.label}
                      </span>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-sm text-foreground">{item.address}</code>
                      <Button
                        size="sm"
                        variant="light"
                        isLoading={item.copying}
                        onClick={() => copyAddress(item)}
                      >
                        复制
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>

        {/* 导出数据模态框 */}
        <Modal 
          isOpen={exportModalOpen} 
          onClose={() => {
            setExportModalOpen(false);
            setSelectedTunnelForExport(null);
            setExportData('');
          }} 
          
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold">导出转发数据</h2>
              <p className="text-small text-default-500">
                格式：目标地址|转发名称|入口端口
              </p>
            </ModalHeader>
            <ModalBody className="pb-6">
              <div className="space-y-4">
                {/* 隧道选择 */}
                <div>
                  <Select
                    label="选择导出隧道"
                    placeholder="请选择要导出的隧道"
                    selectedKeys={selectedTunnelForExport ? [selectedTunnelForExport.toString()] : []}
                    onSelectionChange={(keys) => {
                      const selectedKey = Array.from(keys)[0] as string;
                      setSelectedTunnelForExport(selectedKey ? parseInt(selectedKey) : null);
                    }}
                    variant="bordered"
                    isRequired
                  >
                    {tunnels.map((tunnel) => (
                      <SelectItem key={tunnel.id.toString()} textValue={tunnel.name}>
                        {tunnel.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* 导出按钮和数据 */}
                {exportData && (
                  <div className="flex justify-between items-center">
                    <Button 
                      color="primary" 
                      size="sm" 
                      onPress={executeExport}
                      isLoading={exportLoading}
                      isDisabled={!selectedTunnelForExport}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      }
                    >
                      重新生成
                    </Button>
                    <Button 
                      color="secondary" 
                      size="sm" 
                      onPress={copyExportData}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                        </svg>
                      }
                    >
                      复制
                    </Button>
                  </div>
                )}

                {/* 初始导出按钮 */}
                {!exportData && (
                  <div className="text-right">
                    <Button 
                      color="primary" 
                      size="sm" 
                      onPress={executeExport}
                      isLoading={exportLoading}
                      isDisabled={!selectedTunnelForExport}
                      startContent={
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      }
                    >
                      生成导出数据
                    </Button>
                  </div>
                )}

                {/* 导出数据显示 */}
                {exportData && (
                  <div className="relative">
                    <Textarea
                      value={exportData}
                      readOnly
                      variant="bordered"
                      minRows={10}
                      maxRows={20}
                      className="font-mono text-sm"
                      classNames={{
                        input: "font-mono text-sm"
                      }}
                      placeholder="暂无数据"
                    />
                  </div>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button 
                size="sm"
                variant="light" 
                onPress={() => setExportModalOpen(false)}
              >
                关闭
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 导入模态框 */}
        <Modal 
          isOpen={importModalOpen} 
          onOpenChange={setImportModalOpen} 
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
              <h2 className="text-xl font-bold">导入转发数据</h2>
              <p className="text-small text-default-500">
                格式：目标地址|转发名称|入口端口，每行一个，入口端口留空将自动分配可用端口
              </p>
              <p className="text-small text-default-400">
                目标地址仅支持单个地址(如：example.com:8080 或 [IPv6]:端口)
              </p>
            </ModalHeader>
            <ModalBody className="pb-6">
              <div className="space-y-4">
                {/* 隧道选择 */}
                <div>
                  <Select
                    label="选择导入隧道"
                    placeholder="请选择要导入的隧道"
                    selectedKeys={selectedTunnelForImport ? [selectedTunnelForImport.toString()] : []}
                    onSelectionChange={(keys) => {
                      const selectedKey = Array.from(keys)[0] as string;
                      setSelectedTunnelForImport(selectedKey ? parseInt(selectedKey) : null);
                    }}
                    variant="bordered"
                    isRequired
                  >
                    {tunnels.map((tunnel) => (
                      <SelectItem key={tunnel.id.toString()} textValue={tunnel.name}>
                        {tunnel.name}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {/* 输入区域 */}
                <div>
                  <Textarea
                    label="导入数据"
                    placeholder="请输入要导入的转发数据，格式：目标地址|转发名称|入口端口"
                    value={importData}
                    onChange={(e) => setImportData(e.target.value)}
                    variant="flat"
                    minRows={8}
                    maxRows={12}
                    classNames={{
                      input: "font-mono text-sm"
                    }}
                  />

                
                </div>

                {/* 导入结果 */}
                {importResults.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-base font-semibold">导入结果</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-default-500">
                          成功：{importResults.filter(r => r.success).length} / 
                          总计：{importResults.length}
                        </span>
                      </div>
                    </div>
                    
                    <div className="max-h-40 overflow-y-auto space-y-1" style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgb(156 163 175) transparent'
                    }}>
                      {importResults.map((result, index) => (
                        <div 
                          key={index} 
                          className={`p-2 rounded border ${
                            result.success 
                              ? 'bg-success-50 dark:bg-success-100/10 border-success-200 dark:border-success-300/20' 
                              : 'bg-danger-50 dark:bg-danger-100/10 border-danger-200 dark:border-danger-300/20'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {result.success ? (
                              <svg className="w-3 h-3 text-success-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3 text-danger-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                              </svg>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-xs font-medium ${
                                  result.success ? 'text-success-700 dark:text-success-300' : 'text-danger-700 dark:text-danger-300'
                                }`}>
                                  {result.success ? '成功' : '失败'}
                                </span>
                                <span className="text-xs text-default-500">|</span>
                                <code className="text-xs font-mono text-default-600 truncate">{result.line}</code>
                              </div>
                              <div className={`text-xs ${
                                result.success ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'
                              }`}>
                                {result.message}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button 
                size="sm"
                variant="light" 
                onPress={() => setImportModalOpen(false)}
              >
                关闭
              </Button>
              <Button 
                size="sm"
                color="warning" 
                onPress={executeImport}
                isLoading={importLoading}
                isDisabled={!importData.trim() || !selectedTunnelForImport}
              >
                开始导入
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 批量删除确认 */}
        <Modal
          isOpen={bulkDeleteModalOpen}
          onOpenChange={setBulkDeleteModalOpen}
          size="md"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold">批量删除转发</h2>
                  <span className="text-xs text-default-500">
                    将删除已选 {selectedForwardCount} 条转发
                  </span>
                </ModalHeader>
                <ModalBody>
                  <div className="text-sm text-default-600">
                    删除后将无法恢复，同时会清理对应的服务配置。
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button size="sm" variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    onPress={confirmBulkDelete}
                    isLoading={bulkActionLoading}
                  >
                    确认删除
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 批量更换隧道 */}
        <Modal
          isOpen={bulkUpdateModalOpen}
          onOpenChange={setBulkUpdateModalOpen}
          size="md"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold">批量更换隧道</h2>
                  <span className="text-xs text-default-500">
                    已选 {selectedForwardCount} 条转发
                  </span>
                </ModalHeader>
                <ModalBody>
                  <Select
                    label="目标隧道"
                    placeholder="请选择隧道"
                    selectedKeys={bulkTunnelId ? [bulkTunnelId.toString()] : []}
                    onSelectionChange={(keys) => {
                      const selectedKey = Array.from(keys)[0] as string;
                      setBulkTunnelId(selectedKey ? parseInt(selectedKey, 10) : null);
                    }}
                  >
                    {tunnels.map((tunnel) => (
                      <SelectItem key={tunnel.id.toString()} textValue={tunnel.name}>
                        {tunnel.name}
                      </SelectItem>
                    ))}
                  </Select>
                  <div className="text-xs text-default-500">
                    更换隧道后将自动重建转发规则。
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button size="sm" variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    color="primary"
                    onPress={confirmBulkUpdateTunnel}
                    isLoading={bulkActionLoading}
                    isDisabled={!bulkTunnelId}
                  >
                    确认更换
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 诊断结果模态框 */}
        <Modal 
          isOpen={diagnosisModalOpen}
          onOpenChange={setDiagnosisModalOpen}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-0",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-zinc-800/50 p-6">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">转发诊断结果</h2>
                    {currentDiagnosisForward && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                        <span className="truncate">{currentDiagnosisForward.name}</span>
                        <span className="text-gray-300">•</span>
                        <span>转发服务</span>
                      </div>
                    )}
                  </div>
                </ModalHeader>
                <ModalBody className="p-0">
                  {diagnosisLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="flex flex-col items-center gap-3">
                        <Spinner size="lg" color="primary" />
                        <span className="text-sm text-gray-500">正在诊断网络连通性...</span>
                      </div>
                    </div>
                  ) : diagnosisResult ? (
                    <div className="bg-white dark:bg-zinc-900">
                      <div className="grid grid-cols-[1fr_80px_80px_80px_80px] bg-gray-50 dark:bg-zinc-800/50 text-xs font-semibold text-gray-500 border-b border-gray-100 dark:border-gray-800 px-6 py-2">
                        <div>路径</div>
                        <div className="text-center">状态</div>
                        <div className="text-center">延迟(ms)</div>
                        <div className="text-center">丢包率</div>
                        <div className="text-center">质量</div>
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {diagnosisResult.results.map((result, index) => {
                          const quality = getQualityDisplay(result.averageTime, result.packetLoss);
                          const targetAddress = `${result.targetIp}${result.targetPort ? ':' + result.targetPort : ''}`;

                          return (
                            <div key={index} className="grid grid-cols-[1fr_80px_80px_80px_80px] px-6 py-4 items-center hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors">
                              <div className="min-w-0 pr-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{result.nodeName}</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-500">{result.description}</span>
                                </div>
                                <div className="text-xs text-gray-400 font-mono truncate">{targetAddress}</div>
                                {!result.success && (
                                  <div className="text-xs text-red-500 mt-1 truncate">
                                    {result.message || '连接失败'}
                                  </div>
                                )}
                              </div>
                              <div className="flex justify-center">
                                {result.success ? (
                                     <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                        成功
                                     </span>
                                ) : (
                                     <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                                        失败
                                     </span>
                                )}
                              </div>
                              <div className="text-center text-sm text-gray-700 dark:text-gray-300 font-mono">
                                {result.success ? result.averageTime?.toFixed(0) : '-'}
                              </div>
                              <div className="text-center text-sm text-gray-700 dark:text-gray-300 font-mono">
                                {result.success ? `${result.packetLoss?.toFixed(1)}%` : '-'}
                              </div>
                              <div className="flex justify-center">
                                {result.success && quality ? (
                                  <span className={`inline-flex w-2 h-2 rounded-full ${quality.color === 'success' ? 'bg-green-500' : quality.color === 'warning' ? 'bg-yellow-500' : 'bg-red-500'}`} title={quality.text}></span>
                                ) : (
                                  <span className="text-xs text-gray-300">-</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="w-16 h-16 bg-gray-50 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4 text-gray-300">
                           <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                           </svg>
                      </div>
                      <h3 className="text-gray-900 dark:text-gray-100 font-medium">暂无诊断数据</h3>
                      <p className="text-xs text-gray-500 mt-1">点击下方按钮开始诊断网络连接质量</p>
                    </div>
                  )}
                </ModalBody>
                <ModalFooter className="p-6">
                  <Button size="sm" variant="light" onPress={onClose}>
                    关闭
                  </Button>
                  {currentDiagnosisForward && (
                    <Button 
                      size="sm"
                      color="primary" 
                      onPress={() => handleDiagnose(currentDiagnosisForward)}
                      isLoading={diagnosisLoading}
                      className="font-medium"
                    >
                      重新诊断
                    </Button>
                  )}
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    
  );
} 
