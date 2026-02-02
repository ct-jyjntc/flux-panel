package com.admin.common.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import java.util.List;

@Data
public class BatchUserNodeDto {

    @NotEmpty(message = "用户ID列表不能为空")
    private List<Integer> userIds;

    @NotNull(message = "节点ID不能为空")
    private Long nodeId;

    @Min(value = 0, message = "节点权限类型不合法")
    @Max(value = 2, message = "节点权限类型不合法")
    private Integer accessType;
}
