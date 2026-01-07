import { useState, useEffect } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
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


import { 
  createSpeedLimit, 
  getSpeedLimitList, 
  updateSpeedLimit, 
  deleteSpeedLimit
} from "@/api";

interface SpeedLimitRule {
  id: number;
  name: string;
  speed: number;
  status: number;
  createdTime: string;
  updatedTime: string;
}

interface SpeedLimitForm {
  id?: number;
  name: string;
  speed: number;
  status: number;
}

export default function LimitPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SpeedLimitRule[]>([]);
  
  // 模态框状态
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<SpeedLimitRule | null>(null);
  
  // 表单状态
  const [form, setForm] = useState<SpeedLimitForm>({
    name: '',
    speed: 100,
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
      const rulesRes = await getSpeedLimitList();
      
      if (rulesRes.code === 0) {
        setRules(rulesRes.data || []);
      } else {
        toast.error(rulesRes.msg || '获取限速规则失败');
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
      newErrors.name = '请输入规则名称';
    } else if (form.name.length < 2 || form.name.length > 50) {
      newErrors.name = '规则名称长度应在2-50个字符之间';
    }
    
    if (!form.speed || form.speed < 1) {
      newErrors.speed = '请输入有效的速度限制（≥1 Mbps）';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 新增规则
  const handleAdd = () => {
    setIsEdit(false);
    setForm({
      name: '',
      speed: 100,
      status: 1
    });
    setErrors({});
    setModalOpen(true);
  };

  // 编辑规则
  const handleEdit = (rule: SpeedLimitRule) => {
    setIsEdit(true);
    setForm({
      id: rule.id,
      name: rule.name,
      speed: rule.speed,
      status: rule.status
    });
    setErrors({});
    setModalOpen(true);
  };

  // 显示删除确认
  const handleDelete = (rule: SpeedLimitRule) => {
    setRuleToDelete(rule);
    setDeleteModalOpen(true);
  };

  // 确认删除规则
  const confirmDelete = async () => {
    if (!ruleToDelete) return;
    
    setDeleteLoading(true);
    try {
      const res = await deleteSpeedLimit(ruleToDelete.id);
      if (res.code === 0) {
        toast.success('删除成功');
        setDeleteModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (error) {
      console.error('删除失败:', error);
      toast.error('删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  // 提交表单
  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setSubmitLoading(true);
    try {
      let res;
      if (isEdit) {
        res = await updateSpeedLimit(form);
      } else {
        const { id, ...createData } = form;
        res = await createSpeedLimit(createData);
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
            aria-label="限速规则列表"
            classNames={{
              th: "bg-default-50 text-default-600 text-xs",
              td: "py-3 align-top",
            }}
          >
            <TableHeader>
              <TableColumn>规则名称</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>速度限制</TableColumn>
              <TableColumn className="text-right">操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                <div className="text-default-500 text-sm py-8">
                  暂无限速规则，点击上方按钮开始创建
                </div>
              }
            >
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <div className="text-sm font-medium text-foreground">{rule.name}</div>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      color={rule.status === 1 ? "success" : "danger"} 
                      variant="flat" 
                      size="sm"
                    >
                      {rule.status === 1 ? '运行' : '异常'}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Chip color="secondary" variant="flat" size="sm">
                      {rule.speed} Mbps
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="flat"
                        color="primary"
                        onPress={() => handleEdit(rule)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        onPress={() => handleDelete(rule)}
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
                    {isEdit ? '编辑限速规则' : '新增限速规则'}
                  </h2>
                  <p className="text-small text-default-500">
                    {isEdit ? '修改现有限速规则的配置信息' : '创建新的限速规则'}
                  </p>
                </ModalHeader>
                <ModalBody>
                  <div className="space-y-4">
                    <Input
                      label="规则名称"
                      placeholder="请输入限速规则名称"
                      value={form.name}
                      onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                      isInvalid={!!errors.name}
                      errorMessage={errors.name}
                      variant="bordered"
                    />
                    
                    <Input
                      label="速度限制"
                      placeholder="请输入速度限制"
                      type="number"
                      value={form.speed.toString()}
                      onChange={(e) => setForm(prev => ({ ...prev, speed: parseInt(e.target.value) || 0 }))}
                      isInvalid={!!errors.speed}
                      errorMessage={errors.speed}
                      variant="bordered"
                      endContent={
                        <div className="pointer-events-none flex items-center">
                          <span className="text-default-400 text-small">Mbps</span>
                        </div>
                      }
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
                    onPress={handleSubmit}
                    isLoading={submitLoading}
                  >
                    {isEdit ? '保存修改' : '创建规则'}
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
                  <h2 className="text-lg font-bold text-danger">确认删除</h2>
                </ModalHeader>
                <ModalBody>
                  <p className="text-default-600">
                    确定要删除限速规则 <span className="font-semibold text-foreground">"{ruleToDelete?.name}"</span> 吗？
                  </p>
                  <p className="text-small text-default-500 mt-2">
                    此操作无法撤销，删除后该规则将永久消失。
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
      </div>
    
  );
} 
