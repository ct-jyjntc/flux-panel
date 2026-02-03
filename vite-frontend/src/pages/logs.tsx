import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import toast from "react-hot-toast";

import { clearLogs, getAllUsers, getLogList } from "@/api";
import { isAdmin } from "@/utils/auth";
import { SearchIcon } from "@/components/icons";
import { User } from "@/types";

interface SystemLog {
  id: number;
  logType: "OPERATION" | "EXCEPTION";
  userId?: number | null;
  userName?: string | null;
  ip?: string | null;
  requestMethod?: string | null;
  requestUri?: string | null;
  controllerMethod?: string | null;
  requestParams?: string | null;
  responseCode?: number | null;
  responseMsg?: string | null;
  exceptionMsg?: string | null;
  createdTime: number;
}

const formatDateTime = (timestamp?: number | null) => {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleString();
};

export default function LogsPage() {
  const isAdminUser = isAdmin();
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [logType, setLogType] = useState<"OPERATION" | "EXCEPTION">("OPERATION");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [clearLoading, setClearLoading] = useState(false);

  const userFilterItems = useMemo(() => {
    return [
      { id: "all", name: "全部用户" },
      ...users.map((user) => ({
        id: user.id.toString(),
        name: (user.name && user.name.trim()) || user.user || `用户${user.id}`,
      })),
    ];
  }, [users]);

  useEffect(() => {
    if (!isAdminUser) return;
    (async () => {
      try {
        const res = await getAllUsers();
        if (res.code === 0) {
          setUsers(res.data || []);
        }
      } catch (error) {
        console.warn("获取用户列表失败");
      }
    })();
  }, [isAdminUser]);

  useEffect(() => {
    setCurrentPage(1);
  }, [logType, searchKeyword, filterUserId, pageSize]);

  useEffect(() => {
    if (!isAdminUser) return;
    loadLogs();
  }, [currentPage, pageSize, logType, searchKeyword, filterUserId, isAdminUser]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const userId = filterUserId === "all" ? null : Number(filterUserId);
      const res = await getLogList({
        current: currentPage,
        size: pageSize,
        logType,
        keyword: searchKeyword.trim(),
        userId: Number.isNaN(userId) ? null : userId,
      });
      if (res.code === 0) {
        const data = res.data || {};
        setLogs(data.records || []);
        setTotal(data.total || 0);
      } else {
        toast.error(res.msg || "获取日志失败");
      }
    } catch (error) {
      toast.error("获取日志失败");
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    const confirmed = window.confirm("确认清空全部日志？此操作不可恢复。");
    if (!confirmed) return;
    setClearLoading(true);
    try {
      const res = await clearLogs();
      if (res.code === 0) {
        toast.success(res.msg || "日志已清空");
        setLogs([]);
        setTotal(0);
        setCurrentPage(1);
      } else {
        toast.error(res.msg || "清空日志失败");
      }
    } catch (error) {
      toast.error("清空日志失败");
    } finally {
      setClearLoading(false);
    }
  };

  if (!isAdminUser) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        暂无权限查看日志
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  const renderResult = (log: SystemLog) => {
    if (log.logType === "EXCEPTION") {
      return log.exceptionMsg || "异常";
    }
    const code = log.responseCode !== null && log.responseCode !== undefined ? log.responseCode : "-";
    const msg = log.responseMsg || "";
    return `${code} ${msg}`.trim();
  };

  return (
    <div className="flex flex-col gap-6 md-enter">
      <div className="md-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm mb-4 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              color={logType === "OPERATION" ? "primary" : "default"}
              variant={logType === "OPERATION" ? "solid" : "bordered"}
              onPress={() => setLogType("OPERATION")}
            >
              操作日志
            </Button>
            <Button
              size="sm"
              color={logType === "EXCEPTION" ? "primary" : "default"}
              variant={logType === "EXCEPTION" ? "solid" : "bordered"}
              onPress={() => setLogType("EXCEPTION")}
            >
              异常日志
            </Button>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>仅保留最近 30 天</span>
            <Button
              size="sm"
              color="danger"
              variant="bordered"
              onPress={handleClearLogs}
              isLoading={clearLoading}
            >
              全部清理
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 w-full md:w-auto flex-wrap md:flex-nowrap">
            <Input
              size="sm"
              placeholder="关键词/接口"
              startContent={<SearchIcon size={16} />}
              className="w-full min-w-[160px] md:w-[200px]"
              isClearable
              value={searchKeyword}
              onValueChange={(value) => setSearchKeyword(value)}
              classNames={{
                inputWrapper: "bg-white dark:bg-zinc-800 border-none shadow-none",
              }}
            />
            <Select
              size="sm"
              className="w-full min-w-[160px] md:w-[200px]"
              selectedKeys={[filterUserId]}
              onSelectionChange={(keys) => {
                const selectedKey = Array.from(keys)[0] as string;
                if (selectedKey) {
                  setFilterUserId(selectedKey);
                }
              }}
              items={userFilterItems}
              classNames={{
                trigger: "bg-white dark:bg-zinc-800 border-none shadow-none",
                value: "text-sm",
              }}
            >
              {(item) => (
                <SelectItem key={item.id} textValue={item.name}>
                  {item.name}
                </SelectItem>
              )}
            </Select>
            <Button size="sm" variant="light" isIconOnly onPress={loadLogs} title="刷新">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </Button>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-xs text-gray-400">共 {total} 条</div>
            <Select
              size="sm"
              className="w-[110px]"
              selectedKeys={[pageSize.toString()]}
              onSelectionChange={(keys) => {
                const selectedKey = Array.from(keys)[0] as string;
                if (selectedKey) {
                  const nextSize = Number(selectedKey);
                  if (!Number.isNaN(nextSize)) {
                    setPageSize(nextSize);
                  }
                }
              }}
              classNames={{
                trigger: "bg-white dark:bg-zinc-800 border-none shadow-none",
                value: "text-sm",
              }}
            >
              {[10, 20, 50, 100].map((size) => (
                <SelectItem key={size.toString()} textValue={size.toString()}>
                  {size} / 页
                </SelectItem>
              ))}
            </Select>
            <div className="flex gap-1 items-center">
              <button
                className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-300 dark:hover:bg-zinc-800"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeCurrentPage <= 1}
              >
                &lt;
              </button>
              <span className="text-xs text-gray-500 px-2">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-gray-700 dark:text-gray-300 dark:hover:bg-zinc-800"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={safeCurrentPage >= totalPages}
              >
                &gt;
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="md-card overflow-hidden min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Spinner size="lg" color="primary" />
              <span className="text-gray-500 text-sm">正在加载日志...</span>
            </div>
          </div>
        ) : logs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm md-table">
              <thead className="bg-gray-50 dark:bg-zinc-800/50 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                <tr>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">请求</th>
                  <th className="px-4 py-3">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3 align-middle text-xs text-gray-500">
                      {formatDateTime(log.createdTime)}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {log.userName || (log.userId ? `用户${log.userId}` : "未知")}
                        </span>
                        {log.userId && <span className="text-xs text-gray-400">#{log.userId}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-gray-500">
                      {log.ip || "-"}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {log.requestMethod} {log.requestUri}
                        </span>
                        <span
                          className="text-xs text-gray-400 truncate max-w-[260px]"
                          title={log.requestParams || ""}
                        >
                          {log.requestParams || "-"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-xs text-gray-600 dark:text-gray-300">
                      {renderResult(log)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <p>暂无日志记录</p>
          </div>
        )}
      </div>
    </div>
  );
}
