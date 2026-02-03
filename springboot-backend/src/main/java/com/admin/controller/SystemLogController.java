package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.annotation.RequireRole;
import com.admin.common.dto.SystemLogQueryDto;
import com.admin.common.lang.R;
import com.admin.service.SystemLogService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin
@RequestMapping("/api/v1/log")
public class SystemLogController {

    @Autowired
    private SystemLogService systemLogService;

    @LogAnnotation
    @RequireRole
    @PostMapping("/list")
    public R list(@Validated @RequestBody(required = false) SystemLogQueryDto queryDto) {
        return systemLogService.getLogList(queryDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/clear")
    public R clear() {
        return systemLogService.clearAllLogs();
    }
}
