package com.admin.entity;

import java.io.Serializable;
import java.math.BigDecimal;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
@Data
@EqualsAndHashCode(callSuper = true)
public class Node extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private String name;

    private String secret;

    private String ip;

    private String serverIp;

    private String version;

    private Integer portSta;

    private Integer portEnd;

    private Integer outPort;

    @TableField("tunnel_protocol")
    private String tunnelProtocol;

    private Long ownerId;

    private BigDecimal trafficRatio;

    @TableField(exist = false)
    private Integer accessType;

    private Integer http;

    private Integer tls;

    private Integer socks;

}
