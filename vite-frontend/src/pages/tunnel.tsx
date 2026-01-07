import { useState, useEffect } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Divider } from "@heroui/divider";
import { 
  Table, 
  TableHeader, 
  TableColumn, 
  TableBody, 
  TableRow, 
  TableCell 
} from "@heroui/table";
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
  inIp: string;
  outIp?: string;
  protocol?: string;
  tcpListenAddr: string;
  udpListenAddr: string;
  interfaceName?: string;
  muxEnabled?: boolean;
  muxPort?: number;
  flow: number; // 1: 单向, 2: 双向
  trafficRatio: number;
  status: number;
  createdTime: string;
}

interface Node {
  id: number;
  name: string;
  status: number; // 1: 在线, 0: 离线
  outPort?: number | null;
}

interface TunnelForm {
  id?: number;
  name: string;
  type: number;
  inNodeIds: number[];
  outNodeId?: number | null;
  protocol: string;
  tcpListenAddr: string;
  udpListenAddr: string;
  interfaceName?: string;
  muxEnabled: boolean;
  muxPort?: number | null;
  flow: number;
  trafficRatio: number;
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
    outNodeId: null,
    protocol: 'tls',
    tcpListenAddr: '[::]',
    udpListenAddr: '[::]',
    interfaceName: '',
    muxEnabled: false,
    muxPort: null,
    flow: 1,
    trafficRatio: 1.0,
    status: 1
  });
  
  // 表单验证错误
  const [errors, setErrors] = useState<{[key: string]: string}>({});

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
    
    if (form.trafficRatio < 0.0 || form.trafficRatio > 100.0) {
      newErrors.trafficRatio = '流量倍率必须在0.0-100.0之间';
    }
    
    // 隧道转发时的验证
    if (form.type === 2) {
      if (!form.outNodeId) {
        newErrors.outNodeId = '请选择出口节点';
      } else if (form.inNodeIds.includes(form.outNodeId)) {
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
      outNodeId: null,
      protocol: 'tls',
      tcpListenAddr: '[::]',
      udpListenAddr: '[::]',
      interfaceName: '',
      muxEnabled: false,
      muxPort: null,
      flow: 1,
      trafficRatio: 1.0,
      status: 1
    });
    setErrors({});
    setModalOpen(true);
  };

  // 编辑隧道 - 只能修改部分字段
  const handleEdit = (tunnel: Tunnel) => {
    setIsEdit(true);
    setForm({
      id: tunnel.id,
      name: tunnel.name,
      type: tunnel.type,
      inNodeIds: getTunnelInNodeIds(tunnel),
      outNodeId: tunnel.outNodeId || null,
      protocol: tunnel.protocol || 'tls',
      tcpListenAddr: tunnel.tcpListenAddr || '[::]',
      udpListenAddr: tunnel.udpListenAddr || '[::]',
      interfaceName: tunnel.interfaceName || '',
      muxEnabled: tunnel.muxEnabled ?? false,
      muxPort: tunnel.muxPort ?? null,
      flow: tunnel.flow,
      trafficRatio: tunnel.trafficRatio,
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
      outNodeId: type === 1 ? null : prev.outNodeId,
      protocol: type === 1 ? 'tls' : prev.protocol,
      muxEnabled: type === 1 ? false : true,
      muxPort: type === 1 ? null : (nodes.find((node) => node.id === prev.outNodeId)?.outPort ?? prev.muxPort)
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

  // 获取流量计算显示
  const getFlowDisplay = (flow: number) => {
    switch (flow) {
      case 1:
        return '单向计算';
      case 2:
        return '双向计算';
      default:
        return '未知';
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

        <div className="border border-divider rounded-lg overflow-hidden">
          <Table
            removeWrapper
            aria-label="隧道列表"
            classNames={{
              th: "bg-default-50 text-default-600 text-xs",
              td: "py-3 align-top",
            }}
          >
            <TableHeader>
              <TableColumn>隧道名称</TableColumn>
              <TableColumn>类型</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>入口节点</TableColumn>
              <TableColumn>出口节点</TableColumn>
              <TableColumn>计费</TableColumn>
              <TableColumn>倍率</TableColumn>
              <TableColumn className="text-right">操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                <div className="text-default-500 text-sm py-8">
                  暂无隧道配置，点击上方按钮开始创建
                </div>
              }
            >
              {tunnels.map((tunnel) => {
                const statusDisplay = getStatusDisplay(tunnel.status);
                const typeDisplay = getTypeDisplay(tunnel.type);
                const inNodeIds = getTunnelInNodeIds(tunnel);
                const outNodeName = tunnel.type === 1 ? getNodeNames(inNodeIds) : getNodeNames(tunnel.outNodeId ? [tunnel.outNodeId] : []);
                const outIp = tunnel.type === 1 ? getDisplayIp(tunnel.inIp) : getDisplayIp(tunnel.outIp);

                return (
                  <TableRow key={tunnel.id}>
                    <TableCell>
                      <div className="text-sm font-medium text-foreground">{tunnel.name}</div>
                    </TableCell>
                    <TableCell>
                      <Chip color={typeDisplay.color as any} variant="flat" size="sm">
                        {typeDisplay.text}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip color={statusDisplay.color as any} variant="flat" size="sm">
                        {statusDisplay.text}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="font-medium">{getNodeNames(inNodeIds)}</div>
                        <div className="text-default-500">{getDisplayIp(tunnel.inIp)}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="font-medium">{outNodeName}</div>
                        <div className="text-default-500">{outIp}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium text-foreground">
                        {getFlowDisplay(tunnel.flow)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs font-medium text-foreground">{tunnel.trafficRatio}x</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          onPress={() => handleEdit(tunnel)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="warning"
                          onPress={() => handleDiagnose(tunnel)}
                        >
                          诊断
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => handleDelete(tunnel)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* 新增/编辑模态框 */}
        <Modal 
          isOpen={modalOpen}
          onOpenChange={setModalOpen}
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  <h2 className="text-xl font-bold">
                    {isEdit ? '编辑隧道' : '新增隧道'}
                  </h2>
                  <p className="text-small text-default-500">
                    {isEdit ? '修改现有隧道配置的信息' : '创建新的隧道配置'}
                  </p>
                </ModalHeader>
                <ModalBody>
                  <div className="space-y-4">
                    <Input
                      label="隧道名称"
                      placeholder="请输入隧道名称"
                      value={form.name}
                      onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                      isInvalid={!!errors.name}
                      errorMessage={errors.name}
                      variant="bordered"
                    />
                    
                    <Select
                      label="隧道类型"
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
                    >
                      <SelectItem key="1">端口转发</SelectItem>
                      <SelectItem key="2">隧道转发</SelectItem>
                    </Select>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Select
                        label="流量计算"
                        placeholder="请选择流量计算方式"
                        selectedKeys={[form.flow.toString()]}
                        onSelectionChange={(keys) => {
                          const selectedKey = Array.from(keys)[0] as string;
                          if (selectedKey) {
                            setForm(prev => ({ ...prev, flow: parseInt(selectedKey) }));
                          }
                        }}
                        isInvalid={!!errors.flow}
                        errorMessage={errors.flow}
                        variant="bordered"
                      >
                        <SelectItem key="1">单向计算（仅上传）</SelectItem>
                        <SelectItem key="2">双向计算（上传+下载）</SelectItem>
                      </Select>

                      <Input
                        label="流量倍率"
                        placeholder="请输入流量倍率"
                        type="number"
                        value={form.trafficRatio.toString()}
                        onChange={(e) => setForm(prev => ({ 
                          ...prev, 
                          trafficRatio: parseFloat(e.target.value) || 0
                        }))}
                        isInvalid={!!errors.trafficRatio}
                        errorMessage={errors.trafficRatio}
                        variant="bordered"
                        endContent={
                          <div className="pointer-events-none flex items-center">
                            <span className="text-default-400 text-small">x</span>
                          </div>
                        }
                      />
                    </div>

                    <Divider />
                    <h3 className="text-lg font-semibold">入口配置</h3>

                    <Select
                      label="入口节点"
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
                    >
                      {nodes.map((node) => (
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="TCP监听地址"
                        placeholder="请输入TCP监听地址"
                        value={form.tcpListenAddr}
                        onChange={(e) => setForm(prev => ({ ...prev, tcpListenAddr: e.target.value }))}
                        isInvalid={!!errors.tcpListenAddr}
                        errorMessage={errors.tcpListenAddr}
                        variant="bordered"
                        startContent={
                          <div className="pointer-events-none flex items-center">
                            <span className="text-default-400 text-small">TCP</span>
                          </div>
                        }
                      />

                      <Input
                        label="UDP监听地址"
                        placeholder="请输入UDP监听地址"
                        value={form.udpListenAddr}
                        onChange={(e) => setForm(prev => ({ ...prev, udpListenAddr: e.target.value }))}
                        isInvalid={!!errors.udpListenAddr}
                        errorMessage={errors.udpListenAddr}
                        variant="bordered"
                        startContent={
                          <div className="pointer-events-none flex items-center">
                            <span className="text-default-400 text-small">UDP</span>
                          </div>
                        }
                      />
                    </div>

                    {/* 隧道转发时显示出口网卡配置 */}
                    {form.type === 2 && (
                      <Input
                        label="出口网卡名或IP"
                        placeholder="请输入出口网卡名或IP"
                        value={form.interfaceName}
                        onChange={(e) => setForm(prev => ({ ...prev, interfaceName: e.target.value }))}
                        isInvalid={!!errors.interfaceName}
                        errorMessage={errors.interfaceName}
                        variant="bordered"
                      />
                    )}

                    {/* 隧道转发时显示出口配置 */}
                    {form.type === 2 && (
                      <>
                        <Divider />
                        <h3 className="text-lg font-semibold">出口配置</h3>

                        <Select
                          label="协议类型"
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
                        >
                          <SelectItem key="tls">TLS</SelectItem>
                          <SelectItem key="wss">WSS</SelectItem>
                          <SelectItem key="tcp">TCP</SelectItem>
                          <SelectItem key="mtls">MTLS</SelectItem>
                          <SelectItem key="mwss">MWSS</SelectItem>
                          <SelectItem key="mtcp">MTCP</SelectItem>
                        </Select>

                        <Select
                          label="出口节点"
                          placeholder="请选择出口节点"
                          selectedKeys={form.outNodeId ? [form.outNodeId.toString()] : []}
                          onSelectionChange={(keys) => {
                            const selectedKey = Array.from(keys)[0] as string;
                            if (selectedKey) {
                              const selectedId = parseInt(selectedKey);
                              const selectedNode = nodes.find((node) => node.id === selectedId);
                              setForm(prev => ({ 
                                ...prev, 
                                outNodeId: selectedId,
                                muxPort: selectedNode?.outPort ?? null
                              }));
                            }
                          }}
                          isInvalid={!!errors.outNodeId}
                          errorMessage={errors.outNodeId}
                          variant="bordered"
                        >
                          {nodes.map((node) => (
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

                        <Input
                          label="绑定端口"
                          value={form.muxPort !== null && form.muxPort !== undefined ? form.muxPort.toString() : '未配置'}
                          variant="bordered"
                          isReadOnly
                          description="端口来自出口节点设置"
                        />
                      </>
                    )}

                    <div className="mt-3 text-xs text-default-500 space-y-1">
                      <div>TCP/UDP监听地址：V6或双栈填写 [::]，V4 填写 0.0.0.0。</div>
                      <div>出口网卡名或IP：多 IP 服务器指定出口地址，不懂可留空。</div>
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
                  <p>确定要删除隧道 <strong>"{tunnelToDelete?.name}"</strong> 吗？</p>
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

        {/* 诊断结果模态框 */}
        <Modal 
          isOpen={diagnosisModalOpen}
          onOpenChange={setDiagnosisModalOpen}
          size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">隧道诊断结果</h2>
                    {currentDiagnosisTunnel && (
                      <div className="flex items-center gap-2 text-xs text-default-500 mt-1">
                        <span className="truncate">{currentDiagnosisTunnel.name}</span>
                        <span className="text-default-300">•</span>
                        <span>{currentDiagnosisTunnel.type === 1 ? '端口转发' : '隧道转发'}</span>
                      </div>
                    )}
                  </div>
                </ModalHeader>
                <ModalBody>
                  {diagnosisLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <div className="flex items-center gap-3">
                        <Spinner size="sm" />
                        <span className="text-default-600">正在诊断...</span>
                      </div>
                    </div>
                  ) : diagnosisResult ? (
                    <div className="border border-divider rounded-md overflow-hidden">
                      <div className="grid grid-cols-[1fr_120px_120px_120px_120px] bg-default-100 text-xs font-semibold text-default-700 px-4 py-2">
                        <div>路径</div>
                        <div className="text-center">状态</div>
                        <div className="text-center">延迟(ms)</div>
                        <div className="text-center">丢包率</div>
                        <div className="text-center">质量</div>
                      </div>
                      <div className="divide-y divide-divider">
                        {diagnosisResult.results.map((result, index) => {
                          const quality = getQualityDisplay(result.averageTime, result.packetLoss);
                          const targetAddress = `${result.targetIp}${result.targetPort ? ':' + result.targetPort : ''}`;

                          return (
                            <div key={index} className="grid grid-cols-[1fr_120px_120px_120px_120px] px-4 py-3 items-center">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground truncate">
                                  {result.description}（{result.nodeName}）
                                </div>
                                <div className="text-xs text-default-500 font-mono truncate">{targetAddress}</div>
                                {!result.success && (
                                  <div className="text-xs text-default-500 mt-1 truncate">
                                    错误: {result.message || '-'}
                                  </div>
                                )}
                              </div>
                              <div className="flex justify-center">
                                <Chip 
                                  color={result.success ? 'success' : 'danger'} 
                                  variant="flat"
                                  size="sm"
                                >
                                  {result.success ? '成功' : '失败'}
                                </Chip>
                              </div>
                              <div className="text-center text-sm font-semibold text-foreground">
                                {result.success ? result.averageTime?.toFixed(0) : '--'}
                              </div>
                              <div className="text-center text-sm font-semibold text-foreground">
                                {result.success ? `${result.packetLoss?.toFixed(1)}%` : '--'}
                              </div>
                              <div className="flex justify-center">
                                {result.success && quality ? (
                                  <Chip color={quality.color as any} variant="flat" size="sm">
                                    {quality.text}
                                  </Chip>
                                ) : (
                                  <span className="text-xs text-default-400">-</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10">
                      <div className="w-16 h-16 bg-default-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-default-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">暂无诊断数据</h3>
                    </div>
                  )}
                </ModalBody>
                <ModalFooter>
                  <Button size="sm" variant="light" onPress={onClose}>
                    关闭
                  </Button>
                  {currentDiagnosisTunnel && (
                    <Button 
                      size="sm"
                      color="primary" 
                      onPress={() => handleDiagnose(currentDiagnosisTunnel)}
                      isLoading={diagnosisLoading}
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
