package com.admin.common.task;

import com.admin.common.dto.*;
import com.admin.common.utils.GostUtil;
import com.admin.entity.*;
import com.admin.service.*;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

@Slf4j
@Service
public class CheckGostConfigAsync {

    @Resource
    private NodeService nodeService;

    @Resource
    @Lazy
    private ForwardService forwardService;

    @Resource
    @Lazy
    private SpeedLimitService speedLimitService;



    /**
     * 清理孤立的Gost配置项
     */
    @Async
    public void cleanNodeConfigs(String node_id, GostConfigDto gostConfig) {
        System.out.println(JSONObject.toJSONString(gostConfig));
        Node node = nodeService.getById(node_id);
        if (node != null) {
            cleanOrphanedServices(gostConfig, node);
            cleanOrphanedChains(gostConfig, node);
            cleanOrphanedLimiters(gostConfig, node);
        }
    }

    /**
     * 清理孤立的服务
     */
    private void cleanOrphanedServices(GostConfigDto gostConfig, Node node) {
        if (gostConfig.getServices() == null) {
            return;
        }

        for (ConfigItem service : gostConfig.getServices()) {
            safeExecute(() -> {
                if (Objects.equals(service.getName(), "web_api")) {
                    return;
                }
                Optional<ServiceIdentity> identityOpt = parseServiceIdentity(service.getName());
                if (identityOpt.isEmpty()) {
                    return;
                }
                ServiceIdentity identity = identityOpt.get();
                if (!identity.shouldCleanService()) {
                    return;
                }
                Forward forward = forwardService.getById(identity.getForwardId());
                if (forward != null) {
                    return;
                }
                if ("tcp".equals(identity.getType())) {
                    log.info("删除孤立的服务: {} (节点: {})", service.getName(), node.getId());
                    GostDto gostDto = GostUtil.DeleteService(node.getId(), identity.getBaseName());
                    System.out.println(gostDto);
                } else if ("tls".equals(identity.getType())) {
                    log.info("删除孤立的服务: {} (节点: {})", service.getName(), node.getId());
                    GostUtil.DeleteRemoteService(node.getId(), identity.getBaseName());
                }
            }, "清理服务 " + service.getName());
        }

    }

    /**
     * 清理孤立的链
     */
    private void cleanOrphanedChains(GostConfigDto gostConfig, Node node) {
        if (gostConfig.getChains() == null) {
            return;
        }
        

        for (ConfigItem chain : gostConfig.getChains()) {
            safeExecute(() -> {
                Optional<ServiceIdentity> identityOpt = parseServiceIdentity(chain.getName());
                if (identityOpt.isEmpty()) {
                    return;
                }
                ServiceIdentity identity = identityOpt.get();
                if (!"chains".equals(identity.getType())) {
                    return;
                }
                Forward forward = forwardService.getById(identity.getForwardId());
                if (forward == null) {
                    log.info("删除孤立的链: {} (节点: {})", chain.getName(), node.getId());
                    GostUtil.DeleteChains(node.getId(), identity.getBaseName());
                }
            }, "清理链 " + chain.getName());
        }
    }

    /**
     * 清理孤立的限流器
     */
    private void cleanOrphanedLimiters(GostConfigDto gostConfig, Node node) {
        if (gostConfig.getLimiters() == null) {
            return;
        }
        

        for (ConfigItem limiter : gostConfig.getLimiters()) {
            safeExecute(() -> {
                SpeedLimit speedLimit = speedLimitService.getById(limiter.getName());
                if (speedLimit == null) {
                    log.info("删除孤立的限流器: {} (节点: {})", limiter.getName(), node.getId());
                    GostUtil.DeleteLimiters(node.getId(), Long.parseLong(limiter.getName()));
                }
            }, "清理限流器 " + limiter.getName());
        }
    }

    /**
     * 安全执行操作，捕获异常
     */
    private void safeExecute(Runnable operation, String operationDesc) {
        try {
            operation.run();
        } catch (Exception e) {
            log.info("执行操作失败: {}", operationDesc, e);
        }
    }


    /**
     * 解析服务名称
     */
    private Optional<ServiceIdentity> parseServiceIdentity(String serviceName) {
        if (serviceName == null || serviceName.isEmpty()) {
            return Optional.empty();
        }
        String[] parts = serviceName.split("_");
        if (parts.length < 2) {
            return Optional.empty();
        }
        String type = parts[parts.length - 1];
        boolean hasSuffix = isServiceSuffix(type);
        String baseName = hasSuffix ? String.join("_", java.util.Arrays.copyOf(parts, parts.length - 1)) : serviceName;
        String[] baseParts = baseName.split("_");
        if (baseParts.length < 2) {
            return Optional.empty();
        }
        String forwardId = baseParts[0];
        String userId = baseParts[1];
        return Optional.of(new ServiceIdentity(baseName, forwardId, userId, hasSuffix ? type : ""));
    }

    private boolean isServiceSuffix(String suffix) {
        return Objects.equals(suffix, "tcp")
                || Objects.equals(suffix, "udp")
                || Objects.equals(suffix, "tls")
                || Objects.equals(suffix, "chains");
    }

    private static class ServiceIdentity {
        private final String baseName;
        private final String forwardId;
        private final String userId;
        private final String type;

        private ServiceIdentity(String baseName, String forwardId, String userId, String type) {
            this.baseName = baseName;
            this.forwardId = forwardId;
            this.userId = userId;
            this.type = type;
        }

        public String getBaseName() {
            return baseName;
        }

        public String getForwardId() {
            return forwardId;
        }

        public String getUserId() {
            return userId;
        }

        public String getType() {
            return type;
        }

        public boolean shouldCleanService() {
            return "tcp".equals(type) || "tls".equals(type);
        }
    }
}
