import { useState, useEffect } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import toast from 'react-hot-toast';


import { 
  createTunnel, 
  getTunnelList, 
  updateTunnel, 
  deleteTunnel,
  getNodeList,
  diagnoseTunnel
} from "@/api";

interface Tunnel {
  id: number;
  name: string;
  type: number; // 1: 端口转发, 2: 隧道转发
  inNodeId: number;
  inNodeIds?: string;
  outNodeId?: number;
  outNodeIds?: string;
  inIp: string;
  outIp?: string;
  protocol?: string;
  outStrategy?: string;
  tcpListenAddr: string;
  udpListenAddr: string;
  interfaceName?: string;
  muxEnabled?: boolean;
  muxPort?: number;
  status: number;
  createdTime: string;
}

interface Node {
  id: number;
  name: string;
  status: number; // 1: 在线, 0: 离线
  outPort?: number | null;
  accessType?: number;
}

interface TunnelForm {
  id?: number;
  name: string;
  type: number;
  inNodeIds: number[];
  outNodeIds: number[];
  outNodeId?: number | null;
  protocol: string;
  outStrategy: string;
  tcpListenAddr: string;
  udpListenAddr: string;
  interfaceName?: string;
  muxEnabled: boolean;
  muxPort?: number | null;
  status: number;
}

interface DiagnosisResult {
  tunnelName: string;
  tunnelType: string;
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

export default function TunnelPage() {
  const [loading, setLoading] = useState(true);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const isAdmin = localStorage.getItem('admin') === 'true';
  
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [tunnelToDelete, setTunnelToDelete] = useState<Tunnel | null>(null);
  const [currentDiagnosisTunnel, setCurrentDiagnosisTunnel] = useState<Tunnel | null>(null);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  
  // 表单状态
  const [form, setForm] = useState<TunnelForm>({
    name: '',
    type: 1,
    inNodeIds: [],
    outNodeIds: [],
    outNodeId: null,
    protocol: 'tls',
    outStrategy: 'fifo',
    tcpListenAddr: '[::]',
    udpListenAddr: '[::]',
    interfaceName: '',
    muxEnabled: false,
    muxPort: null,
    status: 1
  });
  
  // 表单验证错误
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const canUseAsInNode = (node: Node) =>
    isAdmin || node.accessType === undefined || node.accessType === 0 || node.accessType === 1;

  const canUseAsOutNode = (node: Node) =>
    isAdmin || node.accessType === undefined || node.accessType === 0 || node.accessType === 2;

  const inNodeOptions = nodes.filter(canUseAsInNode);
  const outNodeOptions = nodes.filter(canUseAsOutNode);

  useEffect(() => {
    loadData();
  }, []);

  // 加载所有数据
  const loadData = async () => {
    setLoading(true);
    try {
      const [tunnelsRes, nodesRes] = await Promise.all([
        getTunnelList(),
        getNodeList()
      ]);
      
      if (tunnelsRes.code === 0) {
        setTunnels(tunnelsRes.data || []);
      } else {
        toast.error(tunnelsRes.msg || '获取隧道列表失败');
      }
      
      if (nodesRes.code === 0) {
        setNodes(nodesRes.data || []);
      } else {
        console.warn('获取节点列表失败:', nodesRes.msg);
      }
    } catch (error) {
      console.error('加载数据失败:', error);
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const getTunnelInNodeIds = (tunnel: Tunnel): number[] => {
    if (tunnel.inNodeIds) {
      const parsed = tunnel.inNodeIds
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
      if (parsed.length > 0) return parsed;
    }
    return tunnel.inNodeId ? [tunnel.inNodeId] : [];
  };

  const getTunnelOutNodeIds = (tunnel: Tunnel): number[] => {
    if (tunnel.outNodeIds) {
      const parsed = tunnel.outNodeIds
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id));
      if (parsed.length > 0) return [parsed[0]];
    }
    return tunnel.outNodeId ? [tunnel.outNodeId] : [];
  };

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    
    if (!form.name.trim()) {
      newErrors.name = '请输入隧道名称';
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = '隧道名称长度应在2-50个字符之间';
    }
    
    if (!form.inNodeIds.length) {
      newErrors.inNodeId = '请选择入口节点';
    }
    
    if (!form.tcpListenAddr.trim()) {
      newErrors.tcpListenAddr = '请输入TCP监听地址';
    }
    
    if (!form.udpListenAddr.trim()) {
      newErrors.udpListenAddr = '请输入UDP监听地址';
    }
    
    // 隧道转发时的验证
    if (form.type === 2) {
      if (!form.outNodeIds.length) {
        newErrors.outNodeId = '请选择出口节点';
      } else if (form.outNodeIds.length > 1) {
        newErrors.outNodeId = '出口节点仅支持一个';
      } else if (form.outNodeIds.some((id) => form.inNodeIds.includes(id))) {
        newErrors.outNodeId = '隧道转发模式下，入口和出口不能是同一个节点';
      }
      
      if (!form.protocol) {
        newErrors.protocol = '请选择协议类型';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增隧道
  const handleAdd = () => {
    setIsEdit(false);
    setForm({
      name: '',
      type: 1,
      inNodeIds: [],
      outNodeIds: [],
      outNodeId: null,
      protocol: 'tls',
      outStrategy: 'fifo',
      tcpListenAddr: '[::]',
      udpListenAddr: '[::]',
      interfaceName: '',
      muxEnabled: false,
      muxPort: null,
      status: 1
    });
    setErrors({});
    setModalOpen(true);
  };

  // 编辑隧道 - 只能修改部分字段
  const handleEdit = (tunnel: Tunnel) => {
    setIsEdit(true);
    const outNodeIds = getTunnelOutNodeIds(tunnel);
    setForm({
      id: tunnel.id,
      name: tunnel.name,
      type: tunnel.type,
      inNodeIds: getTunnelInNodeIds(tunnel),
      outNodeIds,
      outNodeId: outNodeIds[0] ?? null,
      protocol: tunnel.protocol || 'tls',
      outStrategy: tunnel.outStrategy || 'fifo',
      tcpListenAddr: tunnel.tcpListenAddr || '[::]',
      udpListenAddr: tunnel.udpListenAddr || '[::]',
      interfaceName: tunnel.interfaceName || '',
      muxEnabled: tunnel.muxEnabled ?? false,
      muxPort: tunnel.muxPort ?? null,
      status: tunnel.status
    });
    setErrors({});
    setModalOpen(true);
  };

  // 删除隧道
  const handleDelete = (tunnel: Tunnel) => {
    setTunnelToDelete(tunnel);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!tunnelToDelete) return;
    
    setDeleteLoading(true);
    try {
      const response = await deleteTunnel(tunnelToDelete.id);
      if (response.code === 0) {
        toast.success('删除成功');
        setDeleteModalOpen(false);
        setTunnelToDelete(null);
        loadData();
      } else {
        toast.error(response.msg || '删除失败');
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 隧道类型改变时的处理
  const handleTypeChange = (type: number) => {
    setForm(prev => ({
      ...prev,
      type,
      outNodeIds: type === 1 ? [] : prev.outNodeIds,
      outNodeId: type === 1 ? null : (prev.outNodeIds[0] ?? prev.outNodeId),
      protocol: type === 1 ? 'tls' : prev.protocol,
      outStrategy: type === 1 ? 'fifo' : prev.outStrategy,
      muxEnabled: type === 1 ? false : true,
      muxPort: type === 1
        ? null
        : (nodes.find((node) => node.id === (prev.outNodeIds[0] ?? prev.outNodeId))?.outPort ?? prev.muxPort)
    }));
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setSubmitLoading(true);
    try {
      const data = { 
        ...form,
        inNodeId: form.inNodeIds[0] ?? null,
        outNodeId: form.outNodeIds[0] ?? null,
        muxEnabled: form.type === 1 ? false : true
      };
      
      const response = isEdit 
        ? await updateTunnel(data)
        : await createTunnel(data);
        
      if (response.code === 0) {
        toast.success(isEdit ? '更新成功' : '创建成功');
        setModalOpen(false);
        loadData();
      } else {
        toast.error(response.msg || (isEdit ? '更新失败' : '创建失败'));
      }
    } catch (error) {
      console.error('提交失败:', error);
      toast.error('网络错误，请重试');
    } finally {
      setSubmitLoading(false);
    }
  };

  // 诊断隧道
  const handleDiagnose = async (tunnel: Tunnel) => {
    setCurrentDiagnosisTunnel(tunnel);
    setDiagnosisModalOpen(true);
    setDiagnosisLoading(true);
    setDiagnosisResult(null);

    try {
      const response = await diagnoseTunnel(tunnel.id);
      if (response.code === 0) {
        setDiagnosisResult(response.data);
      } else {
        toast.error(response.msg || '诊断失败');
        setDiagnosisResult({
          tunnelName: tunnel.name,
          tunnelType: tunnel.type === 1 ? '端口转发' : '隧道转发',
          timestamp: Date.now(),
          results: [{
            success: false,
            description: '诊断失败',
            nodeName: '-',
            nodeId: '-',
            targetIp: '-',
            targetPort: 443,
            message: response.msg || '诊断过程中发生错误'
          }]
        });
      }
    } catch (error) {
      console.error('诊断失败:', error);
      toast.error('网络错误，请重试');
      setDiagnosisResult({
        tunnelName: tunnel.name,
        tunnelType: tunnel.type === 1 ? '端口转发' : '隧道转发',
        timestamp: Date.now(),
        results: [{
          success: false,
          description: '网络错误',
          nodeName: '-',
          nodeId: '-',
          targetIp: '-',
          targetPort: 443,
          message: '无法连接到服务器'
        }]
      });
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // 获取显示的IP（处理多IP）
  const getDisplayIp = (ipString?: string): string => {
    if (!ipString) return '-';
    
    const ips = ipString.split(',').map(ip => ip.trim()).filter(ip => ip);
    
    if (ips.length === 0) return '-';
    if (ips.length === 1) return ips[0];
    
    return `${ips[0]} 等${ips.length}个`;
  };

  // 获取节点名称
  const getNodeNames = (nodeIds: number[]): string => {
    if (!nodeIds.length) return '-';
    const names = nodeIds.map((id) => {
      const node = nodes.find(n => n.id === id);
      return node ? node.name : `节点${id}`;
    });
    if (names.length === 1) return names[0];
    return `${names[0]} 等${names.length}个`;
  };

  // 获取状态显示
  const getStatusDisplay = (status: number) => {
    switch (status) {
      case 1:
        return { text: '启用', color: 'success' };
      case 0:
        return { text: '禁用', color: 'default' };
      default:
        return { text: '未知', color: 'warning' };
    }
  };

  // 获取类型显示
  const getTypeDisplay = (type: number) => {
    switch (type) {
      case 1:
        return { text: '端口转发', color: 'primary' };
      case 2:
        return { text: '隧道转发', color: 'secondary' };
      default:
        return { text: '未知', color: 'default' };
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

  const selectedOutPorts = form.outNodeIds
    .map((id) => nodes.find((node) => node.id === id)?.outPort)
    .filter((port): port is number => port !== null && port !== undefined);
  const outPortDisplay = selectedOutPorts.length > 0
    ? selectedOutPorts.join(' / ')
    : (form.muxPort !== null && form.muxPort !== undefined ? form.muxPort.toString() : '未配置');

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
        {/* Toolbar */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
             <div className="flex items-center justify-between gap-4">
                 <div className="flex items-center gap-2 w-full max-w-xl">
                      <Input 
                        size="sm" 
                        placeholder="搜索隧道" 
                        startContent={
                            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        }
                        className="w-[240px]"
                        isClearable
                        classNames={{
                           inputWrapper: "bg-gray-50 dark:bg-zinc-800 border-none shadow-none"
                        }}
                      />
                      <Button size="sm" variant="light" isIconOnly onPress={() => loadData()} title="刷新">
                          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                       </Button>
                 </div>
                 
                 <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      color="primary" 
                      startContent={<span className="text-lg">+</span>}
                      onPress={handleAdd}
                    >
                      新增隧道
                    </Button>
                 </div>
             </div>
        </div>

        {/* 隧道列表 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden min-h-[400px]">
          {tunnels.length > 0 ? (
           <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                    <tr>
                       <th className="px-4 py-3">隧道名称</th>
                       <th className="px-4 py-3">类型</th>
                       <th className="px-4 py-3">状态</th>
                       <th className="px-4 py-3">入口节点</th>
                       <th className="px-4 py-3">出口节点/配置</th>
                       <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {tunnels.map((tunnel) => {
                    const statusDisplay = getStatusDisplay(tunnel.status);
                    const typeDisplay = getTypeDisplay(tunnel.type);
                    const inNodeIds = getTunnelInNodeIds(tunnel);
                    const outNodeIds = tunnel.type === 1 ? inNodeIds : getTunnelOutNodeIds(tunnel);
                    const outNodeName = getNodeNames(outNodeIds);
                    const outIp = tunnel.type === 1 ? getDisplayIp(tunnel.inIp) : getDisplayIp(tunnel.outIp);


                    return (
                      <tr key={tunnel.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <td className="px-4 py-3 align-middle">
                           <span className="font-medium text-gray-900 dark:text-gray-100">{tunnel.name}</span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className={`px-2 py-0.5 rounded text-xs border ${
                             tunnel.type === 1 
                               ? 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-900/20 dark:border-blue-900/50' 
                               : 'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-900/20 dark:border-purple-900/50'
                          }`}>
                            {typeDisplay.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <span className={`flex items-center gap-1.5 text-xs ${
                             tunnel.status === 1 ? 'text-green-600' : 'text-gray-400'
                          }`}>
                             <span className={`w-1.5 h-1.5 rounded-full ${
                                tunnel.status === 1 ? 'bg-green-500' : 'bg-gray-400'
                             }`}></span>
                             {statusDisplay.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <div className="flex flex-col gap-0.5">
                              <span className="text-gray-700 dark:text-gray-300">{getNodeNames(inNodeIds)}</span>
                              <span className="text-xs text-gray-400 font-mono">{getDisplayIp(tunnel.inIp)}</span>
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle">
                           <div className="flex flex-col gap-0.5">
                              <span className="text-gray-700 dark:text-gray-300">{outNodeName}</span>
                              <span className="text-xs text-gray-400 font-mono">{outIp}</span>
                           </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-right w-[160px]">
                            <div className="flex justify-end gap-1">
                               <button 
                                  className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 flex items-center justify-center transition-colors"
                                  onClick={() => handleDiagnose(tunnel)} 
                                  title="诊断"
                                >
                                   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                   </svg>
                                </button>
                                <button 
                                 className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 flex items-center justify-center transition-colors"
                                 onClick={() => handleEdit(tunnel)}
                                 title="编辑"
                                >
                                   <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                   </svg>
                                </button>
                                <button 
                                  className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-500 flex items-center justify-center transition-colors"
                                  onClick={() => handleDelete(tunnel)}
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
                  })}
                </tbody>
              </table>
           </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p>暂无隧道配置</p>
                <Button size="sm" variant="light" color="primary" className="mt-2" onPress={handleAdd}>立即创建</Button>
            </div>
          )}
        </div>

        {/* 新增/编辑模态框 */}
        <Modal 
          isOpen={modalOpen} 
          onOpenChange={setModalOpen}
          size="2xl"
          backdrop="blur"
          //scrollBehavior="outside" // Explicitly adding again just in case, or relying on existing one? Can't remove existing attributes easily with string replace without exact match. 
          // The old string has scrollBehavior="outside".
          // I will replace likely block.
          scrollBehavior="outside"
          placement="center"
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
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {isEdit ? '编辑隧道' : '新增隧道'}
                  </h2>
                </ModalHeader>
                <ModalBody>
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">隧道名称</label>
                      <Input
                        placeholder="请输入隧道名称"
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
                    
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">隧道类型</label>
                        <Select
                          placeholder="请选择隧道类型"
                          selectedKeys={[form.type.toString()]}
                          onSelectionChange={(keys) => {
                            const selectedKey = Array.from(keys)[0] as string;
                            if (selectedKey) {
                              handleTypeChange(parseInt(selectedKey));
                            }
                          }}
                          isInvalid={!!errors.type}
                          errorMessage={errors.type}
                          variant="bordered"
                          isDisabled={isEdit}
                           classNames={{
                             trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus:!border-blue-500 rounded-lg",
                             value: "text-sm"
                          }}
                        >
                          <SelectItem key="1">端口转发</SelectItem>
                          <SelectItem key="2">隧道转发</SelectItem>
                        </Select>
                    </div>

                    <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">入口配置</h3>
                      <div className="flex flex-col gap-4">
                           <div className="flex flex-col gap-2">
                               <label className="text-sm font-medium text-gray-700 dark:text-gray-300">入口节点</label>
                               <Select
                                  placeholder="请选择入口节点"
                                  selectionMode="multiple"
                                  selectedKeys={form.inNodeIds.map((id) => id.toString())}
                                  onSelectionChange={(keys) => {
                                    const selected = Array.from(keys)
                                      .map((key) => parseInt(key as string, 10))
                                      .filter((id) => !Number.isNaN(id));
                                    setForm(prev => ({ ...prev, inNodeIds: selected }));
                                  }}
                                  isInvalid={!!errors.inNodeId}
                                  errorMessage={errors.inNodeId}
                                  variant="bordered"
                                   classNames={{
                                     trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus:!border-blue-500 rounded-lg",
                                     value: "text-sm"
                                  }}
                                >
                                  {inNodeOptions.map((node) => (
                                    <SelectItem 
                                      key={node.id}
                                      textValue={`${node.name} (${node.status === 1 ? '在线' : '离线'})`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span>{node.name}</span>
                                        <Chip 
                                          color={node.status === 1 ? 'success' : 'danger'} 
                                          variant="flat" 
                                          size="sm"
                                        >
                                          {node.status === 1 ? '在线' : '离线'}
                                        </Chip>
                                      </div>
                                    </SelectItem>
                                  ))}
                                </Select>
                           </div>

                           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="flex flex-col gap-2">
                                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">TCP监听地址</label>
                                  <Input
                                    placeholder="TCP监听地址"
                                    value={form.tcpListenAddr}
                                    onChange={(e) => setForm(prev => ({ ...prev, tcpListenAddr: e.target.value }))}
                                    isInvalid={!!errors.tcpListenAddr}
                                    errorMessage={errors.tcpListenAddr}
                                    variant="bordered"
                                     classNames={{
                                         inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                                         input: "text-sm",
                                         innerWrapper: "bg-transparent"
                                      }}
                                    startContent={
                                      <div className="pointer-events-none flex items-center pr-2 border-r border-gray-200 dark:border-gray-700 mr-2">
                                        <span className="text-gray-500 text-xs">TCP</span>
                                      </div>
                                    }
                                  />
                              </div>

                              <div className="flex flex-col gap-2">
                                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">UDP监听地址</label>
                                  <Input
                                    placeholder="UDP监听地址"
                                    value={form.udpListenAddr}
                                    onChange={(e) => setForm(prev => ({ ...prev, udpListenAddr: e.target.value }))}
                                    isInvalid={!!errors.udpListenAddr}
                                    errorMessage={errors.udpListenAddr}
                                    variant="bordered"
                                     classNames={{
                                         inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                                         input: "text-sm"
                                      }}
                                    startContent={
                                      <div className="pointer-events-none flex items-center pr-2 border-r border-gray-200 dark:border-gray-700 mr-2">
                                        <span className="text-gray-500 text-xs">UDP</span>
                                      </div>
                                    }
                                  />
                              </div>
                           </div>
                      </div>
                    </div>

                    {/* 隧道转发时显示出口网卡配置 */}
                    {form.type === 2 && (
                       <div className="flex flex-col gap-2">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">出口网卡名或IP</label>
                          <Input
                            placeholder="请输入出口网卡名或IP"
                            value={form.interfaceName}
                            onChange={(e) => setForm(prev => ({ ...prev, interfaceName: e.target.value }))}
                            isInvalid={!!errors.interfaceName}
                            errorMessage={errors.interfaceName}
                            variant="bordered"
                             classNames={{
                                 inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                                 input: "text-sm"
                              }}
                          />
                       </div>
                    )}

                    {/* 隧道转发时显示出口配置 */}
                    {form.type === 2 && (
                      <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">出口配置</h3>
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">协议类型</label>
                                <Select
                                  placeholder="请选择协议类型"
                                  selectedKeys={[form.protocol]}
                                  onSelectionChange={(keys) => {
                                    const selectedKey = Array.from(keys)[0] as string;
                                    if (selectedKey) {
                                      setForm(prev => ({ ...prev, protocol: selectedKey }));
                                    }
                                  }}
                                  isInvalid={!!errors.protocol}
                                  errorMessage={errors.protocol}
                                  variant="bordered"
                                   classNames={{
                                     trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus:!border-blue-500 rounded-lg",
                                     value: "text-sm"
                                  }}
                                >
                                  <SelectItem key="tls">TLS</SelectItem>
                                  <SelectItem key="wss">WSS</SelectItem>
                                  <SelectItem key="tcp">TCP</SelectItem>
                                  <SelectItem key="mtls">MTLS</SelectItem>
                                  <SelectItem key="mwss">MWSS</SelectItem>
                                  <SelectItem key="mtcp">MTCP</SelectItem>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">出口节点</label>
                                <Select
                                  placeholder="请选择出口节点"
                                  selectedKeys={form.outNodeIds.length ? [form.outNodeIds[0].toString()] : []}
                                  onSelectionChange={(keys) => {
                                    const selectedKey = Array.from(keys)[0] as string;
                                    const selectedId = Number.parseInt(selectedKey, 10);
                                    const selected = Number.isNaN(selectedId) ? [] : [selectedId];
                                    const firstOutNode = selected.length > 0
                                      ? outNodeOptions.find((node) => node.id === selected[0])
                                      : null;
                                    setForm(prev => ({ 
                                      ...prev, 
                                      outNodeIds: selected,
                                      outNodeId: selected[0] ?? null,
                                      muxPort: firstOutNode?.outPort ?? null
                                    }));
                                  }}
                                  isInvalid={!!errors.outNodeId}
                                  errorMessage={errors.outNodeId}
                                  variant="bordered"
                                   classNames={{
                                     trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus:!border-blue-500 rounded-lg",
                                     value: "text-sm"
                                  }}
                                >
                                  {outNodeOptions.map((node) => (
                                    <SelectItem 
                                      key={node.id}
                                      textValue={`${node.name} (${node.status === 1 ? '在线' : '离线'})`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span>{node.name}</span>
                                        <div className="flex items-center gap-2">
                                          <Chip 
                                            color={node.status === 1 ? 'success' : 'danger'} 
                                            variant="flat" 
                                            size="sm"
                                          >
                                            {node.status === 1 ? '在线' : '离线'}
                                          </Chip>
                                          {form.inNodeIds.includes(node.id) && (
                                            <Chip color="warning" variant="flat" size="sm">
                                              已选为入口
                                            </Chip>
                                          )}
                                        </div>
                                      </div>
                                    </SelectItem>
                                  ))}

                                </Select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">绑定端口</label>
                                <Input
                                  value={outPortDisplay}
                                  variant="bordered"
                                  isReadOnly
                                  classNames={{
                                     inputWrapper: "bg-gray-50 dark:bg-zinc-800 border-gray-300 dark:border-gray-700 shadow-none",
                                     input: "text-sm text-gray-500"
                                  }}
                                  description="端口来自出口节点设置"
                                />
                            </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                        <div className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                            <p>• TCP/UDP监听地址：V6或双栈填写 [::]，V4 填写 0.0.0.0。</p>
                            <p>• 出口网卡名或IP：多 IP 服务器指定出口地址，不懂可留空。</p>
                        </div>
                    </div>
                  </div>
                </ModalBody>
                <ModalFooter>
                  <Button size="sm" variant="light" onPress={onClose}>
                    取消
                  </Button>
                  <Button 
                    size="sm"
                    color="primary" 
                    className="font-medium"
                    onPress={handleSubmit}
                    isLoading={submitLoading}
                  >
                    {submitLoading ? (isEdit ? '更新中...' : '创建中...') : (isEdit ? '更新' : '创建')}
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
                    <p>确定要删除隧道 <strong className="text-gray-900 dark:text-gray-100">"{tunnelToDelete?.name}"</strong> 吗？</p>
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
                    className="font-medium"
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

        {/* 诊断结果模态框 */}
        <Modal 
          isOpen={diagnosisModalOpen}
          onOpenChange={setDiagnosisModalOpen}
          size="2xl"
          placement="center"
          backdrop="blur"
          scrollBehavior="outside"
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
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">隧道诊断结果</h2>
                    {currentDiagnosisTunnel && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                        <span className="truncate">{currentDiagnosisTunnel.name}</span>
                        <span className="text-gray-300">•</span>
                        <span>{currentDiagnosisTunnel.type === 1 ? '端口转发' : '隧道转发'}</span>
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
                  {currentDiagnosisTunnel && (
                    <Button 
                      size="sm"
                      color="primary" 
                      onPress={() => handleDiagnose(currentDiagnosisTunnel)}
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
