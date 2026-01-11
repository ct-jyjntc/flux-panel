package com.admin.common.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

@Data
public class TunnelDto {
    
    @NotBlank(message = "隧道名称不能为空")
    private String name;

    private Long inNodeId;

    private List<Long> inNodeIds;

    // 出口节点ID，当type=1时可以为空，会自动设置为入口节点ID
    private Long outNodeId;

    // 出口节点ID列表（多出口）
    private List<Long> outNodeIds;
    
    @NotNull(message = "隧道类型不能为空")
    private Integer type;
    
    private String interfaceName;
    
    // 协议类型（由出口节点决定）
    private String protocol;

    // 出口负载策略（fifo/round/random/hash）
    private String outStrategy;
    
    // TCP监听地址，默认为0.0.0.0
    private String tcpListenAddr = "0.0.0.0";
    
    // UDP监听地址，默认为0.0.0.0
    private String udpListenAddr = "0.0.0.0";

} 
