import { useState, useEffect, useRef } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Textarea } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Switch } from "@heroui/switch";

import { Spinner } from "@heroui/spinner";
import toast from 'react-hot-toast';
import axios from 'axios';


import { 
  createNode, 
  getNodeList, 
  updateNode, 
  deleteNode,
  getNodeInstallCommand
} from "@/api";

interface Node {
  id: number;
  name: string;
  ip: string;
  serverIp: string;
  portSta: number;
  portEnd: number;
  outPort?: number | null;
  version?: string;
  ownerId?: number | null;
  trafficRatio?: number;
  http?: number; // 0 关 1 开
  tls?: number;  // 0 关 1 开
  socks?: number; // 0 关 1 开
  status: number; // 1: 在线, 0: 离线
  connectionStatus: 'online' | 'offline';
  systemInfo?: {
    cpuUsage: number;
    memoryUsage: number;
    uploadTraffic: number;
    downloadTraffic: number;
    uploadSpeed: number;
    downloadSpeed: number;
    uptime: number;
  } | null;
  copyLoading?: boolean;
}

interface NodeForm {
  id: number | null;
  name: string;
  ipString: string;
  serverIp: string;
  portSta: number;
  portEnd: number;
  outPort: number;
  trafficRatio: number;
  http: number; // 0 关 1 开
  tls: number;  // 0 关 1 开
  socks: number; // 0 关 1 开
}

export default function NodePage() {
  const [nodeList, setNodeList] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canCreateNode, setCanCreateNode] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogTitle, setDialogTitle] = useState('');
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<Node | null>(null);
  const [protocolDisabled, setProtocolDisabled] = useState(false);
  const [protocolDisabledReason, setProtocolDisabledReason] = useState('');
  const [form, setForm] = useState<NodeForm>({
    id: null,
    name: '',
    ipString: '',
    serverIp: '',
    portSta: 1000,
    portEnd: 65535,
    outPort: 1000,
    trafficRatio: 1,
    http: 0,
    tls: 0,
    socks: 0
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // 安装命令相关状态
  const [installCommandModal, setInstallCommandModal] = useState(false);
  const [installCommand, setInstallCommand] = useState('');
  const [currentNodeName, setCurrentNodeName] = useState('');
  const [showNodeAdvanced, setShowNodeAdvanced] = useState(false);
  
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    const adminFlag = localStorage.getItem('admin') === 'true';
    setIsAdmin(adminFlag);
    const allowNodeCreate = localStorage.getItem('allow_node_create') === '1';
    setCanCreateNode(adminFlag || allowNodeCreate);
    const storedUserId = localStorage.getItem('user_id');
    setCurrentUserId(storedUserId ? Number(storedUserId) : null);
    loadNodes();
    initWebSocket();
    
    return () => {
      closeWebSocket();
    };
  }, []);

  // 加载节点列表
  const loadNodes = async () => {
    setLoading(true);
    try {
      const res = await getNodeList();
      if (res.code === 0) {
        setNodeList(res.data.map((node: any) => ({
          ...node,
          connectionStatus: node.status === 1 ? 'online' : 'offline',
          systemInfo: null,
          copyLoading: false
        })));
      } else {
        toast.error(res.msg || '加载节点列表失败');
      }
    } catch (error) {
      toast.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 初始化WebSocket连接
  const initWebSocket = () => {
    if (websocketRef.current && 
        (websocketRef.current.readyState === WebSocket.OPEN || 
         websocketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    if (websocketRef.current) {
      closeWebSocket();
    }
    
    // 构建WebSocket URL，使用axios的baseURL
    const baseUrl = axios.defaults.baseURL || (import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api/v1/` : '/api/v1/');
    const wsUrl = baseUrl.replace(/^http/, 'ws').replace(/\/api\/v1\/$/, '') + `/system-info?type=0&secret=${localStorage.getItem('token')}`;
    
    try {
      websocketRef.current = new WebSocket(wsUrl);
      
      websocketRef.current.onopen = () => {
        reconnectAttemptsRef.current = 0;
      };
      
      websocketRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          // 解析失败时不输出错误信息
        }
      };
      
      websocketRef.current.onerror = () => {
        // WebSocket错误时不输出错误信息
      };
      
      websocketRef.current.onclose = () => {
        websocketRef.current = null;
        attemptReconnect();
      };
    } catch (error) {
      attemptReconnect();
    }
  };

  // 处理WebSocket消息
  const handleWebSocketMessage = (data: any) => {
    const { id, type, data: messageData } = data;
    
    if (type === 'status') {
      setNodeList(prev => prev.map(node => {
        if (node.id == id) {
          return {
            ...node,
            connectionStatus: messageData === 1 ? 'online' : 'offline',
            systemInfo: messageData === 0 ? null : node.systemInfo
          };
        }
        return node;
      }));
    } else if (type === 'info') {
      setNodeList(prev => prev.map(node => {
        if (node.id == id) {
          try {
            let systemInfo;
            if (typeof messageData === 'string') {
              systemInfo = JSON.parse(messageData);
            } else {
              systemInfo = messageData;
            }
            
            const currentUpload = parseInt(systemInfo.bytes_transmitted) || 0;
            const currentDownload = parseInt(systemInfo.bytes_received) || 0;
            const currentUptime = parseInt(systemInfo.uptime) || 0;
            
            let uploadSpeed = 0;
            let downloadSpeed = 0;
            
            if (node.systemInfo && node.systemInfo.uptime) {
              const timeDiff = currentUptime - node.systemInfo.uptime;
              
              if (timeDiff > 0 && timeDiff <= 10) {
                const lastUpload = node.systemInfo.uploadTraffic || 0;
                const lastDownload = node.systemInfo.downloadTraffic || 0;
                
                const uploadDiff = currentUpload - lastUpload;
                const downloadDiff = currentDownload - lastDownload;
                
                const uploadReset = currentUpload < lastUpload;
                const downloadReset = currentDownload < lastDownload;
                
                if (!uploadReset && uploadDiff >= 0) {
                  uploadSpeed = uploadDiff / timeDiff;
                }
                
                if (!downloadReset && downloadDiff >= 0) {
                  downloadSpeed = downloadDiff / timeDiff;
                }
              }
            }
            
            return {
              ...node,
              connectionStatus: 'online',
              systemInfo: {
                cpuUsage: parseFloat(systemInfo.cpu_usage) || 0,
                memoryUsage: parseFloat(systemInfo.memory_usage) || 0,
                uploadTraffic: currentUpload,
                downloadTraffic: currentDownload,
                uploadSpeed: uploadSpeed,
                downloadSpeed: downloadSpeed,
                uptime: currentUptime
              }
            };
          } catch (error) {
            return node;
          }
        }
        return node;
      }));
    }
  };

  // 尝试重新连接
  const attemptReconnect = () => {
    if (reconnectAttemptsRef.current < maxReconnectAttempts) {
      reconnectAttemptsRef.current++;
      
      reconnectTimerRef.current = setTimeout(() => {
        initWebSocket();
      }, 3000 * reconnectAttemptsRef.current);
    }
  };

  // 关闭WebSocket连接
  const closeWebSocket = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    
    reconnectAttemptsRef.current = 0;
    
    if (websocketRef.current) {
      websocketRef.current.onopen = null;
      websocketRef.current.onmessage = null;
      websocketRef.current.onerror = null;
      websocketRef.current.onclose = null;
      
      if (websocketRef.current.readyState === WebSocket.OPEN || 
          websocketRef.current.readyState === WebSocket.CONNECTING) {
        websocketRef.current.close();
      }
      
      websocketRef.current = null;
    }
    
    setNodeList(prev => prev.map(node => ({
      ...node,
      connectionStatus: 'offline',
      systemInfo: null
    })));
  };


  
  // 格式化速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s';
    
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 格式化开机时间
  const formatUptime = (seconds: number): string => {
    if (seconds === 0) return '-';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}天${hours}小时`;
    } else if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else {
      return `${minutes}分钟`;
    }
  };

  // 格式化流量
  const formatTraffic = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 验证IP地址格式
  const validateIp = (ip: string): boolean => {
    if (!ip || !ip.trim()) return false;
    
    const trimmedIp = ip.trim();
    
    // IPv4格式验证
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    
    // IPv6格式验证
    const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    
    if (ipv4Regex.test(trimmedIp) || ipv6Regex.test(trimmedIp) || trimmedIp === 'localhost') {
      return true;
    }
    
    // 验证域名格式
    if (/^\d+$/.test(trimmedIp)) return false;
    
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+$/;
    const singleLabelDomain = /^[a-zA-Z][a-zA-Z0-9\-]{0,62}$/;
    
    return domainRegex.test(trimmedIp) || singleLabelDomain.test(trimmedIp);
  };

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!form.name.trim()) {
      newErrors.name = '请输入节点名称';
    } else if (form.name.trim().length < 2) {
      newErrors.name = '节点名称长度至少2位';
    } else if (form.name.trim().length > 50) {
      newErrors.name = '节点名称长度不能超过50位';
    }
    
    if (!form.ipString.trim()) {
      newErrors.ipString = '请输入入口IP地址';
    } else {
      const ips = form.ipString.split('\n').map(ip => ip.trim()).filter(ip => ip);
      if (ips.length === 0) {
        newErrors.ipString = '请输入至少一个有效IP地址';
      } else {
        for (let i = 0; i < ips.length; i++) {
          if (!validateIp(ips[i])) {
            newErrors.ipString = `第${i + 1}行IP地址格式错误: ${ips[i]}`;
            break;
          }
        }
      }
    }
    
    if (!form.serverIp.trim()) {
      newErrors.serverIp = '请输入服务器IP地址';
    } else if (!validateIp(form.serverIp.trim())) {
      newErrors.serverIp = '请输入有效的IPv4、IPv6地址或域名';
    }
    
    if (!form.portSta || form.portSta < 1 || form.portSta > 65535) {
      newErrors.portSta = '端口范围必须在1-65535之间';
    }
    
    if (!form.portEnd || form.portEnd < 1 || form.portEnd > 65535) {
      newErrors.portEnd = '端口范围必须在1-65535之间';
    } else if (form.portEnd < form.portSta) {
      newErrors.portEnd = '结束端口不能小于起始端口';
    }

    if (!form.outPort || form.outPort < 1 || form.outPort > 65535) {
      newErrors.outPort = '出口共享端口必须在1-65535之间';
    }

    if (isAdmin) {
      if (form.trafficRatio < 0 || form.trafficRatio > 100) {
        newErrors.trafficRatio = '流量倍率必须在0-100之间';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增节点
  const handleAdd = () => {
    if (!canCreateNode) {
      toast.error('当前账号无权创建节点');
      return;
    }
    setDialogTitle('新增节点');
    setIsEdit(false);
    setShowNodeAdvanced(false);
    setDialogVisible(true);
    resetForm();
    setProtocolDisabled(true);
    setProtocolDisabledReason('节点未在线，等待节点上线后再设置');
  };

  // 编辑节点
  const handleEdit = (node: Node) => {
    setDialogTitle('编辑节点');
    setIsEdit(true);
    setShowNodeAdvanced(false);
    setForm({
      id: node.id,
      name: node.name,
      ipString: node.ip ? node.ip.split(',').map(ip => ip.trim()).join('\n') : '',
      serverIp: node.serverIp || '',
      portSta: node.portSta,
      portEnd: node.portEnd,
      outPort: typeof node.outPort === 'number' ? node.outPort : 1000,
      trafficRatio: typeof node.trafficRatio === 'number' ? node.trafficRatio : 1,
      http: typeof node.http === 'number' ? node.http : 1,
      tls: typeof node.tls === 'number' ? node.tls : 1,
      socks: typeof node.socks === 'number' ? node.socks : 1
    });
    const offline = node.connectionStatus !== 'online';
    setProtocolDisabled(offline);
    setProtocolDisabledReason(offline ? '节点未在线，等待节点上线后再设置' : '');
    setDialogVisible(true);
  };

  // 删除节点
  const handleDelete = (node: Node) => {
    setNodeToDelete(node);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!nodeToDelete) return;
    
    setDeleteLoading(true);
    try {
      const res = await deleteNode(nodeToDelete.id);
      if (res.code === 0) {
        toast.success('删除成功');
        setNodeList(prev => prev.filter(n => n.id !== nodeToDelete.id));
        setDeleteModalOpen(false);
        setNodeToDelete(null);
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (error) {
      toast.error('网络错误，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 复制安装命令
  const handleCopyInstallCommand = async (node: Node) => {
    setNodeList(prev => prev.map(n => 
      n.id === node.id ? { ...n, copyLoading: true } : n
    ));
    
    try {
      const res = await getNodeInstallCommand(node.id);
      if (res.code === 0 && res.data) {
        try {
          await navigator.clipboard.writeText(res.data);
          toast.success('安装命令已复制到剪贴板');
        } catch (copyError) {
          // 复制失败，显示安装命令模态框
          setInstallCommand(res.data);
          setCurrentNodeName(node.name);
          setInstallCommandModal(true);
        }
      } else {
        toast.error(res.msg || '获取安装命令失败');
      }
    } catch (error) {
      toast.error('获取安装命令失败');
    } finally {
      setNodeList(prev => prev.map(n => 
        n.id === node.id ? { ...n, copyLoading: false } : n
      ));
    }
  };

  // 手动复制安装命令
  const handleManualCopy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      toast.success('安装命令已复制到剪贴板');
      setInstallCommandModal(false);
    } catch (error) {
      toast.error('复制失败，请手动选择文本复制');
    }
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setSubmitLoading(true);
    
    try {
      const ipString = form.ipString
        .split('\n')
        .map(ip => ip.trim())
        .filter(ip => ip)
        .join(',');
        
      const submitData = {
        ...form,
        ip: ipString
      };
      delete (submitData as any).ipString;
      
      const apiCall = isEdit ? updateNode : createNode;
      const data = isEdit ? submitData : { 
        name: form.name, 
        ip: ipString,
        serverIp: form.serverIp,
        portSta: form.portSta,
        portEnd: form.portEnd,
        outPort: form.outPort,
        trafficRatio: form.trafficRatio,
        http: form.http,
        tls: form.tls,
        socks: form.socks
      };
      
      const res = await apiCall(data);
      if (res.code === 0) {
        toast.success(isEdit ? '更新成功' : '创建成功');
        setDialogVisible(false);
        
        if (isEdit) {
          setNodeList(prev => prev.map(n => 
            n.id === form.id ? {
              ...n,
              name: form.name,
              ip: ipString,
              serverIp: form.serverIp,
              portSta: form.portSta,
              portEnd: form.portEnd,
              outPort: form.outPort,
              trafficRatio: form.trafficRatio,
              http: form.http,
              tls: form.tls,
              socks: form.socks
            } : n
          ));
        } else {
          loadNodes();
        }
      } else {
        toast.error(res.msg || (isEdit ? '更新失败' : '创建失败'));
      }
    } catch (error) {
      toast.error('网络错误，请重试');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 重置表单
  const resetForm = () => {
    setForm({
      id: null,
      name: '',
      ipString: '',
      serverIp: '',
      portSta: 1000,
      portEnd: 65535,
      outPort: 1000,
      trafficRatio: 1,
      http: 0,
      tls: 0,
      socks: 0
    });
    setErrors({});
  };

  return (
    
      <div className="flex flex-col gap-6">
        {/* Toolbar */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
             <div className="flex items-center justify-between gap-4">
                 <div className="flex items-center gap-2">
                    {/* Placeholder for search if needed later */}
                 </div>
                 
                 <div className="flex items-center gap-2">
                    {canCreateNode && (
                      <Button 
                        size="sm" 
                        color="primary" 
                        startContent={<span className="text-lg">+</span>}
                        onPress={handleAdd}
                      >
                        新增节点
                      </Button>
                    )}
                 </div>
             </div>
        </div>

        {/* 节点列表 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden min-h-[400px]">
          {loading ? (
             <div className="flex items-center justify-center h-64">
                <div className="flex flex-col items-center gap-3">
                  <Spinner size="lg" color="primary" />
                  <span className="text-gray-500 text-sm">正在加载节点数据...</span>
                </div>
             </div>
          ) : nodeList.length > 0 ? (
           <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                    <tr>
                       <th className="px-4 py-3">节点名称</th>
                       <th className="px-4 py-3">入口IP</th>
                       <th className="px-4 py-3">端口范围</th>
                       <th className="px-4 py-3">倍率</th>
                       <th className="px-4 py-3">版本</th>
                       <th className="px-4 py-3">状态</th>
                       <th className="px-4 py-3">在线时长</th>
                       <th className="px-4 py-3">CPU</th>
                       <th className="px-4 py-3">内存</th>
                       <th className="px-4 py-3">实时速率</th>
                       <th className="px-4 py-3">总流量</th>
                       <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {nodeList.map((node) => (
                      <tr key={node.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <td className="px-4 py-3 align-middle">
                           <div className="flex flex-col">
                              <span className="font-medium text-gray-900 dark:text-gray-100">{node.name}</span>
                              <span className="text-xs text-gray-400">{node.serverIp}</span>
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                             {node.ip ? (
                               node.ip.split(',').length > 1 ? (
                                 <span title={node.ip.split(',')[0].trim()} className="border-b border-dotted border-gray-300">
                                   {node.ip.split(',')[0].trim()} +{node.ip.split(',').length - 1}
                                 </span>
                               ) : (
                                 <span title={node.ip.trim()}>{node.ip.trim()}</span>
                               )
                             ) : '-'}
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-col gap-0.5 text-xs text-gray-600 dark:text-gray-400 font-mono">
                             <span>{node.portSta}-{node.portEnd}</span>
                             <span className="text-gray-400">出口: {node.outPort ?? '-'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 border border-gray-200 dark:border-gray-700">
                             {typeof node.trafficRatio === 'number' ? `${node.trafficRatio}x` : '-'}
                           </span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <span className="text-xs text-gray-500">{node.version || '未知'}</span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                              node.connectionStatus === 'online' 
                                ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50' 
                                : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50'
                           }`}>
                             <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                node.connectionStatus === 'online' ? 'bg-green-500' : 'bg-red-500'
                             }`}></span>
                             {node.connectionStatus === 'online' ? '在线' : '离线'}
                           </span>
                        </td>
                        <td className="px-4 py-3 align-middle text-xs text-gray-600 dark:text-gray-400">
                           {node.connectionStatus === 'online' && node.systemInfo 
                              ? formatUptime(node.systemInfo.uptime)
                              : '-'
                           }
                        </td>
                        <td className="px-4 py-3 align-middle">
                           {node.connectionStatus === 'online' && node.systemInfo ? (
                             <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                   <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(node.systemInfo.cpuUsage, 100)}%` }}></div>
                                </div>
                                <span className="text-xs text-gray-500 w-8">{node.systemInfo.cpuUsage.toFixed(0)}%</span>
                             </div>
                           ) : '-'}
                        </td>
                        <td className="px-4 py-3 align-middle">
                           {node.connectionStatus === 'online' && node.systemInfo ? (
                             <div className="flex items-center gap-2">
                                <div className="w-16 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                   <div className="h-full bg-purple-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(node.systemInfo.memoryUsage, 100)}%` }}></div>
                                </div>
                                <span className="text-xs text-gray-500 w-8">{node.systemInfo.memoryUsage.toFixed(0)}%</span>
                             </div>
                           ) : '-'}
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <div className="flex flex-col text-xs font-mono text-gray-600 dark:text-gray-400">
                             <div className="flex items-center gap-1">
                                <span className="text-green-500">↑</span>
                                {node.connectionStatus === 'online' && node.systemInfo ? formatSpeed(node.systemInfo.uploadSpeed) : '-'}
                             </div>
                             <div className="flex items-center gap-1">
                                <span className="text-blue-500">↓</span>
                                {node.connectionStatus === 'online' && node.systemInfo ? formatSpeed(node.systemInfo.downloadSpeed) : '-'}
                             </div>
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <div className="flex flex-col text-xs font-mono text-gray-600 dark:text-gray-400">
                             <div className="flex items-center gap-1">
                                <span className="text-green-500">↑</span>
                                {node.connectionStatus === 'online' && node.systemInfo ? formatTraffic(node.systemInfo.uploadTraffic) : '-'}
                             </div>
                             <div className="flex items-center gap-1">
                                <span className="text-blue-500">↓</span>
                                {node.connectionStatus === 'online' && node.systemInfo ? formatTraffic(node.systemInfo.downloadTraffic) : '-'}
                             </div>
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-right w-[140px]">
                            <div className="flex justify-end gap-1">
                              {isAdmin || (currentUserId !== null && node.ownerId === currentUserId) ? (
                                <>
                                  <button 
                                    className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-green-50 text-gray-600 hover:text-green-600 flex items-center justify-center transition-colors"
                                    onClick={() => handleCopyInstallCommand(node)} 
                                    title="复制安装命令"
                                    disabled={node.copyLoading}
                                  >
                                     {node.copyLoading ? (
                                       <Spinner size="sm" color="current" />
                                     ) : (
                                       <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                       </svg>
                                     )}
                                  </button>
                                  <button 
                                   className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 flex items-center justify-center transition-colors"
                                   onClick={() => handleEdit(node)}
                                   title="编辑"
                                  >
                                     <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                     </svg>
                                  </button>
                                  <button 
                                    className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-500 flex items-center justify-center transition-colors"
                                    onClick={() => handleDelete(node)}
                                    title="删除"
                                  >
                                     <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                     </svg>
                                  </button>
                                </>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </div>
                        </td>
                      </tr>
                  ))}
                </tbody>
             </table>
           </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p>
                    {canCreateNode ? '暂无节点配置' : '暂无节点权限，请联系管理员分配'}
                </p>
                {canCreateNode && (
                  <Button size="sm" variant="light" color="primary" className="mt-2" onPress={handleAdd}>立即创建</Button>
                )}
            </div>
          )}
        </div>

        {/* 新增/编辑节点对话框 */}
        <Modal 
          isOpen={dialogVisible} 
          onClose={() => setDialogVisible(false)}
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
               <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{dialogTitle}</h2>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">节点名称</label>
                        <Input
                          placeholder="请输入节点名称"
                          value={form.name}
                          onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                          isInvalid={!!errors.name}
                          errorMessage={errors.name}
                          variant="bordered"
                          classNames={{
                            inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                            input: "text-sm",
                          }}
                        />
                    </div>
                
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">服务器IP</label>
                        <Input
                          placeholder="如: 192.168.1.100"
                          value={form.serverIp}
                          onChange={(e) => setForm(prev => ({ ...prev, serverIp: e.target.value }))}
                          isInvalid={!!errors.serverIp}
                          errorMessage={errors.serverIp}
                          variant="bordered"
                          classNames={{
                            inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                            input: "text-sm",
                          }}
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">入口IP</label>
                    <Textarea
                      placeholder="一行一个IP地址或域名，例如:&#10;192.168.1.100&#10;example.com"
                      value={form.ipString}
                      onChange={(e) => setForm(prev => ({ ...prev, ipString: e.target.value }))}
                      isInvalid={!!errors.ipString}
                      errorMessage={errors.ipString}
                      variant="bordered"
                      minRows={3}
                      maxRows={5}
                      classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                        input: "text-sm font-mono",
                      }}
                    />
                    <div className="text-xs text-gray-400">支持多个IP，每行一个地址，用于展示给用户连接。</div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">起始端口</label>
                      <Input
                        type="number"
                        placeholder="1000"
                        value={form.portSta.toString()}
                        onChange={(e) => setForm(prev => ({ ...prev, portSta: parseInt(e.target.value) || 1000 }))}
                        isInvalid={!!errors.portSta}
                        errorMessage={errors.portSta}
                        variant="bordered"
                        min={1}
                        max={65535}
                        classNames={{
                          inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                          input: "text-sm",
                        }}
                      />
                  </div>

                  <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">结束端口</label>
                      <Input
                        type="number"
                        placeholder="65535"
                        value={form.portEnd.toString()}
                        onChange={(e) => setForm(prev => ({ ...prev, portEnd: parseInt(e.target.value) || 65535 }))}
                        isInvalid={!!errors.portEnd}
                        errorMessage={errors.portEnd}
                        variant="bordered"
                        min={1}
                        max={65535}
                        classNames={{
                          inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                          input: "text-sm",
                        }}
                      />
                  </div>
                  
                  <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">出口共享端口</label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={form.outPort.toString()}
                        onChange={(e) => setForm(prev => ({ 
                          ...prev, 
                          outPort: parseInt(e.target.value) || 0 
                        }))}
                        isInvalid={!!errors.outPort}
                        errorMessage={errors.outPort}
                        variant="bordered"
                        min={1}
                        max={65535}
                        classNames={{
                          inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                          input: "text-sm",
                        }}
                      />
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex flex-col gap-2">
                       <label className="text-sm font-medium text-gray-700 dark:text-gray-300">流量倍率</label>
                       <Input
                        type="number"
                        placeholder="1.0"
                        value={form.trafficRatio.toString()}
                        onChange={(e) => setForm(prev => ({ 
                          ...prev, 
                          trafficRatio: Number(e.target.value) || 0 
                        }))}
                        isInvalid={!!errors.trafficRatio}
                        errorMessage={errors.trafficRatio}
                        variant="bordered"
                        min={0}
                        max={100}
                        step="0.1"
                        classNames={{
                          inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                          input: "text-sm",
                        }}
                      />
                  </div>
                )}

                {/* 屏蔽协议 (In Advanced Options) */}
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                   <button 
                      className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                      onClick={() => setShowNodeAdvanced(!showNodeAdvanced)}
                   >
                      <span>高级选项</span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showNodeAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                   </button>
                   {showNodeAdvanced && (
                     <div className="p-4 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-gray-800">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                              <div className="text-sm font-bold text-gray-800 dark:text-gray-200">屏蔽协议</div>
                              <div className="text-xs text-gray-500">开启开关以屏蔽对应协议</div>
                            </div>
                            {protocolDisabled && (
                              <div className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded border border-orange-200 dark:border-orange-800">
                                 ⚠️ {protocolDisabledReason || '等待节点上线后再设置'}
                              </div>
                            )}
                        </div>
                        
                        <div className={`space-y-3 ${protocolDisabled ? 'opacity-70 pointer-events-none' : ''}`}>
                          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500">
                                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/></svg>
                              </div>
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">HTTP</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">{form.http === 1 ? '已开启' : '已关闭'}</span>
                              <Switch
                                size="sm"
                                isSelected={form.http === 1}
                                isDisabled={protocolDisabled}
                                onValueChange={(v) => setForm(prev => ({ ...prev, http: v ? 1 : 0 }))}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-500">
                                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 10V7a6 6 0 1 1 12 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                              </div>
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">TLS</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">{form.tls === 1 ? '已开启' : '已关闭'}</span>
                              <Switch
                                size="sm"
                                isSelected={form.tls === 1}
                                isDisabled={protocolDisabled}
                                onValueChange={(v) => setForm(prev => ({ ...prev, tls: v ? 1 : 0 }))}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div className="flex items-center gap-3">
                               <div className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center text-green-500">
                                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </div>
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">SOCKS</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400">{form.socks === 1 ? '已开启' : '已关闭'}</span>
                              <Switch
                                size="sm"
                                isSelected={form.socks === 1}
                                isDisabled={protocolDisabled}
                                onValueChange={(v) => setForm(prev => ({ ...prev, socks: v ? 1 : 0 }))}
                              />
                            </div>
                          </div>
                        </div>
                     </div>
                   )}
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800 text-xs text-blue-600 dark:text-blue-400 space-y-1">
                  <p>• 请不要在出口节点执行屏蔽协议，否则可能影响转发；屏蔽协议仅需在入口节点执行。</p>
                  <p>• 服务器IP是真实的物理IP。入口IP是展示给用户看的。</p>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                variant="light"
                onPress={() => setDialogVisible(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                color="primary"
                onPress={handleSubmit}
                isLoading={submitLoading}
                className="font-medium"
              >
                {submitLoading ? '提交中...' : '确定'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* 删除确认模态框 */}
        <Modal 
          isOpen={deleteModalOpen}
          onOpenChange={setDeleteModalOpen}
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
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <p>确定要删除节点 <strong className="text-gray-900 dark:text-gray-100">"{nodeToDelete?.name}"</strong> 吗？</p>
                    <p className="mt-1">此操作不可恢复，请谨慎操作。</p>
                  </div>
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
                    className="font-medium"
                  >
                    {deleteLoading ? '删除中...' : '确认删除'}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 安装命令模态框 */}
        <Modal 
          isOpen={installCommandModal} 
          onClose={() => setInstallCommandModal(false)}
          size="2xl"
          placement="center"
          scrollBehavior="outside"
          backdrop="blur"
          classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
          }}
        >
          <ModalContent>
            <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">安装命令 - {currentNodeName}</h2>
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  请复制以下安装命令到服务器上执行：
                </p>
                <div className="relative">
                  <Textarea
                    value={installCommand}
                    readOnly
                    variant="bordered"
                    minRows={6}
                    maxRows={10}
                    classNames={{
                      inputWrapper: "bg-gray-900 border-gray-800 shadow-none rounded-lg",
                      input: "font-mono text-sm text-green-400"
                    }}
                  />
                  <Button
                    size="sm"
                    color="primary"
                    variant="flat"
                    className="absolute top-2 right-2"
                    onPress={handleManualCopy}
                  >
                    复制
                  </Button>
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                   <span>💡</span>
                   <span>提示：如果复制按钮失效，请手动选择上方文本进行复制</span>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                variant="light"
                onPress={() => setInstallCommandModal(false)}
              >
                关闭
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    
  );
} 
