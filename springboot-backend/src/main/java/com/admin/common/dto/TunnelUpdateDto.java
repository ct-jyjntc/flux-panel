package com.admin.common.dto;

import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

@Data
public class TunnelUpdateDto {
    
    @NotNull(message = "隧道ID不能为空")
    private Long id;
    
    @NotBlank(message = "隧道名称不能为空")
    private String name;
    
    private Long inNodeId;

    private List<Long> inNodeIds;

    private Long outNodeId;

    private List<Long> outNodeIds;
    
    // 协议类型（由出口节点决定）
    private String protocol;

    // TCP监听地址
    @NotBlank
    private String tcpListenAddr;
    
    // UDP监听地址
    @NotBlank
    private String udpListenAddr;

    @TableField(updateStrategy = FieldStrategy.IGNORED)
    private String interfaceName;

    private String outStrategy;
} 
