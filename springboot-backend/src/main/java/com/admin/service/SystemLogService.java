package com.admin.service;

import com.admin.common.dto.SystemLogQueryDto;
import com.admin.common.lang.R;
import com.admin.entity.SystemLog;
import com.baomidou.mybatisplus.extension.service.IService;

public interface SystemLogService extends IService<SystemLog> {

    R getLogList(SystemLogQueryDto queryDto);

    R clearAllLogs();

    void cleanExpiredLogs(long cutoffTime);
}
