package com.admin.common.dto;

import lombok.Data;

import java.math.BigDecimal;

@Data
public class UserNodeWithDetailDto {

    private Integer id;
    private Integer userId;
    private Long nodeId;
    private Integer accessType;
    private String nodeName;
    private String ip;
    private String serverIp;
    private BigDecimal trafficRatio;
    private Long ownerId;
}
