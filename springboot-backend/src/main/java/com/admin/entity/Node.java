package com.admin.entity;

import java.io.Serializable;
import java.math.BigDecimal;
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

    private Long ownerId;

    private BigDecimal trafficRatio;

    private Integer http;

    private Integer tls;

    private Integer socks;

}
