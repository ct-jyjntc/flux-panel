package com.admin.common.task;

import com.admin.common.lang.R;
import com.admin.entity.Node;
import com.admin.entity.Tunnel;
import com.admin.service.ForwardService;
import com.admin.service.NodeService;
import com.admin.service.TunnelService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.*;

@Slf4j
@Component
public class TunnelFailoverTask {
    private static final int TUNNEL_TYPE_TUNNEL_FORWARD = 2;
    private static final int TUNNEL_STATUS_ACTIVE = 1;
    private static final int CONNECT_TIMEOUT_MS = 1500;
    private static final String DEFAULT_TUNNEL_PROTOCOL = "tls";

    @Resource
    private TunnelService tunnelService;

    @Resource
    private NodeService nodeService;

    @Resource
    private ForwardService forwardService;

    @Scheduled(fixedDelayString = "${flux.tunnel.failover.interval-ms:10000}")
    public void checkTunnelFailover() {
        List<Tunnel> tunnels = tunnelService.list(new QueryWrapper<Tunnel>().eq("type", TUNNEL_TYPE_TUNNEL_FORWARD));
        if (tunnels == null || tunnels.isEmpty()) {
            return;
        }

        for (Tunnel tunnel : tunnels) {
            if (tunnel == null || tunnel.getId() == null) {
                continue;
            }
            if (tunnel.getStatus() == null || tunnel.getStatus() != TUNNEL_STATUS_ACTIVE) {
                continue;
            }
            List<Long> outNodeIds = parseOutNodeIds(tunnel);
            if (outNodeIds.size() <= 1) {
                continue;
            }
            List<Node> outNodes = loadOutNodes(outNodeIds);
            if (outNodes.isEmpty()) {
                continue;
            }
            Node primary = outNodes.get(0);
            Node current = findNodeById(outNodes, tunnel.getOutNodeId());
            if (current == null) {
                current = primary;
            }

            boolean primaryReachable = isTcpReachable(primary);
            if (primaryReachable) {
                if (!Objects.equals(tunnel.getOutNodeId(), primary.getId())) {
                    switchTunnelExit(tunnel, primary);
                }
                continue;
            }

            if (current != null) {
                boolean currentReachable = isTcpReachable(current);
                if (currentReachable) {
                    continue;
                }
                if (isTcpReachableWithRetries(current, 3)) {
                    continue;
                }
            }

            Node desired = selectFirstHealthy(outNodes);
            if (desired == null || desired.getId() == null) {
                continue;
            }
            if (current != null && Objects.equals(current.getId(), desired.getId())) {
                continue;
            }
            switchTunnelExit(tunnel, desired);
        }
    }

    private List<Long> parseOutNodeIds(Tunnel tunnel) {
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        if (tunnel != null && StringUtils.isNotBlank(tunnel.getOutNodeIds())) {
            String[] parts = tunnel.getOutNodeIds().split(",");
            for (String part : parts) {
                String trimmed = part.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                try {
                    ids.add(Long.parseLong(trimmed));
                } catch (NumberFormatException ignored) {
                }
            }
        }
        if (ids.isEmpty() && tunnel != null && tunnel.getOutNodeId() != null) {
            ids.add(tunnel.getOutNodeId());
        }
        return new ArrayList<>(ids);
    }

    private List<Node> loadOutNodes(List<Long> nodeIds) {
        if (nodeIds == null || nodeIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<Node> nodes = new ArrayList<>();
        for (Long nodeId : nodeIds) {
            if (nodeId == null) {
                continue;
            }
            Node node = nodeService.getById(nodeId);
            if (node != null) {
                nodes.add(node);
            }
        }
        return nodes;
    }

    private Node selectFirstHealthy(List<Node> outNodes) {
        for (Node node : outNodes) {
            if (node == null || node.getId() == null) {
                continue;
            }
            if (isTcpReachable(node)) {
                return node;
            }
        }
        return null;
    }

    private boolean isTcpReachable(Node node) {
        if (node == null) {
            return false;
        }
        String host = node.getServerIp();
        Integer port = node.getOutPort();
        if (StringUtils.isBlank(host) || port == null) {
            return false;
        }
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host.trim(), port), CONNECT_TIMEOUT_MS);
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    private boolean isTcpReachableWithRetries(Node node, int retries) {
        if (node == null || retries <= 0) {
            return false;
        }
        for (int i = 0; i < retries; i++) {
            if (isTcpReachable(node)) {
                return true;
            }
        }
        return false;
    }

    private Node findNodeById(List<Node> outNodes, Long nodeId) {
        if (nodeId == null || outNodes == null) {
            return null;
        }
        for (Node node : outNodes) {
            if (node != null && Objects.equals(nodeId, node.getId())) {
                return node;
            }
        }
        return null;
    }

    private void switchTunnelExit(Tunnel tunnel, Node desired) {
        Tunnel oldSnapshot = new Tunnel();
        BeanUtils.copyProperties(tunnel, oldSnapshot);

        tunnel.setOutNodeId(desired.getId());
        tunnel.setProtocol(normalizeTunnelProtocol(desired.getTunnelProtocol()));
        if (Boolean.TRUE.equals(tunnel.getMuxEnabled()) && desired.getOutPort() != null) {
            tunnel.setMuxPort(desired.getOutPort());
        }
        tunnel.setUpdatedTime(System.currentTimeMillis());

        boolean updated = tunnelService.updateById(tunnel);
        if (!updated) {
            log.warn("隧道{}故障转移更新失败", tunnel.getId());
            return;
        }
        R rebuildResult = forwardService.rebuildForwardsForTunnelUpdate(oldSnapshot, tunnel);
        if (rebuildResult.getCode() != 0) {
            log.warn("隧道{}故障转移重建失败: {}", tunnel.getId(), rebuildResult.getMsg());
        }
    }

    private String normalizeTunnelProtocol(String protocol) {
        if (StringUtils.isBlank(protocol)) {
            return DEFAULT_TUNNEL_PROTOCOL;
        }
        return protocol.trim().toLowerCase();
    }
}
