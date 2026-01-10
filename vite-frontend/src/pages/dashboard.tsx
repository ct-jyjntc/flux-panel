import { useState, useEffect } from "react";
import toast from 'react-hot-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';


import { getUserPackageInfo } from "@/api";

interface UserInfo {
  flow: number;
  inFlow: number;
  outFlow: number;
  num: number;
  expTime?: string;
  flowResetTime?: number;
}

interface UserNode {
  id: number;
  nodeId: number;
  accessType: number;
  nodeName: string;
  ip: string;
  serverIp: string;
}

interface Forward {
  id: number;
  name: string;
  tunnelId: number;
  tunnelName: string;
  inIp: string;
  inPort: number;
  remoteAddr: string;
  inFlow: number;
  outFlow: number;
}

interface StatisticsFlow {
  id: number;
  userId: number;
  flow: number;
  totalFlow: number;
  time: string;
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [userInfo, setUserInfo] = useState<UserInfo>({} as UserInfo);
  const [userNodes, setUserNodes] = useState<UserNode[]>([]);
  const [forwardList, setForwardList] = useState<Forward[]>([]);
  const [statisticsFlows, setStatisticsFlows] = useState<StatisticsFlow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // 检查有效期通知
  const checkExpirationNotifications = (userInfo: UserInfo) => {
    const notificationKey = `expiration-${userInfo.expTime}`;
    const lastNotified = localStorage.getItem('lastNotified');
    
    if (lastNotified === notificationKey) {
      return; // 已经通知过，不重复显示
    }
    
    let hasNotification = false;
    
    // 检查主账户有效期
    if (userInfo.expTime) {
      const expDate = new Date(userInfo.expTime);
      const now = new Date();
      
      if (!isNaN(expDate.getTime()) && expDate > now) {
        const diffTime = expDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 7 && diffDays > 0) {
          hasNotification = true;
          if (diffDays === 1) {
            toast('账户将于明天过期，请及时续费', { 
              icon: '⚠️',
              duration: 6000,
              style: { background: '#f59e0b', color: '#fff' }
            });
          } else {
            toast(`账户将于${diffDays}天后过期，请及时续费`, { 
              icon: '⚠️',
              duration: 6000,
              style: { background: '#f59e0b', color: '#fff' }
            });
          }
        } else if (diffDays <= 0) {
          hasNotification = true;
          toast('账户已过期，请立即续费', { 
            icon: '⚠️',
            duration: 8000,
            style: { background: '#ef4444', color: '#fff' }
          });
        }
      }
    }
    
    // 如果显示了通知，记录防止重复
    if (hasNotification) {
      localStorage.setItem('lastNotified', notificationKey);
    }
  };

  useEffect(() => {
    // 重置状态并加载数据，防止页面切换时显示旧数据
    setLoading(true);
    setUserInfo({} as UserInfo);
    setUserNodes([]);
    setForwardList([]);
    setStatisticsFlows([]);
    
    // 检查用户是否是管理员
    const adminStatus = localStorage.getItem('admin');
    setIsAdmin(adminStatus === 'true');
    
    loadPackageData();
    localStorage.setItem('e', '/dashboard');
  }, []);

  const loadPackageData = async () => {
    setLoading(true);
    try {
      const res = await getUserPackageInfo();
      if (res.code === 0) {
        const data = res.data;
        setUserInfo(data.userInfo || {});
        setUserNodes(data.nodePermissions || []);
        setForwardList(data.forwards || []);
        setStatisticsFlows(data.statisticsFlows || []);
        
        // 检查有效期并显示通知
        checkExpirationNotifications(data.userInfo || {});
      } else {
        toast.error(res.msg || '获取套餐信息失败');
      }
    } catch (error) {
      console.error('获取套餐信息失败:', error);
      toast.error('获取套餐信息失败');
    } finally {
      setLoading(false);
    }
  };

  const formatFlow = (value: number, unit: string = 'bytes'): string => {
    // 99999 表示无限制
    if (value === 99999) {
      return '无限制';
    }
    
    if (unit === 'gb') {
      return value + ' GB';
    } else {
      if (value === 0) return '0 B';
      if (value < 1024) return value + ' B';
      if (value < 1024 * 1024) return (value / 1024).toFixed(2) + ' KB';
      if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(2) + ' MB';
      return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
  };

  const formatNumber = (value: number): string => {
    // 99999 表示无限制
    if (value === 99999) {
      return '无限制';
    }
    return value.toString();
  };

  // 处理24小时流量统计数据
  const processFlowChartData = () => {
    // 生成最近24小时的时间数组（从当前小时往前推24小时）
    const now = new Date();
    const hours: string[] = [];
    for (let i = 23; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourString = time.getHours().toString().padStart(2, '0') + ':00';
      hours.push(hourString);
    }

    // 创建数据映射
    const flowMap = new Map<string, number>();
    statisticsFlows.forEach(item => {
      flowMap.set(item.time, item.flow || 0);
    });

    // 生成图表数据，没有数据的小时显示为0
    return hours.map(hour => ({
      time: hour,
      flow: flowMap.get(hour) || 0,
      // 格式化显示用的流量值
      formattedFlow: formatFlow(flowMap.get(hour) || 0)
    }));
  };


  const calculateUserTotalUsedFlow = (): number => {
    // 后端已按计费类型处理流量，前端直接使用入站+出站总和
    return (userInfo.inFlow || 0) + (userInfo.outFlow || 0);
  };

  const calculateUsagePercentage = (type: 'flow' | 'forwards'): number => {
    if (type === 'flow') {
      const totalUsed = calculateUserTotalUsedFlow();
      const totalLimit = (userInfo.flow || 0) * 1024 * 1024 * 1024;
      // 无限制时返回0%
      if (userInfo.flow === 99999) return 0;
      return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
    } else if (type === 'forwards') {
      const totalUsed = forwardList.length;
      const totalLimit = userInfo.num || 0;
      // 无限制时返回0%
      if (userInfo.num === 99999) return 0;
      return totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
    }
    return 0;
  };

  const getUsageColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500 dark:bg-red-600';
    if (percentage >= 70) return 'bg-orange-500 dark:bg-orange-600';
    return 'bg-blue-500 dark:bg-blue-600';
  };

  const renderProgressBar = (percentage: number, size: 'sm' | 'md' = 'md', isUnlimited: boolean = false) => {
    const height = size === 'sm' ? 'h-1.5' : 'h-2';
    
    if (isUnlimited) {
      return (
        <div className="w-full">
          <div className={`w-full bg-gradient-to-r from-blue-200 to-purple-200 dark:from-blue-500/30 dark:to-purple-500/30 rounded-full ${height}`}>
            <div className={`${height} bg-gradient-to-r from-blue-500 to-purple-500 rounded-full w-full opacity-60`}></div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="w-full">
        <div className={`w-full bg-gray-100 dark:bg-zinc-800 rounded-full ${height}`}>
          <div 
            className={`${height} rounded-full transition-all duration-300 ${getUsageColor(percentage)}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
      </div>
    );
  };

  const formatResetTime = (resetDay?: number): string => {
    if (resetDay === undefined || resetDay === null) return '';
    if (resetDay === 0) return '不重置';
    
    const now = new Date();
    const currentDay = now.getDate();
    
    let daysUntilReset;
    if (resetDay > currentDay) {
      daysUntilReset = resetDay - currentDay;
    } else if (resetDay < currentDay) {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, resetDay);
      const diffTime = nextMonth.getTime() - now.getTime();
      daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } else {
      daysUntilReset = 0;
    }
    
    if (daysUntilReset === 0) {
      return '今日重置';
    } else if (daysUntilReset === 1) {
      return '明日重置';
    } else {
      return `${daysUntilReset}天后重置`;
    }
  };

  if (loading) {
    return (
      <div className="px-4 lg:px-6 flex-grow pt-4">
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3">
            <div className="animate-spin h-5 w-5 border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 rounded-full"></div>
            <span className="text-gray-600 dark:text-gray-400">正在加载数据...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 响应式统计列表 */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-zinc-800 mb-6 lg:mb-8">
        <div className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">用户名</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{userInfo.num === 99999 ? '管理员' : '普通用户'}</p>
            </div>
            <div className="w-10 h-10 bg-gray-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总流量</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{formatFlow(userInfo.flow, 'gb')}</p>
            </div>
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 dark:text-gray-400">已用流量</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{formatFlow(calculateUserTotalUsedFlow())}</p>
              <div className="mt-2">
                {renderProgressBar(calculateUsagePercentage('flow'), 'sm', userInfo.flow === 99999)}
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs text-gray-500">
                    {userInfo.flow === 99999 ? '无限制' : `${calculateUsagePercentage('flow').toFixed(1)}%`}
                  </p>
                  {(userInfo.flowResetTime !== undefined && userInfo.flowResetTime !== null) && (
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                      </svg>
                      <span className="truncate">{formatResetTime(userInfo.flowResetTime)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">转发配额</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{formatNumber(userInfo.num || 0)}</p>
            </div>
            <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 dark:text-gray-400">已用转发</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{forwardList.length}</p>
              <div className="mt-2">
                {renderProgressBar(calculateUsagePercentage('forwards'), 'sm', userInfo.num === 99999)}
                <p className="text-xs text-gray-500 mt-1.5 truncate">
                  {userInfo.num === 99999 ? '无限制' : `${calculateUsagePercentage('forwards').toFixed(1)}%`}
                </p>
              </div>
            </div>
            <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* 24小时流量统计图表 */}
      <div className="mb-6 lg:mb-8 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
              <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">24小时流量统计</h2>
          </div>
        </div>
        <div className="p-6">
          {statisticsFlows.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-200 dark:text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400">暂无流量统计数据</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-64 lg:h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={processFlowChartData()}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" className="dark:stroke-zinc-800" />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis 
                      tick={{ fontSize: 12, fill: '#6B7280' }}
                      tickLine={false}
                      axisLine={false}
                      dx={-10}
                      tickFormatter={(value) => {
                        if (value === 0) return '0';
                        if (value < 1024) return `${value}B`;
                        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}K`;
                        if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}M`;
                        return `${(value / (1024 * 1024 * 1024)).toFixed(1)}G`;
                      }}
                    />
                    <Tooltip 
                      content={({ active, payload, label }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700/50 rounded-xl shadow-lg p-3">
                              <p className="font-medium text-gray-900 dark:text-white mb-1">{`时间: ${label}`}</p>
                              <p className="text-primary text-sm">
                                {`流量: ${formatFlow(payload[0]?.value as number || 0)}`}
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="flow"
                      stroke="#8b5cf6"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 4, stroke: '#8b5cf6', strokeWidth: 2, fill: '#fff' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 节点权限 - 管理员不显示 */}
      {!isAdmin && (
        <div className="mb-6 lg:mb-8 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">节点权限</h2>
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 rounded-full text-xs">
                {userNodes.length}
              </span>
            </div>
          </div>
          
          {userNodes.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-200 dark:text-zinc-700 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400">暂无节点权限</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {userNodes.map((node) => (
                <div key={node.id} className="p-4 lg:p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{node.nodeName}</h3>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex flex-col sm:flex-row sm:gap-6 gap-2">
                    <div className="flex items-center gap-1">
                      <span className="opacity-70">入口IP：</span>
                      <span className="font-mono bg-gray-50 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-gray-100 dark:border-zinc-700/50">{node.ip}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="opacity-70">服务器IP：</span>
                      <span className="font-mono bg-gray-50 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-gray-100 dark:border-zinc-700/50">{node.serverIp}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
