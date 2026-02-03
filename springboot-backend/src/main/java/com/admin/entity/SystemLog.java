package com.admin.entity;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 系统日志（操作/异常）
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class SystemLog extends BaseEntity {

    private static final long serialVersionUID = 1L;

    /**
     * 日志类型（OPERATION/EXCEPTION）
     */
    private String logType;

    private Integer userId;

    private String userName;

    private String ip;

    private String requestMethod;

    private String requestUri;

    private String controllerMethod;

    private String requestParams;

    private Integer responseCode;

    private String responseMsg;

    private String exceptionMsg;
}
