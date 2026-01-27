import { useState, useEffect } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Spinner } from "@heroui/spinner";
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

  return (
      <div className="flex flex-col gap-6">
        {/* Toolbar */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
             <div className="flex items-center justify-between gap-4">
                 <div className="flex items-center gap-2">
                    {/* Placeholder search */}
                 </div>
                 
                 <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      color="primary" 
                      startContent={<span className="text-lg">+</span>}
                      onPress={handleAdd}
                    >
                      新增规则
                    </Button>
                 </div>
             </div>
        </div>

        {/* 规则列表 */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden min-h-[400px]">
          {loading ? (
             <div className="flex items-center justify-center h-64">
               <div className="flex flex-col items-center gap-3">
                 <Spinner size="lg" color="primary" />
                 <span className="text-gray-500 text-sm">正在加载限速规则...</span>
               </div>
             </div>
          ) : rules.length > 0 ? (
           <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                    <tr>
                       <th className="px-6 py-3">规则名称</th>
                       <th className="px-6 py-3">状态</th>
                       <th className="px-6 py-3">速度限制</th>
                       <th className="px-6 py-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                      <td className="px-6 py-4 align-middle">
                         <span className="font-medium text-gray-900 dark:text-gray-100">{rule.name}</span>
                      </td>
                      <td className="px-6 py-4 align-middle">
                         <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                            rule.status === 1 
                              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50' 
                              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50'
                         }`}>
                           <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                              rule.status === 1 ? 'bg-green-500' : 'bg-red-500'
                           }`}></span>
                           {rule.status === 1 ? '运行' : '异常'}
                         </span>
                      </td>
                      <td className="px-6 py-4 align-middle">
                         <span className="px-2 py-1 bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 rounded text-xs border border-gray-200 dark:border-gray-700 font-mono">
                           {rule.speed} Mbps
                         </span>
                      </td>
                      <td className="px-6 py-4 align-middle text-right w-[140px]">
                          <div className="flex justify-end gap-1">
                             <button 
                               className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
                               onClick={() => handleEdit(rule)}
                               title="编辑"
                              >
                                 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                 </svg>
                              </button>
                              <button 
                                className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-500 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-red-900/20 dark:hover:text-red-400 flex items-center justify-center transition-colors" 
                                onClick={() => handleDelete(rule)}
                                title="删除"
                              >
                                 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                 </svg>
                              </button>
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
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p>暂无限速规则</p>
                <Button size="sm" variant="light" color="primary" className="mt-2" onPress={handleAdd}>立即创建</Button>
            </div>
          )}
        </div>

        {/* 新增/编辑模态框 */}
        <Modal hideCloseButton 
          isOpen={modalOpen}
          onOpenChange={setModalOpen}
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
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {isEdit ? '编辑限速规则' : '新增限速规则'}
                  </h2>
                </ModalHeader>
                <ModalBody>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">规则名称</label>
                        <Input
                          placeholder="请输入限速规则名称"
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
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">速度限制</label>
                        <Input
                          placeholder="请输入速度限制"
                          type="number"
                          value={form.speed.toString()}
                          onChange={(e) => setForm(prev => ({ ...prev, speed: parseInt(e.target.value) || 0 }))}
                          isInvalid={!!errors.speed}
                          errorMessage={errors.speed}
                          variant="bordered"
                          classNames={{
                              inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                              input: "text-sm"
                           }}
                          endContent={
                            <div className="pointer-events-none flex items-center border-l border-gray-200 dark:border-gray-700 pl-2">
                              <span className="text-gray-500 text-xs">Mbps</span>
                            </div>
                          }
                        />
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
                    className="font-medium"
                  >
                    {isEdit ? '保存修改' : '创建规则'}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* 删除确认模态框 */}
        <Modal hideCloseButton 
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
                    <p>确定要删除限速规则 <strong className="text-gray-900 dark:text-gray-100">"{ruleToDelete?.name}"</strong> 吗？</p>
                    <p className="mt-1">此操作无法撤销，删除后该规则将永久消失。</p>
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
