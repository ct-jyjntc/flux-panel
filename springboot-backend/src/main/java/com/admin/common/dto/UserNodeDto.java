package com.admin.common.dto;

import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class UserNodeDto {

    @NotNull(message = "用户ID不能为空")
    private Integer userId;

    @NotNull(message = "节点ID不能为空")
    private Long nodeId;
}
