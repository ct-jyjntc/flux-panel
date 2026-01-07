import { useState, useEffect } from 'react';
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { 
  Table, 
  TableHeader, 
  TableColumn, 
  TableBody, 
  TableRow, 
  TableCell 
} from "@heroui/table";
import { 
  Modal, 
  ModalContent, 
  ModalHeader, 
  ModalBody, 
  ModalFooter,
  useDisclosure 
} from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { RadioGroup, Radio } from "@heroui/radio";
import { DatePicker } from "@heroui/date-picker";
import { Spinner } from "@heroui/spinner";
import { Progress } from "@heroui/progress";

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
import { SearchIcon, EditIcon, DeleteIcon, SettingsIcon } from '@/components/icons';
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
  const [nodeListLoading, setNodeListLoading] = useState(false);

  // 分配新节点权限相关状态
  const [nodeForm, setNodeForm] = useState<UserNodeForm>({
    nodeId: null
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
    setNodeListLoading(true);
    try {
      const response = await getUserNodeList({ userId });
      if (response.code === 0) {
        setUserNodes(response.data || []);
      } else {
        toast.error(response.msg || '获取节点权限列表失败');
      }
    } catch (error) {
      toast.error('获取节点权限列表失败');
    } finally {
      setNodeListLoading(false);
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
    setNodeForm({ nodeId: null });
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
        nodeId: nodeForm.nodeId
      });

      if (response.code === 0) {
        toast.success('分配成功');
        setNodeForm({ nodeId: null });
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
    
      <div className="px-4 lg:px-6 py-6">
      {/* 页面头部 */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <Input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索用户名"
              startContent={<SearchIcon className="w-4 h-4 text-default-400" />}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              size="sm"
              className="flex-1"
              classNames={{
                base: "bg-default-100",
                input: "bg-transparent",
                inputWrapper: "bg-default-100 border border-default-200 hover:border-default-300 focus-within:border-primary data-[hover=true]:border-default-300"
              }}
            />
            <Button
              onClick={handleSearch}
              variant="solid"
              color="primary"
              isIconOnly
              size="sm"
            >
              <SearchIcon className="w-4 h-4" />
            </Button>
          </div>
          
            <Button
              size="sm"
              variant="flat"
              color="primary"
              onPress={handleAdd}
            >
              新增
            </Button>
        </div>
      </div>

      {/* 用户列表 */}
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
            aria-label="用户列表"
            classNames={{
              th: "bg-default-50 text-default-600 text-xs",
              td: "py-3 align-top",
            }}
          >
            <TableHeader>
              <TableColumn>用户</TableColumn>
              <TableColumn>状态</TableColumn>
              <TableColumn>流量</TableColumn>
              <TableColumn>转发数量</TableColumn>
              <TableColumn>重置时间</TableColumn>
              <TableColumn>到期时间</TableColumn>
              <TableColumn className="text-right">操作</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={
                <div className="text-default-500 text-sm py-8">
                  暂无用户数据，点击上方按钮开始创建
                </div>
              }
            >
              {users.map((user) => {
                const userStatus = getUserStatus(user);
                const expStatus = user.expTime ? getExpireStatus(user.expTime) : null;
                const usedFlow = calculateUserTotalUsedFlow(user);
                const flowPercent = user.flow > 0 ? Math.min((usedFlow / (user.flow * 1024 * 1024 * 1024)) * 100, 100) : 0;

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {user.name || user.user}
                        </div>
                        <div className="text-xs text-default-500 truncate">@{user.user}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip color={userStatus.color} variant="flat" size="sm" className="text-xs">
                        {userStatus.text}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 min-w-[180px]">
                        <div className="flex items-center justify-between text-xs text-default-500">
                          <span>限制</span>
                          <span className="text-foreground">{formatFlow(user.flow, 'gb')}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-default-500">已用</span>
                          <span className="text-danger">{formatFlow(usedFlow)}</span>
                        </div>
                        <Progress
                          size="sm"
                          value={flowPercent}
                          color={flowPercent > 90 ? 'danger' : flowPercent > 70 ? 'warning' : 'success'}
                          aria-label={`流量使用 ${flowPercent.toFixed(1)}%`}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium text-foreground">{user.num}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-default-600">
                        {user.flowResetTime === 0 ? '不重置' : `每月${user.flowResetTime}号`}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.expTime ? (
                        expStatus && expStatus.color === 'success' ? (
                          <span className="text-xs text-default-600">{formatDate(user.expTime)}</span>
                        ) : (
                          <Chip
                            color={expStatus?.color || 'default'}
                            variant="flat"
                            size="sm"
                            className="text-xs"
                          >
                            {expStatus?.text || '未知状态'}
                          </Chip>
                        )
                      ) : (
                        <span className="text-xs text-default-400">不限制</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="flat"
                          color="primary"
                          onPress={() => handleEdit(user)}
                          startContent={<EditIcon className="w-3 h-3" />}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="warning"
                          onPress={() => handleResetFlow(user)}
                          startContent={
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                          }
                        >
                          重置
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="success"
                          onPress={() => handleManageNodes(user)}
                          startContent={<SettingsIcon className="w-3 h-3" />}
                        >
                          节点权限
                        </Button>
                        <Button
                          size="sm"
                          variant="flat"
                          color="danger"
                          onPress={() => handleDelete(user)}
                          startContent={<DeleteIcon className="w-3 h-3" />}
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
      )}


      {/* 用户表单模态框 */}
      <Modal
        isOpen={isUserModalOpen}
        onClose={onUserModalClose}
        size="2xl"
      scrollBehavior="outside"
      backdrop="blur"
      placement="center"
      >
        <ModalContent>
          <ModalHeader>
            {isEdit ? '编辑用户' : '新增用户'}
          </ModalHeader>
          <ModalBody>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="用户名"
                value={userForm.user}
                onChange={(e) => setUserForm(prev => ({ ...prev, user: e.target.value }))}
                isRequired
              />
              <Input
                label="密码"
                type="password"
                value={userForm.pwd}
                onChange={(e) => setUserForm(prev => ({ ...prev, pwd: e.target.value }))}
                placeholder={isEdit ? '留空则不修改密码' : '请输入密码'}
                isRequired={!isEdit}
              />
              <Input
                label="流量限制(GB)"
                type="number"
                value={userForm.flow.toString()}
                onChange={(e) => {
                  const value = Math.min(Math.max(Number(e.target.value) || 0, 1), 99999);
                  setUserForm(prev => ({ ...prev, flow: value }));
                }}
                min="1"
                max="99999"
                isRequired
              />
              <Input
                label="转发数量"
                type="number"
                value={userForm.num.toString()}
                onChange={(e) => {
                  const value = Math.min(Math.max(Number(e.target.value) || 0, 1), 99999);
                  setUserForm(prev => ({ ...prev, num: value }));
                }}
                min="1"
                max="99999"
                isRequired
              />
              <Select
                label="允许创建节点"
                selectedKeys={[userForm.allowNodeCreate.toString()]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, allowNodeCreate: Number(value) }));
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
                selectedKeys={userForm.speedId ? [userForm.speedId.toString()] : ["null"]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, speedId: value === "null" ? null : Number(value) }));
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
                selectedKeys={[userForm.flowResetTime.toString()]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as string;
                  setUserForm(prev => ({ ...prev, flowResetTime: Number(value) }));
                }}
              >
                <>
                  <SelectItem key="0" textValue="不重置">
                    不重置
                  </SelectItem>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <SelectItem key={day.toString()} textValue={`每月${day}号（0点重置）`}>
                    每月{day}号（0点重置）
                  </SelectItem>
                ))}
                </>
              </Select>
              <DatePicker
                label="过期时间"
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
              />
            </div>
            
            <RadioGroup
              label="状态"
              value={userForm.status.toString()}
              onValueChange={(value: string) => setUserForm(prev => ({ ...prev, status: Number(value) }))}
              orientation="horizontal"
            >
              <Radio value="1">正常</Radio>
              <Radio value="0">禁用</Radio>
            </RadioGroup>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" onPress={onUserModalClose}>
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
      <Modal
        isOpen={isNodeModalOpen}
        onClose={onNodeModalClose}
        size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
        isDismissable={false}
        classNames={{
          base: "max-w-[95vw] sm:max-w-4xl"
        }}
      >
        <ModalContent>
          <ModalHeader>
            用户 {currentUser?.user} 的节点权限
          </ModalHeader>
          <ModalBody>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">分配节点</h3>
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <Select
                    label="选择节点"
                    selectedKeys={nodeForm.nodeId ? [nodeForm.nodeId.toString()] : []}
                    onSelectionChange={(keys) => {
                      const value = Array.from(keys)[0] as string;
                      setNodeForm({ nodeId: Number(value) || null });
                    }}
                    className="flex-1"
                  >
                    {availableNodes.map((node) => (
                      <SelectItem key={node.id.toString()} textValue={node.name}>
                        {node.name} ({node.ip})
                      </SelectItem>
                    ))}
                  </Select>
                  <Button
                    color="primary"
                    onPress={handleAssignNode}
                    isLoading={assignLoading}
                  >
                    分配
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-4">已有节点权限</h3>
                <Table
                  aria-label="用户节点权限列表"
                  classNames={{
                    wrapper: "shadow-none",
                    th: "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium"
                  }}
                >
                  <TableHeader>
                    <TableColumn>节点名称</TableColumn>
                    <TableColumn>入口IP</TableColumn>
                    <TableColumn>服务器IP</TableColumn>
                    <TableColumn className="text-right">操作</TableColumn>
                  </TableHeader>
                  <TableBody
                    items={userNodes}
                    isLoading={nodeListLoading}
                    loadingContent={<Spinner />}
                    emptyContent="暂无节点权限"
                  >
                    {(userNode) => (
                      <TableRow key={userNode.id}>
                        <TableCell>{userNode.nodeName}</TableCell>
                        <TableCell>{userNode.ip}</TableCell>
                        <TableCell>{userNode.serverIp}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="flat"
                              color="danger"
                              isIconOnly
                              onClick={() => handleRemoveNode(userNode)}
                            >
                              <DeleteIcon className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" onPress={onNodeModalClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除确认对话框 */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={onDeleteModalClose}
        size="2xl"
      scrollBehavior="outside"
      backdrop="blur"
      placement="center"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认删除用户
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要删除用户 <span className="font-semibold text-danger">"{userToDelete?.user}"</span> 吗？
                </p>
                <p className="text-small text-default-500 mt-1">
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
      <Modal
        isOpen={isDeleteNodeModalOpen}
        onClose={onDeleteNodeModalClose}
        size="2xl"
        scrollBehavior="outside"
        backdrop="blur"
        placement="center"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认删除节点权限
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-danger-100 rounded-full flex items-center justify-center">
                <DeleteIcon className="w-6 h-6 text-danger" />
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要删除用户 <span className="font-semibold">{currentUser?.user}</span> 对节点 <span className="font-semibold text-danger">"{nodeToDelete?.nodeName}"</span> 的权限吗？
                </p>
                <p className="text-small text-default-500 mt-1">
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
      <Modal
        isOpen={isResetFlowModalOpen}
        onClose={onResetFlowModalClose}
        size="2xl"
      scrollBehavior="outside"
      backdrop="blur"
      placement="center"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            确认重置流量
          </ModalHeader>
          <ModalBody>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-warning-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-warning" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-foreground">
                  确定要重置用户 <span className="font-semibold text-warning">"{userToReset?.user}"</span> 的流量吗？
                </p>
                <p className="text-small text-default-500 mt-1">
                  该操作只会重置账号流量，不影响节点权限设置，重置后该用户的上下行流量将归零，此操作不可撤销。
                </p>
                <div className="mt-2 p-2 bg-warning-50 dark:bg-warning-100/10 rounded text-xs">
                  <div className="text-warning-700 dark:text-warning-300">
                    当前流量使用情况：
                  </div>
                  <div className="mt-1 space-y-1">
                    <div className="flex justify-between">
                      <span>上行流量：</span>
                      <span className="font-mono">{userToReset ? formatFlow(userToReset.inFlow || 0) : '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>下行流量：</span>
                      <span className="font-mono">{userToReset ? formatFlow(userToReset.outFlow || 0) : '-'}</span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>总计：</span>
                      <span className="font-mono text-warning-700 dark:text-warning-300">
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
