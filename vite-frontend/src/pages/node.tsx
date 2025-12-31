import { useState, useEffect, useRef } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Textarea } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Switch } from "@heroui/switch";
import { Spinner } from "@heroui/spinner";
import { 
  Table, 
  TableHeader, 
  TableColumn, 
  TableBody, 
  TableRow, 
  TableCell 
} from "@heroui/table";
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
  version?: string;
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
  http: number; // 0 关 1 开
  tls: number;  // 0 关 1 开
  socks: number; // 0 关 1 开
}

export default function NodePage() {
  const [nodeList, setNodeList] = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
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
    http: 0,
    tls: 0,
    socks: 0
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // 安装命令相关状态
  const [installCommandModal, setInstallCommandModal] = useState(false);
  const [installCommand, setInstallCommand] = useState('');
  const [currentNodeName, setCurrentNodeName] = useState('');
  
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
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
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增节点
  const handleAdd = () => {
    setDialogTitle('新增节点');
    setIsEdit(false);
    setDialogVisible(true);
    resetForm();
    setProtocolDisabled(true);
    setProtocolDisabledReason('节点未在线，等待节点上线后再设置');
  };

  // 编辑节点
  const handleEdit = (node: Node) => {
    setDialogTitle('编辑节点');
    setIsEdit(true);
    setForm({
      id: node.id,
      name: node.name,
      ipString: node.ip ? node.ip.split(',').map(ip => ip.trim()).join('\n') : '',
      serverIp: node.serverIp || '',
      portSta: node.portSta,
      portEnd: node.portEnd,
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
      http: 0,
      tls: 0,
      socks: 0
    });
    setErrors({});
  };

  return (
    
      <div className="px-4 lg:px-6 py-6">
        {/* 页面头部 */}
        <div className="flex items-center justify-end mb-6">
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={handleAdd}
          >
            新增
          </Button>
        </div>

        {/* 节点列表 */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-3">
              <Spinner size="sm" />
              <span className="text-default-600">正在加载...</span>
            </div>
          </div>
        ) : (
          <div className="border border-divider rounded-lg overflow-hidden">
            <Table
              removeWrapper
              aria-label="节点列表"
              classNames={{
                th: "bg-default-50 text-default-600 text-xs",
                td: "py-3 align-top",
              }}
            >
              <TableHeader>
                <TableColumn>节点</TableColumn>
                <TableColumn>入口IP</TableColumn>
                <TableColumn>端口</TableColumn>
                <TableColumn>版本</TableColumn>
                <TableColumn>状态</TableColumn>
                <TableColumn>开机时间</TableColumn>
                <TableColumn>CPU</TableColumn>
                <TableColumn>内存</TableColumn>
                <TableColumn>网络</TableColumn>
                <TableColumn>流量</TableColumn>
                <TableColumn className="text-right">操作</TableColumn>
              </TableHeader>
              <TableBody
                emptyContent={
                  <div className="text-default-500 text-sm py-8">
                    暂无节点配置，点击上方按钮开始创建
                  </div>
                }
              >
                {nodeList.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate text-sm">{node.name}</div>
                        <div className="text-xs text-default-500 truncate">{node.serverIp}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-mono">
                        {node.ip ? (
                          node.ip.split(',').length > 1 ? (
                            <span title={node.ip.split(',')[0].trim()}>
                              {node.ip.split(',')[0].trim()} +{node.ip.split(',').length - 1}
                            </span>
                          ) : (
                            <span title={node.ip.trim()}>{node.ip.trim()}</span>
                          )
                        ) : '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{node.portSta}-{node.portEnd}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">{node.version || '未知'}</div>
                    </TableCell>
                    <TableCell>
                      <Chip 
                        color={node.connectionStatus === 'online' ? 'success' : 'danger'} 
                        variant="flat" 
                        size="sm"
                        className="text-xs"
                      >
                        {node.connectionStatus === 'online' ? '在线' : '离线'}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        {node.connectionStatus === 'online' && node.systemInfo 
                          ? formatUptime(node.systemInfo.uptime)
                          : '-'
                        }
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        {node.connectionStatus === 'online' && node.systemInfo 
                          ? `${node.systemInfo.cpuUsage.toFixed(1)}%` 
                          : '-'
                        }
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        {node.connectionStatus === 'online' && node.systemInfo 
                          ? `${node.systemInfo.memoryUsage.toFixed(1)}%` 
                          : '-'
                        }
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                        <div>↑ {node.connectionStatus === 'online' && node.systemInfo ? formatSpeed(node.systemInfo.uploadSpeed) : '-'}</div>
                        <div>↓ {node.connectionStatus === 'online' && node.systemInfo ? formatSpeed(node.systemInfo.downloadSpeed) : '-'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                        <div>↑ {node.connectionStatus === 'online' && node.systemInfo ? formatTraffic(node.systemInfo.uploadTraffic) : '-'}</div>
                        <div>↓ {node.connectionStatus === 'online' && node.systemInfo ? formatTraffic(node.systemInfo.downloadTraffic) : '-'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="flat"
                          color="success"
                          onPress={() => handleCopyInstallCommand(node)}
                          isLoading={node.copyLoading}
                        >
                          安装
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          onPress={() => handleEdit(node)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => handleDelete(node)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* 新增/编辑节点对话框 */}
        <Modal 
          isOpen={dialogVisible} 
          onClose={() => setDialogVisible(false)}
          size="2xl"
          scrollBehavior="outside"
          backdrop="blur"
          placement="center"
        >
          <ModalContent>
            <ModalHeader>{dialogTitle}</ModalHeader>
            <ModalBody>
              <div className="space-y-3">
                <Input
                  label="节点名称"
                  placeholder="请输入节点名称"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  isInvalid={!!errors.name}
                  errorMessage={errors.name}
                  variant="bordered"
                  classNames={{
                    inputWrapper: "rounded-lg border border-default-200 dark:border-default-200/40 bg-transparent shadow-none",
                    label: "text-default-600",
                  }}
                />

                <Input
                  label="服务器IP"
                  placeholder="请输入服务器IP地址，如: 192.168.1.100 或 example.com"
                  value={form.serverIp}
                  onChange={(e) => setForm(prev => ({ ...prev, serverIp: e.target.value }))}
                  isInvalid={!!errors.serverIp}
                  errorMessage={errors.serverIp}
                  variant="bordered"
                  classNames={{
                    inputWrapper: "rounded-lg border border-default-200 dark:border-default-200/40 bg-transparent shadow-none",
                    label: "text-default-600",
                  }}
                />

                <Textarea
                  label="入口IP"
                  placeholder="一行一个IP地址或域名，例如:&#10;192.168.1.100&#10;example.com"
                  value={form.ipString}
                  onChange={(e) => setForm(prev => ({ ...prev, ipString: e.target.value }))}
                  isInvalid={!!errors.ipString}
                  errorMessage={errors.ipString}
                  variant="bordered"
                  minRows={3}
                  maxRows={5}
                  description="支持多个IP，每行一个地址"
                  classNames={{
                    inputWrapper: "rounded-lg border border-default-200 dark:border-default-200/40 bg-transparent shadow-none",
                    label: "text-default-600",
                    description: "text-xs text-default-400",
                  }}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="起始端口"
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
                      inputWrapper: "rounded-lg border border-default-200 dark:border-default-200/40 bg-transparent shadow-none",
                      label: "text-default-600",
                    }}
                  />

                  <Input
                    label="结束端口"
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
                      inputWrapper: "rounded-lg border border-default-200 dark:border-default-200/40 bg-transparent shadow-none",
                      label: "text-default-600",
                    }}
                  />
                </div>

                {/* 屏蔽协议 */}
                <div className="mt-1">
                  <div className="text-sm font-medium text-default-700">屏蔽协议</div>
                  <div className="text-xs text-default-500 mb-1">开启开关以屏蔽对应协议</div>
                  {protocolDisabled && (
                    <div className="text-xs text-warning-600 mb-2">
                      {protocolDisabledReason || '等待节点上线后再设置'}
                    </div>
                  )}
                  <div className={`divide-y divide-default-200 dark:divide-default-200/40 border-t border-default-200 dark:border-default-200/40 ${protocolDisabled ? 'opacity-70' : ''}`}>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-default-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/></svg>
                        <div className="text-sm font-medium text-default-700">HTTP</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-default-400">{form.http === 1 ? '已开启' : '已关闭'}</div>
                        <Switch
                          size="sm"
                          isSelected={form.http === 1}
                          isDisabled={protocolDisabled}
                          onValueChange={(v) => setForm(prev => ({ ...prev, http: v ? 1 : 0 }))}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-default-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 10V7a6 6 0 1 1 12 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                        <div className="text-sm font-medium text-default-700">TLS</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-default-400">{form.tls === 1 ? '已开启' : '已关闭'}</div>
                        <Switch
                          size="sm"
                          isSelected={form.tls === 1}
                          isDisabled={protocolDisabled}
                          onValueChange={(v) => setForm(prev => ({ ...prev, tls: v ? 1 : 0 }))}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-default-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <div className="text-sm font-medium text-default-700">SOCKS</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-default-400">{form.socks === 1 ? '已开启' : '已关闭'}</div>
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



                <div className="mt-2 text-xs text-default-500 space-y-1">
                  <div>请不要在出口节点执行屏蔽协议，否则可能影响转发；屏蔽协议仅需在入口节点执行。</div>
                  <div>服务器ip是你要添加的服务器的ip地址，不是面板的ip地址。入口ip是用于展示在转发页面，面向用户的访问地址。实在理解不到说明你没这个需求，都填节点的服务器ip就行！</div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                variant="flat"
                onPress={() => setDialogVisible(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                color="primary"
                onPress={handleSubmit}
                isLoading={submitLoading}
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
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p>确定要删除节点 <strong>"{nodeToDelete?.name}"</strong> 吗？</p>
                  <p className="text-small text-default-500">此操作不可恢复，请谨慎操作。</p>
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
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            <ModalHeader>安装命令 - {currentNodeName}</ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                <p className="text-sm text-default-600">
                  请复制以下安装命令到服务器上执行：
                </p>
                <div className="relative">
                  <Textarea
                    value={installCommand}
                    readOnly
                    variant="bordered"
                    minRows={6}
                    maxRows={10}
                    className="font-mono text-sm"
                    classNames={{
                      input: "font-mono text-sm"
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
                <div className="text-xs text-default-500">
                  💡 提示：如果复制按钮失效，请手动选择上方文本进行复制
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button
                size="sm"
                variant="flat"
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
