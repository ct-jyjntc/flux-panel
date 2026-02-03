package com.admin.common.task;

import com.admin.service.SystemLogService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
@Slf4j
public class SystemLogCleanupTask {

    private final SystemLogService systemLogService;

    public SystemLogCleanupTask(SystemLogService systemLogService) {
        this.systemLogService = systemLogService;
    }

    @Scheduled(cron = "0 10 3 * * ?")
    public void cleanup() {
        long cutoffTime = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(30);
        systemLogService.cleanExpiredLogs(cutoffTime);
    }
}
