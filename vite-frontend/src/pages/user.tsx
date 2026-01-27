import { useState, useEffect } from 'react';
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { RadioGroup, Radio } from "@heroui/radio";
import { DatePicker } from "@heroui/date-picker";
import { 
  Modal, 
  ModalContent, 
  ModalHeader, 
  ModalBody, 
  ModalFooter,
  useDisclosure 
} from "@heroui/modal";
import { Spinner } from "@heroui/spinner";

import toast from 'react-hot-toast';
import {
  User,
  UserForm,
  UserNode,
  UserNodeForm,
  Node,
  SpeedLimit,
  Pagination as PaginationType
} from '@/types';
import {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getNodeList,
  assignUserNode,
  getUserNodeList,
  removeUserNode,
  getSpeedLimitList,
  resetUserFlow
} from '@/api';
import { SearchIcon, EditIcon, DeleteIcon, SettingsIcon, PlusIcon } from '@/components/icons';
import { parseDate } from "@internationalized/date";


// 工具函数
const formatFlow = (value: number, unit: string = 'bytes'): string => {
  if (unit === 'gb') {
    return `${value} GB`;
  } else {
    if (value === 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(2)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
};

const formatDate = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const getExpireStatus = (expTime: number) => {
  const now = Date.now();
  if (expTime < now) {
    return { color: 'danger' as const, text: '已过期' };
  }
  const diffDays = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return { color: 'warning' as const, text: `${diffDays}天后过期` };
  }
  return { color: 'success' as const, text: '正常' };
};

// 获取用户状态（根据status字段）
const getUserStatus = (user: User) => {
  if (user.status === 1) {
    return { color: 'success' as const, text: '正常' };
  } else {
    return { color: 'danger' as const, text: '禁用' };
  }
};

const getNodeAccessTypeLabel = (accessType?: number) => {
  switch (accessType) {
    case 1:
      return '仅入口';
    case 2:
      return '仅出口';
    default:
      return '出/入口';
  }
};

const calculateUserTotalUsedFlow = (user: User): number => {
  return (user.inFlow || 0) + (user.outFlow || 0);
};

export default function UserPage() {
  // 状态管理
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [pagination, setPagination] = useState<PaginationType>({
    current: 1,
    size: 10,
    total: 0
  });

  // 用户表单相关状态
  const { isOpen: isUserModalOpen, onOpen: onUserModalOpen, onClose: onUserModalClose } = useDisclosure();
  const [isEdit, setIsEdit] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({
    user: '',
    pwd: '',
    status: 1,
    flow: 100,
    num: 10,
    expTime: null,
    flowResetTime: 0,
    allowNodeCreate: 0,
    speedId: null
  });
  const [userFormLoading, setUserFormLoading] = useState(false);

  // 节点权限管理相关状态
  const { isOpen: isNodeModalOpen, onOpen: onNodeModalOpen, onClose: onNodeModalClose } = useDisclosure();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userNodes, setUserNodes] = useState<UserNode[]>([]);
  
  // 分配新节点权限相关状态
  const [nodeForm, setNodeForm] = useState<UserNodeForm>({
    nodeId: null,
    accessType: 0
  });
  const [assignLoading, setAssignLoading] = useState(false);

  // 删除确认相关状态
  const { isOpen: isDeleteModalOpen, onOpen: onDeleteModalOpen, onClose: onDeleteModalClose } = useDisclosure();
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  // 删除节点权限确认相关状态
  const { isOpen: isDeleteNodeModalOpen, onOpen: onDeleteNodeModalOpen, onClose: onDeleteNodeModalClose } = useDisclosure();
  const [nodeToDelete, setNodeToDelete] = useState<UserNode | null>(null);

  // 重置流量确认相关状态
  const { isOpen: isResetFlowModalOpen, onOpen: onResetFlowModalOpen, onClose: onResetFlowModalClose } = useDisclosure();
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [resetFlowLoading, setResetFlowLoading] = useState(false);

  // 其他数据
  const [nodes, setNodes] = useState<Node[]>([]);
  const [speedLimits, setSpeedLimits] = useState<SpeedLimit[]>([]);

  // 生命周期
  useEffect(() => {
    loadUsers();
    loadNodes();
    loadSpeedLimits();
  }, [pagination.current, pagination.size, searchKeyword]);

  // 数据加载函数
  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await getAllUsers({
        current: pagination.current,
        size: pagination.size,
        keyword: searchKeyword
      });
      
      if (response.code === 0) {
        const data = response.data || {};
        setUsers(data || []);
      } else {
        toast.error(response.msg || '获取用户列表失败');
      }
    } catch (error) {
      toast.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadNodes = async () => {
    try {
      const response = await getNodeList();
      if (response.code === 0) {
        setNodes(response.data || []);
      }
    } catch (error) {
      console.error('获取节点列表失败:', error);
    }
  };

  const loadSpeedLimits = async () => {
    try {
      const response = await getSpeedLimitList();
      if (response.code === 0) {
        setSpeedLimits(response.data || []);
      }
    } catch (error) {
      console.error('获取限速规则列表失败:', error);
    }
  };

  const loadUserNodes = async (userId: number) => {
    try {
      const response = await getUserNodeList({ userId });
      if (response.code === 0) {
        setUserNodes(response.data || []);
      } else {
        toast.error(response.msg || '获取节点权限列表失败');
      }
    } catch (error) {
      toast.error('获取节点权限列表失败');
    }
  };

  // 用户管理操作
  const handleSearch = () => {
    setPagination(prev => ({ ...prev, current: 1 }));
    loadUsers();
  };

  const handleAdd = () => {
    setIsEdit(false);
    setUserForm({
      user: '',
      pwd: '',
      status: 1,
      flow: 100,
      num: 10,
      expTime: null,
      flowResetTime: 0,
      allowNodeCreate: 0,
      speedId: null
    });
    onUserModalOpen();
  };

  const handleEdit = (user: User) => {
    setIsEdit(true);
    setUserForm({
      id: user.id,
      name: user.name,
      user: user.user,
      pwd: '',
      status: user.status,
      flow: user.flow,
      num: user.num,
      expTime: user.expTime ? new Date(user.expTime) : null,
      flowResetTime: user.flowResetTime ?? 0,
      allowNodeCreate: user.allowNodeCreate ?? 0,
      speedId: user.speedId ?? null
    });
    onUserModalOpen();
  };

  const handleDelete = (user: User) => {
    setUserToDelete(user);
    onDeleteModalOpen();
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;

    try {
      const response = await deleteUser(userToDelete.id);
      if (response.code === 0) {
        toast.success('删除成功');
        loadUsers();
        onDeleteModalClose();
        setUserToDelete(null);
      } else {
        toast.error(response.msg || '删除失败');
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleSubmitUser = async () => {
    if (!userForm.user || (!userForm.pwd && !isEdit) || !userForm.expTime) {
      toast.error('请填写完整信息');
      return;
    }

    setUserFormLoading(true);
    try {
      const submitData: any = {
        ...userForm,
        expTime: userForm.expTime.getTime()
      };

      if (isEdit && !submitData.pwd) {
        delete submitData.pwd;
      }

      const response = isEdit ? await updateUser(submitData) : await createUser(submitData);
      
      if (response.code === 0) {
        toast.success(isEdit ? '更新成功' : '创建成功');
        onUserModalClose();
        loadUsers();
      } else {
        toast.error(response.msg || (isEdit ? '更新失败' : '创建失败'));
      }
    } catch (error) {
      toast.error(isEdit ? '更新失败' : '创建失败');
    } finally {
      setUserFormLoading(false);
    }
  };

  // 节点权限管理操作
  const handleManageNodes = (user: User) => {
    setCurrentUser(user);
    setNodeForm({ nodeId: null, accessType: 0 });
    onNodeModalOpen();
    loadUserNodes(user.id);
  };

  const handleAssignNode = async () => {
    if (!nodeForm.nodeId || !currentUser) {
      toast.error('请选择节点');
      return;
    }

    setAssignLoading(true);
    try {
      const response = await assignUserNode({
        userId: currentUser.id,
        nodeId: nodeForm.nodeId,
        accessType: nodeForm.accessType
      });

      if (response.code === 0) {
        toast.success('分配成功');
        setNodeForm({ nodeId: null, accessType: 0 });
        loadUserNodes(currentUser.id);
      } else {
        toast.error(response.msg || '分配失败');
      }
    } catch (error) {
      toast.error('分配失败');
    } finally {
      setAssignLoading(false);
    }
  };

  const handleRemoveNode = (userNode: UserNode) => {
    setNodeToDelete(userNode);
    onDeleteNodeModalOpen();
  };

  const handleConfirmRemoveNode = async () => {
    if (!nodeToDelete) return;

    try {
      const response = await removeUserNode({ id: nodeToDelete.id });
      if (response.code === 0) {
        toast.success('删除成功');
        if (currentUser) {
          loadUserNodes(currentUser.id);
        }
        onDeleteNodeModalClose();
        setNodeToDelete(null);
      } else {
        toast.error(response.msg || '删除失败');
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  // 重置流量相关函数
  const handleResetFlow = (user: User) => {
    setUserToReset(user);
    onResetFlowModalOpen();
  };

  const handleConfirmResetFlow = async () => {
    if (!userToReset) return;

    setResetFlowLoading(true);
    try {
      const response = await resetUserFlow({ 
        id: userToReset.id, 
        type: 1 // 1表示重置用户流量
      });
      
      if (response.code === 0) {
        toast.success('流量重置成功');
        onResetFlowModalClose();
        setUserToReset(null);
        loadUsers(); // 重新加载用户列表
      } else {
        toast.error(response.msg || '重置失败');
      }
    } catch (error) {
      toast.error('重置失败');
    } finally {
      setResetFlowLoading(false);
    }
  };

  // 过滤数据
  const availableNodes = nodes.filter(
    node => !userNodes.some(userNode => userNode.nodeId === node.id)
  );

  return (
    <div className="flex flex-col gap-6">
      {/* 页面头部 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2 flex-1 max-w-md w-full">
            <div className="relative flex-1">
                 <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                 <Input
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="搜索用户名"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    size="sm"
                    variant="bordered"
                    classNames={{
                        inputWrapper: "bg-white dark:bg-zinc-900 border-gray-200 dark:border-gray-700 pl-9 hover:border-gray-400 focus-within:!border-blue-500 rounded-lg h-9 shadow-sm",
                        input: "text-sm",
                        innerWrapper: "bg-transparent",
                    }}
                />
            </div>
            <Button
              onPress={handleSearch}
              color="primary"
              size="sm"
              className="min-w-0 px-4 font-medium"
            >
              搜索
            </Button>
          </div>
          
          <Button
            size="sm"
            color="primary"
            onPress={handleAdd}
            startContent={<PlusIcon size={16} />}
            className="font-medium"
          >
            新增用户
          </Button>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden min-h-[400px]">
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" color="primary" />
            <span className="text-gray-500 text-sm">正在加载用户数据...</span>
          </div>
        </div>
      ) : users.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                   <th className="px-6 py-3">用户</th>
                   <th className="px-6 py-3">状态</th>
                   <th className="px-6 py-3">流量</th>
                   <th className="px-6 py-3">转发数量</th>
                   <th className="px-6 py-3">重置时间</th>
                   <th className="px-6 py-3">到期时间</th>
                   <th className="px-6 py-3 text-right">操作</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {users.map((user) => {
                const userStatus = getUserStatus(user);
                const expStatus = user.expTime ? getExpireStatus(user.expTime) : null;
                const usedFlow = calculateUserTotalUsedFlow(user);
                const flowPercent = user.flow > 0 ? Math.min((usedFlow / (user.flow * 1024 * 1024 * 1024)) * 100, 100) : 0;
                
                return (
                  <tr key={user.id} className="group hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-6 py-4 align-top">
                      <div className="flex flex-col">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {user.name || user.user}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">@{user.user}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                         <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                            userStatus.color === 'success'
                              ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50' 
                              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50'
                         }`}>
                           <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                              userStatus.color === 'success' ? 'bg-green-500' : 'bg-red-500'
                           }`}></span>
                           {userStatus.text}
                         </span>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="space-y-2 min-w-[160px]">
                        <div className="flex items-center justify-between text-xs mb-1">
                             <div className="text-gray-500 flex items-center gap-1">
                                已用 <span className="text-gray-900 dark:text-gray-200 font-mono">{formatFlow(usedFlow)}</span>
                             </div>
                             <div className="text-gray-400 font-mono text-[10px]">
                                / {formatFlow(user.flow, 'gb')}
                             </div>
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                           <div 
                              className={`h-full rounded-full transition-all duration-500 ${
                                  flowPercent > 90 ? 'bg-red-500' : flowPercent > 75 ? 'bg-orange-500' : 'bg-blue-500'
                              }`} 
                              style={{ width: `${flowPercent}%` }}
                           ></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-zinc-800 rounded text-xs font-mono text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                        {user.num}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {user.flowResetTime === 0 ? '不重置' : `每月${user.flowResetTime}号`}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {user.expTime ? (
                         expStatus && expStatus.color === 'success' ? (
                          <span className="text-sm text-gray-600 dark:text-gray-400">{formatDate(user.expTime)}</span>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${
                             expStatus?.color === 'danger' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-orange-50 text-orange-600 border-orange-200'
                          }`}>
                            {expStatus?.text || '未知状态'}
                          </span>
                        )
                      ) : (
                        <span className="text-sm text-gray-400">不限制</span>
                      )}
                    </td>
                    <td className="px-6 py-4 align-top text-right">
                      <div className="flex flex-wrap justify-end gap-1 w-[160px]">
                        <button 
                             className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-zinc-800 flex items-center justify-center transition-colors"
                             onClick={() => handleEdit(user)}
                             title="编辑"
                          >
                             <EditIcon className="w-3.5 h-3.5" />
                        </button>
                        <button 
                             className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-orange-50 text-gray-600 hover:text-orange-500 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-orange-900/20 dark:hover:text-orange-400 flex items-center justify-center transition-colors"
                             onClick={() => handleResetFlow(user)}
                             title="重置流量"
                          >
                             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                             </svg>
                        </button>
                         <button 
                             className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-blue-50 text-gray-600 hover:text-blue-500 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 flex items-center justify-center transition-colors"
                             onClick={() => handleManageNodes(user)}
                             title="节点权限"
                          >
                             <SettingsIcon className="w-3.5 h-3.5 translate-y-0.5" />
                        </button>
                        <button 
                             className="w-7 h-7 rounded border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-500 dark:border-gray-700 dark:bg-zinc-900 dark:text-gray-300 dark:hover:bg-red-900/20 dark:hover:text-red-400 flex items-center justify-center transition-colors"
                             onClick={() => handleDelete(user)}
                             title="删除"
                          >
                             <DeleteIcon className="w-3.5 h-3.5" />
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
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
           <svg className="w-12 h-12 mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
           </svg>
           <p className="text-gray-500">暂无用户数据</p>
           <Button size="sm" variant="light" color="primary" className="mt-2" onPress={handleAdd}>立即创建</Button>
        </div>
      )}
      </div>


      {/* 用户表单模态框 */}
      <Modal hideCloseButton
        isOpen={isUserModalOpen}
        onClose={onUserModalClose}
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
          <ModalHeader className="text-lg font-bold">
            {isEdit ? '编辑用户' : '新增用户'}
          </ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="用户名"
                labelPlacement="outside"
                placeholder="请输入用户名"
                value={userForm.user}
                onChange={(e) => setUserForm(prev => ({ ...prev, user: e.target.value }))}
                isRequired
                variant="bordered"
                classNames={{
                    inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                    input: "text-sm"
                 }}
              />
              <Input
                label="密码"
                labelPlacement="outside"
                type="password"
                value={userForm.pwd}
                onChange={(e) => setUserForm(prev => ({ ...prev, pwd: e.target.value }))}
                placeholder={isEdit ? '留空则不修改密码' : '请输入密码'}
                isRequired={!isEdit}
                variant="bordered"
                classNames={{
                    inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                    input: "text-sm"
                 }}
              />
              <Input
                label="流量限制(GB)"
                labelPlacement="outside"
                type="number"
                value={userForm.flow.toString()}
                onChange={(e) => {
                  const value = Math.min(Math.max(Number(e.target.value) || 0, 1), 99999);
                  setUserForm(prev => ({ ...prev, flow: value }));
                }}
                min="1"
                max="99999"
                isRequired
                variant="bordered"
                classNames={{
                    inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                    input: "text-sm"
                 }}
              />
              <Input
                label="转发数量"
                labelPlacement="outside"
                type="number"
                value={userForm.num.toString()}
                onChange={(e) => {
                  const value = Math.min(Math.max(Number(e.target.value) || 0, 1), 99999);
                  setUserForm(prev => ({ ...prev, num: value }));
                }}
                min="1"
                max="99999"
                isRequired
                variant="bordered"
                classNames={{
                    inputWrapper: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                    input: "text-sm"
                 }}
              />
              <Select
                label="允许创建节点"
                labelPlacement="outside"
                selectedKeys={[userForm.allowNodeCreate.toString()]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, allowNodeCreate: Number(value) }));
                }}
                variant="bordered"
                classNames={{
                    trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                 }}
              >
                <SelectItem key="1" textValue="允许">
                  允许
                </SelectItem>
                <SelectItem key="0" textValue="禁止">
                  禁止
                </SelectItem>
              </Select>
              <Select
                label="限速规则"
                labelPlacement="outside"
                selectedKeys={userForm.speedId ? [userForm.speedId.toString()] : ["null"]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, speedId: value === "null" ? null : Number(value) }));
                }}
                variant="bordered"
                classNames={{
                    trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                 }}
              >
                {[
                  <SelectItem key="null" textValue="不限速">不限速</SelectItem>,
                  ...speedLimits.map(speedLimit => (
                    <SelectItem key={speedLimit.id.toString()} textValue={speedLimit.name}>
                      {speedLimit.name}
                    </SelectItem>
                  ))
                ]}
              </Select>
              <Select
                label="流量重置日期"
                labelPlacement="outside"
                selectedKeys={[userForm.flowResetTime.toString()]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, flowResetTime: Number(value) }));
                }}
                variant="bordered"
                classNames={{
                    trigger: "bg-white dark:bg-zinc-900 border-gray-300 dark:border-gray-700 shadow-none hover:border-gray-400 focus-within:!border-blue-500 rounded-lg",
                 }}
              >
                {[
                  <SelectItem key="0" textValue="不重置">
                    不重置
                  </SelectItem>,
                  ...Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                    <SelectItem key={day.toString()} textValue={`每月${day}号（0点重置）`}>
                      每月{day}号（0点重置）
                    </SelectItem>
                  ))
                ]}
              </Select>
              <DatePicker
                label="过期时间"
                labelPlacement="outside"
                value={userForm.expTime ? parseDate(userForm.expTime.toISOString().split('T')[0]) as any : null}
                onChange={(date) => {
                  if (date) {
                    const jsDate = new Date(date.year, date.month - 1, date.day, 23, 59, 59);
                    setUserForm(prev => ({ ...prev, expTime: jsDate }));
                  } else {
                    setUserForm(prev => ({ ...prev, expTime: null }));
                  }
                }}
                isRequired
                showMonthAndYearPickers
                className="cursor-pointer"
                variant="bordered"
              />
            </div>
            
            <div className="mt-4">
                <RadioGroup
                  label="状态"
                  value={userForm.status.toString()}
                  onValueChange={(value: string) => setUserForm(prev => ({ ...prev, status: Number(value) }))}
                  orientation="horizontal"
                  classNames={{
                      label: "text-sm text-gray-700 dark:text-gray-300 mb-2"
                  }}
                >
                  <Radio value="1">正常</Radio>
                  <Radio value="0">禁用</Radio>
                </RadioGroup>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onUserModalClose}>
              取消
            </Button>
            <Button
              size="sm"
              color="primary"
              onPress={handleSubmitUser}
              isLoading={userFormLoading}
            >
              确定
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 节点权限管理模态框 */}
      <Modal hideCloseButton
        isOpen={isNodeModalOpen}
        onClose={onNodeModalClose}
        size="3xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        isDismissable={false}
        classNames={{
            base: "bg-white dark:bg-[#18181b] border border-gray-100 dark:border-gray-800 shadow-xl rounded-xl",
            header: "border-b border-gray-100 dark:border-gray-800 pb-4",
            body: "py-6",
            footer: "border-t border-gray-100 dark:border-gray-800 pt-4"
        }}
      >
        <ModalContent>
          <ModalHeader className="text-lg font-bold">
            用户 {currentUser?.user} 的节点权限
          </ModalHeader>
          <ModalBody>
            <div className="space-y-6">
              <div className="bg-gray-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">分配新权限</h3>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                  <Select
                    label="选择节点"
                    placeholder="请选择节点"
                    labelPlacement="outside"
                    selectedKeys={nodeForm.nodeId ? [nodeForm.nodeId.toString()] : []}
                    onSelectionChange={(keys) => {
                      const value = Array.from(keys)[0] as string;
                      setNodeForm((prev) => ({ ...prev, nodeId: Number(value) || null }));
                    }}
                    variant="bordered"
                    classNames={{
                        trigger: "bg-white dark:bg-zinc-900 border-gray-200"
                    }}
                  >
                    {availableNodes.map((node) => (
                      <SelectItem key={node.id.toString()} textValue={node.name}>
                        {node.name} ({node.ip})
                      </SelectItem>
                    ))}
                  </Select>
                  <Select
                    label="权限类型"
                    placeholder="选择权限"
                    labelPlacement="outside"
                    selectedKeys={[nodeForm.accessType.toString()]}
                    onSelectionChange={(keys) => {
                      const value = Array.from(keys)[0] as string;
                      const parsed = Number(value);
                      setNodeForm((prev) => ({ ...prev, accessType: Number.isNaN(parsed) ? 0 : parsed }));
                    }}
                    variant="bordered"
                    classNames={{
                        trigger: "bg-white dark:bg-zinc-900 border-gray-200"
                    }}
                  >
                    <SelectItem key="0">出/入口</SelectItem>
                    <SelectItem key="1">仅入口</SelectItem>
                    <SelectItem key="2">仅出口</SelectItem>
                  </Select>
                  <Button
                    color="primary"
                    onPress={handleAssignNode}
                    isLoading={assignLoading}
                    className="mb-0.5"
                  >
                    分配
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">已有节点权限</h3>
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-zinc-800 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-800">
                            <tr>
                                <th className="px-4 py-2">节点名称</th>
                                <th className="px-4 py-2">权限类型</th>
                                <th className="px-4 py-2">入口IP</th>
                                <th className="px-4 py-2">服务器IP</th>
                                <th className="px-4 py-2 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                            {userNodes.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                                        暂无节点权限
                                    </td>
                                </tr>
                            ) : (
                                userNodes.map(userNode => (
                                    <tr key={userNode.id}>
                                        <td className="px-4 py-3">{userNode.nodeName}</td>
                                        <td className="px-4 py-3">
                                            <span className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                                {getNodeAccessTypeLabel(userNode.accessType)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{userNode.ip}</td>
                                        <td className="px-4 py-3 text-gray-500 text-xs font-mono">{userNode.serverIp}</td>
                                        <td className="px-4 py-3 text-right">
                                            <Button
                                              size="sm"
                                              variant="light"
                                              color="danger"
                                              isIconOnly
                                              onClick={() => handleRemoveNode(userNode)}
                                              className="h-7 w-7 min-w-0"
                                            >
                                              <DeleteIcon className="w-4 h-4" />
                                            </Button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="light" onPress={onNodeModalClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除确认对话框 */}
      <Modal hideCloseButton
        isOpen={isDeleteModalOpen}
        onClose={onDeleteModalClose}
        size="md"
        scrollBehavior="outside"
        placement="center"
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
            确认删除用户
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center flex-shrink-0">
                <DeleteIcon className="w-6 h-6 text-red-500" />
              </div>
              <div className="flex-1 text-sm">
                <p className="text-gray-900 dark:text-gray-100">
                  确定要删除用户 <span className="font-semibold text-red-500">"{userToDelete?.user}"</span> 吗？
                </p>
                <p className="text-gray-500 mt-2">
                  此操作不可撤销，用户的所有数据将被永久删除。
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button 
              size="sm"
              variant="light" 
              onPress={onDeleteModalClose}
            >
              取消
            </Button>
            <Button 
              size="sm"
              color="danger" 
              onPress={handleConfirmDelete}
            >
              确认删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除节点权限确认对话框 */}
      <Modal hideCloseButton
        isOpen={isDeleteNodeModalOpen}
        onClose={onDeleteNodeModalClose}
        size="md"
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
            确认删除节点权限
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center flex-shrink-0">
                <DeleteIcon className="w-6 h-6 text-red-500" />
              </div>
              <div className="flex-1 text-sm">
                <p className="text-gray-900 dark:text-gray-100">
                  确定要删除用户 <span className="font-semibold">{currentUser?.user}</span> 对节点 <span className="font-semibold text-red-500">"{nodeToDelete?.nodeName}"</span> 的权限吗？
                </p>
                <p className="text-gray-500 mt-2">
                  删除后该用户将无法在节点监控与隧道绑定中使用此节点。
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              size="sm"
              variant="light"
              onPress={onDeleteNodeModalClose}
            >
              取消
            </Button>
            <Button
              size="sm"
              color="danger"
              onPress={handleConfirmRemoveNode}
            >
              确认删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 重置流量确认对话框 */}
      <Modal hideCloseButton
        isOpen={isResetFlowModalOpen}
        onClose={onResetFlowModalClose}
        size="md"
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
            确认重置流量
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-50 dark:bg-orange-900/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 text-sm">
                <p className="text-gray-900 dark:text-gray-100">
                  确定要重置用户 <span className="font-semibold text-orange-500">"{userToReset?.user}"</span> 的流量吗？
                </p>
                <div className="mt-4 p-3 bg-orange-50 dark:bg-orange-900/10 rounded-lg text-xs border border-orange-100 dark:border-orange-900/20">
                  <div className="font-medium text-orange-800 dark:text-orange-300 mb-2">
                    当前使用统计：
                  </div>
                  <div className="space-y-1 text-orange-700 dark:text-orange-400">
                    <div className="flex justify-between">
                      <span>上行：</span>
                      <span className="font-mono">{userToReset ? formatFlow(userToReset.inFlow || 0) : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>下行：</span>
                      <span className="font-mono">{userToReset ? formatFlow(userToReset.outFlow || 0) : '-'}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-orange-200 dark:border-orange-800/30 pt-1 mt-1">
                      <span>总计：</span>
                      <span className="font-mono">
                        {userToReset ? formatFlow(calculateUserTotalUsedFlow(userToReset)) : '-'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button 
              size="sm"
              variant="light" 
              onPress={onResetFlowModalClose}
            >
              取消
            </Button>
            <Button 
              size="sm"
              color="warning" 
              onPress={handleConfirmResetFlow}
              isLoading={resetFlowLoading}
            >
              确认重置
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      </div>
    
  );
} 
