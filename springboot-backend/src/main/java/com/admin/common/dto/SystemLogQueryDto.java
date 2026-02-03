package com.admin.common.dto;

import lombok.Data;

@Data
public class SystemLogQueryDto {
    private Integer current;
    private Integer size;
    private String logType;
    private Integer userId;
    private String keyword;
    private Long startTime;
    private Long endTime;
}
