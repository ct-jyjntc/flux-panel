package com.admin.service.impl;

import cn.hutool.core.util.StrUtil;
import com.admin.common.dto.SystemLogQueryDto;
import com.admin.common.lang.R;
import com.admin.entity.SystemLog;
import com.admin.mapper.SystemLogMapper;
import com.admin.service.SystemLogService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;

@Service
@Slf4j
public class SystemLogServiceImpl extends ServiceImpl<SystemLogMapper, SystemLog> implements SystemLogService {

    @Override
    public R getLogList(SystemLogQueryDto queryDto) {
        int current = queryDto != null && queryDto.getCurrent() != null && queryDto.getCurrent() > 0
                ? queryDto.getCurrent() : 1;
        int size = queryDto != null && queryDto.getSize() != null && queryDto.getSize() > 0
                ? queryDto.getSize() : 20;

        QueryWrapper<SystemLog> queryWrapper = new QueryWrapper<>();
        if (queryDto != null) {
            if (StrUtil.isNotBlank(queryDto.getLogType())) {
                queryWrapper.eq("log_type", queryDto.getLogType());
            }
            if (queryDto.getUserId() != null) {
                queryWrapper.eq("user_id", queryDto.getUserId());
            }
            if (StrUtil.isNotBlank(queryDto.getKeyword())) {
                String keyword = queryDto.getKeyword().trim();
                queryWrapper.and(wrapper -> wrapper
                        .like("request_uri", keyword)
                        .or()
                        .like("controller_method", keyword)
                        .or()
                        .like("request_params", keyword)
                        .or()
                        .like("response_msg", keyword)
                        .or()
                        .like("exception_msg", keyword));
            }
            if (queryDto.getStartTime() != null) {
                queryWrapper.ge("created_time", queryDto.getStartTime());
            }
            if (queryDto.getEndTime() != null) {
                queryWrapper.le("created_time", queryDto.getEndTime());
            }
        }

        queryWrapper.orderByDesc("created_time");
        Page<SystemLog> page = this.page(new Page<>(current, size), queryWrapper);

        Map<String, Object> data = new HashMap<>();
        data.put("records", page.getRecords());
        data.put("total", page.getTotal());
        data.put("current", page.getCurrent());
        data.put("size", page.getSize());

        return R.ok(data);
    }

    @Override
    public R clearAllLogs() {
        try {
            baseMapper.truncate();
            return R.ok("日志已清空");
        } catch (Exception e) {
            log.warn("清空日志失败: {}", e.getMessage());
            return R.err("清空日志失败");
        }
    }

    @Override
    public void cleanExpiredLogs(long cutoffTime) {
        try {
            QueryWrapper<SystemLog> queryWrapper = new QueryWrapper<>();
            queryWrapper.lt("created_time", cutoffTime);
            boolean removed = this.remove(queryWrapper);
            if (removed) {
                log.info("清理日志完成，清理时间阈值: {}", cutoffTime);
            }
        } catch (Exception e) {
            log.warn("清理日志失败: {}", e.getMessage());
        }
    }
}
