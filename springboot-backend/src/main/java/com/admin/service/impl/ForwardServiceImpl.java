package com.admin.service.impl;

import com.admin.common.dto.ForwardDto;
import com.admin.common.dto.ForwardUpdateDto;
import com.admin.common.dto.ForwardWithTunnelDto;
import com.admin.common.dto.GostDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.JwtUtil;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.mapper.ForwardMapper;
import com.admin.service.*;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.annotation.PreDestroy;
import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * <p>
 * 端口转发服务实现类
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
@Slf4j
@Service
public class ForwardServiceImpl extends ServiceImpl<ForwardMapper, Forward> implements ForwardService {

    // 常量定义
    private static final String GOST_SUCCESS_MSG = "OK";
    private static final String GOST_NOT_FOUND_MSG = "not found";
    private static final int ADMIN_ROLE_ID = 0;
    private static final int TUNNEL_TYPE_PORT_FORWARD = 1;
    private static final int TUNNEL_TYPE_TUNNEL_FORWARD = 2;
    private static final int FORWARD_STATUS_ACTIVE = 1;
    private static final int FORWARD_STATUS_PAUSED = 0;
    private static final int FORWARD_STATUS_ERROR = -1;
    private static final int TUNNEL_STATUS_ACTIVE = 1;
    private static final int NODE_STATUS_ONLINE = 1;
    private static final int ACCESS_TYPE_OUT = 2;

    private static final long BYTES_TO_GB = 1024L * 1024L * 1024L;
    private static final int REBUILD_PARALLELISM = Math.max(2, Math.min(8, Runtime.getRuntime().availableProcessors()));
    private static final ExecutorService REBUILD_EXECUTOR = Executors.newFixedThreadPool(REBUILD_PARALLELISM);
    private static final int SERVICE_BATCH_SIZE = 100;

    @Resource
    @Lazy
    private TunnelService tunnelService;

    @Resource
    UserService userService;

    @Resource
    NodeService nodeService;

    @Resource
    SpeedLimitService speedLimitService;

    @Resource
    UserNodeService userNodeService;

    @PreDestroy
    public void shutdownRebuildExecutor() {
        REBUILD_EXECUTOR.shutdown();
        try {
            if (!REBUILD_EXECUTOR.awaitTermination(5, TimeUnit.SECONDS)) {
                REBUILD_EXECUTOR.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            REBUILD_EXECUTOR.shutdownNow();
        }
    }


    @Override
    public R createForward(ForwardDto forwardDto) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();

        if (hasMultipleTargets(forwardDto.getRemoteAddr())) {
            return R.err("目标地址只支持一个，请移除多余的目标");
        }

        // 2. 检查隧道是否存在和可用
        Tunnel tunnel = validateTunnel(forwardDto.getTunnelId());
        if (tunnel == null) {
            return R.err("隧道不存在");
        }
        if (tunnel.getStatus() != TUNNEL_STATUS_ACTIVE) {
            return R.err("隧道已禁用，无法创建转发");
        }

        // 3. 普通用户权限和限制检查
        UserPermissionResult permissionResult = checkUserPermissions(currentUser, tunnel, null);
        if (permissionResult.isHasError()) {
            return R.err(permissionResult.getErrorMessage());
        }

        // 4. 分配端口
        PortAllocation portAllocation = allocatePorts(tunnel, forwardDto.getInPort());
        if (portAllocation.isHasError()) {
            return R.err(portAllocation.getErrorMessage());
        }

        // 5. 创建并保存Forward对象
        Forward forward = createForwardEntity(forwardDto, currentUser, portAllocation);
        if (!this.save(forward)) {
            return R.err("端口转发创建失败");
        }

        // 6. 获取所需的节点信息
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            this.removeById(forward.getId());
            return R.err(nodeInfo.getErrorMessage());
        }

        // 7. 调用Gost服务创建转发
        R limiterResult = ensureLimiterOnNodes(nodeInfo.getInNodes(), permissionResult.getLimiter());
        if (limiterResult.getCode() != 0) {
            this.removeById(forward.getId());
            return limiterResult;
        }
        R gostResult = createGostServices(forward, tunnel, permissionResult.getLimiter(), nodeInfo);

        if (gostResult.getCode() != 0) {
            this.removeById(forward.getId());
            return gostResult;
        }

        return R.ok();
    }

    @Override
    public R getAllForwards() {
        UserInfo currentUser = getCurrentUserInfo();

        List<ForwardWithTunnelDto> forwardList;
        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            forwardList = baseMapper.selectForwardsWithTunnelByUserId(currentUser.getUserId());
        } else {
            forwardList = baseMapper.selectAllForwardsWithTunnel();
        }

        return R.ok(forwardList);
    }

    @Override
    public R updateForward(ForwardUpdateDto forwardUpdateDto) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();
        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            User user = userService.getById(currentUser.getUserId());
            if (user == null) return R.err("用户不存在");
            if (user.getStatus() == 0) return R.err("用户已到期或被禁用");
        }

        if (hasMultipleTargets(forwardUpdateDto.getRemoteAddr())) {
            return R.err("目标地址只支持一个，请移除多余的目标");
        }


        // 2. 检查转发是否存在
        Forward existForward = validateForwardExists(forwardUpdateDto.getId(), currentUser);
        if (existForward == null) {
            return R.err("转发不存在");
        }

        // 3. 检查隧道是否存在和可用
        Tunnel tunnel = validateTunnel(forwardUpdateDto.getTunnelId());
        if (tunnel == null) {
            return R.err("隧道不存在");
        }
        if (tunnel.getStatus() != TUNNEL_STATUS_ACTIVE) {
            return R.err("隧道已禁用，无法更新转发");
        }
        if (currentUser.getRoleId() != ADMIN_ROLE_ID && !Objects.equals(tunnel.getOwnerId(), currentUser.getUserId().longValue())) {
            return R.err("你只能使用自己创建的隧道");
        }
        boolean tunnelChanged = isTunnelChanged(existForward, forwardUpdateDto);
        // 4. 检查权限和限制
        UserPermissionResult permissionResult = null;
        if (tunnelChanged) {
            if (currentUser.getRoleId() == ADMIN_ROLE_ID) {
                // 管理员操作自己的转发时，不需要检查权限限制
                if (Objects.equals(currentUser.getUserId(), existForward.getUserId())) {
                    permissionResult = UserPermissionResult.success(getUserLimiter(currentUser.getUserId()));
                } else {
                    User originalUser = userService.getById(existForward.getUserId());
                    if (originalUser == null) {
                        return R.err("用户不存在");
                    }

                    if (tunnel.getOwnerId() != null && !Objects.equals(tunnel.getOwnerId(), existForward.getUserId().longValue())) {
                        return R.err("用户只能使用自己创建的隧道");
                    }

                    // 检查原用户的流量和转发数量限制
                    R quotaCheckResult = checkForwardQuota(existForward.getUserId(), originalUser, forwardUpdateDto.getId());
                    if (quotaCheckResult.getCode() != 0) {
                        return R.err("用户" + quotaCheckResult.getMsg());
                    }

                    permissionResult = UserPermissionResult.success(originalUser.getSpeedId());
                }
            } else {
                // 普通用户检查自己的权限
                permissionResult = checkUserPermissions(currentUser, tunnel, forwardUpdateDto.getId());
                if (permissionResult.isHasError()) {
                    return R.err(permissionResult.getErrorMessage());
                }
            }
        }
        Integer limiter = permissionResult != null ? permissionResult.getLimiter() : getUserLimiter(existForward.getUserId());

        // 6. 更新Forward对象
        Forward updatedForward = updateForwardEntity(forwardUpdateDto, existForward, tunnel);

        // 7. 获取所需的节点信息
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            return R.err(nodeInfo.getErrorMessage());
        }
        R limiterResult = ensureLimiterOnNodes(nodeInfo.getInNodes(), limiter);
        if (limiterResult.getCode() != 0) {
            return limiterResult;
        }

        // 8. 调用Gost服务更新转发
        R gostResult;
        if (tunnelChanged) {
            // 隧道变化时：先删除原配置，再创建新配置
            gostResult = updateGostServicesWithTunnelChange(existForward, updatedForward, tunnel, limiter, nodeInfo);
        } else {
            // 隧道未变化时：直接更新配置
            gostResult = updateGostServices(updatedForward, tunnel, limiter, nodeInfo);
        }

        if (gostResult.getCode() != 0) {
            return gostResult;
        }
        updatedForward.setStatus(1);
        // 9. 保存更新
        boolean result = this.updateById(updatedForward);
        return result ? R.ok("端口转发更新成功") : R.err("端口转发更新失败");
    }

    @Override
    public R deleteForward(Long id) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();

        // 2. 检查转发是否存在
        Forward forward = validateForwardExists(id, currentUser);
        if (forward == null) {
            return R.err("端口转发不存在");
        }

        // 3. 获取隧道信息
        Tunnel tunnel = validateTunnel(forward.getTunnelId());
        if (tunnel == null) {
            return R.err("隧道不存在");
        }

        if (currentUser.getRoleId() != ADMIN_ROLE_ID && !Objects.equals(tunnel.getOwnerId(), currentUser.getUserId().longValue())) {
            return R.err("你只能删除自己创建的隧道转发");
        }

        // 5. 获取所需的节点信息
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            return R.err(nodeInfo.getErrorMessage());
        }

        // 6. 调用Gost服务删除转发
        R gostResult = deleteGostServices(forward, tunnel, nodeInfo);
        if (gostResult.getCode() != 0) {
            return gostResult;
        }

        // 7. 删除转发记录
        boolean result = this.removeById(id);
        if (result) {
            return R.ok("端口转发删除成功");
        } else {
            return R.err("端口转发删除失败");
        }
    }

    @Override
    public R pauseForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_PAUSED, "暂停", "PauseService");
    }

    @Override
    public R resumeForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_ACTIVE, "恢复", "ResumeService");
    }

    @Override
    public R forceDeleteForward(Long id) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();

        // 2. 检查转发是否存在且用户有权限操作
        Forward forward = validateForwardExists(id, currentUser);
        if (forward == null) {
            return R.err("端口转发不存在");
        }

        // 3. 直接删除转发记录，跳过GOST服务删除
        boolean result = this.removeById(id);
        if (result) {
            return R.ok("端口转发强制删除成功");
        } else {
            return R.err("端口转发强制删除失败");
        }
    }

    /**
     * 改变转发状态（暂停/恢复）
     */
    private R changeForwardStatus(Long id, int targetStatus, String operation, String gostMethod) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();

        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            User user = userService.getById(currentUser.getUserId());
            if (user == null) return R.err("用户不存在");
            if (user.getStatus() == 0) return R.err("用户已到期或被禁用");
        }


        // 2. 检查转发是否存在
        Forward forward = validateForwardExists(id, currentUser);
        if (forward == null) {
            return R.err("转发不存在");
        }

        // 3. 获取隧道信息
        Tunnel tunnel = validateTunnel(forward.getTunnelId());
        if (tunnel == null) {
            return R.err("隧道不存在");
        }

        if (currentUser.getRoleId() != ADMIN_ROLE_ID && !Objects.equals(tunnel.getOwnerId(), currentUser.getUserId().longValue())) {
            return R.err("你只能操作自己创建的隧道转发");
        }

        // 4. 恢复服务时需要额外检查
        if (targetStatus == FORWARD_STATUS_ACTIVE) {
            if (tunnel.getStatus() != TUNNEL_STATUS_ACTIVE) {
                return R.err("隧道已禁用，无法恢复服务");
            }

            // 普通用户需要检查流量和账户状态
            if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
                R flowCheckResult = checkUserFlowLimits(currentUser.getUserId(), tunnel);
                if (flowCheckResult.getCode() != 0) {
                    return flowCheckResult;
                }
            }
        }

        // 7. 获取所需的节点信息
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            return R.err(nodeInfo.getErrorMessage());
        }

        // 8. 调用Gost服务
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());
        List<Node> inNodes = filterOnlineNodes(extractInNodes(nodeInfo));
        if (inNodes.isEmpty()) {
            return R.err("入口节点当前离线，请确保节点正常运行");
        }

        boolean muxEnabled = Boolean.TRUE.equals(tunnel.getMuxEnabled());
        if ("PauseService".equals(gostMethod)) {
            for (Node inNode : inNodes) {
                GostDto gostResult = GostUtil.PauseService(inNode.getId(), serviceName);
                if (!isGostOperationSuccess(gostResult)) {
                    return R.err(operation + "服务失败：" + gostResult.getMsg());
                }
            }

            // 隧道转发需要同时暂停远端服务
            if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && !muxEnabled) {
                for (Node outNode : nodeInfo.getOutNodes()) {
                    GostDto remoteResult = GostUtil.PauseRemoteService(outNode.getId(), serviceName);
                    if (!isGostOperationSuccess(remoteResult)) {
                        return R.err(operation + "远端服务失败：" + remoteResult.getMsg());
                    }
                }
            }
        } else {
            for (Node inNode : inNodes) {
                GostDto gostResult = GostUtil.ResumeService(inNode.getId(), serviceName);
                if (!isGostOperationSuccess(gostResult)) {
                    return R.err(operation + "服务失败：" + gostResult.getMsg());
                }
            }

            // 隧道转发需要同时恢复远端服务
            if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && !muxEnabled) {
                for (Node outNode : nodeInfo.getOutNodes()) {
                    GostDto remoteResult = GostUtil.ResumeRemoteService(outNode.getId(), serviceName);
                    if (!isGostOperationSuccess(remoteResult)) {
                        return R.err(operation + "远端服务失败：" + remoteResult.getMsg());
                    }
                }
            }
        }

        // 9. 更新转发状态
        forward.setStatus(targetStatus);
        forward.setUpdatedTime(System.currentTimeMillis());
        boolean result = this.updateById(forward);

        return result ? R.ok("服务已" + operation) : R.err("更新状态失败");
    }

    @Override
    public R diagnoseForward(Long id) {
        // 1. 获取当前用户信息
        UserInfo currentUser = getCurrentUserInfo();
        Set<Long> outOnlyNodeIds = currentUser.getRoleId() == ADMIN_ROLE_ID
                ? Collections.emptySet()
                : getOutOnlyNodeIdsForUser(currentUser.getUserId());

        // 2. 检查转发是否存在且用户有权限访问
        Forward forward = validateForwardExists(id, currentUser);
        if (forward == null) {
            return R.err("转发不存在");
        }

        // 3. 获取隧道信息
        Tunnel tunnel = validateTunnel(forward.getTunnelId());
        if (tunnel == null) {
            return R.err("隧道不存在");
        }

        // 4. 获取入口节点信息
        List<Node> inNodes = resolveInNodes(tunnel);
        if (inNodes.isEmpty()) {
            return R.err("入口节点不存在");
        }

        List<DiagnosisResult> results = new ArrayList<>();
        String[] remoteAddresses = forward.getRemoteAddr().split(",");
        // 6. 根据隧道类型执行不同的诊断策略
        if (tunnel.getType() == TUNNEL_TYPE_PORT_FORWARD) {
            // 端口转发：入口节点直接TCP ping目标地址
            for (Node inNode : inNodes) {
                for (String remoteAddress : remoteAddresses) {
                    // 提取IP和端口
                    String targetIp = extractIpFromAddress(remoteAddress);
                    int targetPort = extractPortFromAddress(remoteAddress);
                    if (targetIp == null || targetPort == -1) {
                        return R.err("无法解析目标地址: " + remoteAddress);
                    }

                    DiagnosisResult result = performTcpPingDiagnosis(inNode, targetIp, targetPort, "转发->目标");
                    results.add(result);
                }
            }
        } else {
            // 隧道转发：入口TCP ping出口，出口TCP ping目标
            List<Node> outNodes = resolveOutNodes(tunnel);
            if (outNodes.isEmpty()) {
                return R.err("出口节点不存在");
            }

            for (Node outNode : outNodes) {
                int outPort = resolveOutNodePort(tunnel, forward, outNode);
                if (outPort <= 0) {
                    return R.err("出口端口未配置");
                }
                for (Node inNode : inNodes) {
                    DiagnosisResult inToOutResult = performTcpPingDiagnosis(inNode, outNode.getServerIp(), outPort, "入口->出口(" + outNode.getName() + ")");
                    if (outOnlyNodeIds.contains(outNode.getId())) {
                        inToOutResult.setTargetIp("隐藏");
                    }
                    results.add(inToOutResult);
                }

                // 出口TCP ping目标
                for (String remoteAddress : remoteAddresses) {
                    // 提取IP和端口
                    String targetIp = extractIpFromAddress(remoteAddress);
                    int targetPort = extractPortFromAddress(remoteAddress);
                    if (targetIp == null || targetPort == -1) {
                        return R.err("无法解析目标地址: " + remoteAddress);
                    }
                    DiagnosisResult outToTargetResult = performTcpPingDiagnosis(outNode, targetIp, targetPort, "出口->目标");
                    results.add(outToTargetResult);
                }
            }
        }

        // 7. 构建诊断报告
        Map<String, Object> diagnosisReport = new HashMap<>();
        diagnosisReport.put("forwardId", id);
        diagnosisReport.put("forwardName", forward.getName());
        diagnosisReport.put("tunnelType", tunnel.getType() == TUNNEL_TYPE_PORT_FORWARD ? "端口转发" : "隧道转发");
        diagnosisReport.put("results", results);
        diagnosisReport.put("timestamp", System.currentTimeMillis());

        return R.ok(diagnosisReport);
    }

    @Override
    public R updateForwardOrder(Map<String, Object> params) {
        try {
            // 1. 获取当前用户信息
            UserInfo currentUser = getCurrentUserInfo();

            // 2. 验证参数
            if (!params.containsKey("forwards")) {
                return R.err("缺少forwards参数");
            }

            @SuppressWarnings("unchecked")
            List<Map<String, Object>> forwardsList = (List<Map<String, Object>>) params.get("forwards");
            if (forwardsList == null || forwardsList.isEmpty()) {
                return R.err("forwards参数不能为空");
            }

            // 3. 验证用户权限（只能更新自己的转发）
            if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
                // 普通用户只能更新自己的转发
                List<Long> forwardIds = forwardsList.stream()
                        .map(item -> Long.valueOf(item.get("id").toString()))
                        .collect(Collectors.toList());

                // 检查所有转发是否属于当前用户
                QueryWrapper<Forward> queryWrapper = new QueryWrapper<>();
                queryWrapper.in("id", forwardIds);
                queryWrapper.eq("user_id", currentUser.getUserId());

                long count = this.count(queryWrapper);
                if (count != forwardIds.size()) {
                    return R.err("只能更新自己的转发排序");
                }
            }

            // 4. 批量更新排序
            List<Forward> forwardsToUpdate = new ArrayList<>();
            for (Map<String, Object> forwardData : forwardsList) {
                Long id = Long.valueOf(forwardData.get("id").toString());
                Integer inx = Integer.valueOf(forwardData.get("inx").toString());

                Forward forward = new Forward();
                forward.setId(id);
                forward.setInx(inx);
                forwardsToUpdate.add(forward);
            }

            // 5. 执行批量更新
            boolean success = this.updateBatchById(forwardsToUpdate);
            if (success) {
                log.info("用户 {} 更新了 {} 个转发的排序", currentUser.getUserName(), forwardsToUpdate.size());
                return R.ok("排序更新成功");
            } else {
                return R.err("排序更新失败");
            }

        } catch (Exception e) {
            log.error("更新转发排序失败", e);
            return R.err("更新排序时发生错误: " + e.getMessage());
        }
    }

    @Override
    public R batchDeleteForwards(List<Long> forwardIds) {
        if (forwardIds == null || forwardIds.isEmpty()) {
            return R.err("未选择转发");
        }

        int success = 0;
        List<Map<String, Object>> failed = new ArrayList<>();

        for (Long id : forwardIds) {
            R deleteResult = deleteForward(id);
            if (deleteResult.getCode() == 0) {
                success++;
                continue;
            }

            R forceResult = forceDeleteForward(id);
            if (forceResult.getCode() == 0) {
                success++;
                continue;
            }

            boolean removed = this.removeById(id);
            if (removed) {
                success++;
                continue;
            }

            Map<String, Object> failure = new HashMap<>();
            failure.put("id", id);
            failure.put("message", deleteResult.getMsg());
            failed.add(failure);
        }

        Map<String, Object> summary = new HashMap<>();
        summary.put("total", forwardIds.size());
        summary.put("success", success);
        summary.put("failed", failed.size());
        summary.put("failedItems", failed);
        return R.ok(summary);
    }

    @Override
    public R batchUpdateForwardTunnel(List<Long> forwardIds, Integer tunnelId) {
        if (forwardIds == null || forwardIds.isEmpty()) {
            return R.err("未选择转发");
        }
        if (tunnelId == null) {
            return R.err("隧道ID不能为空");
        }

        int success = 0;
        List<Map<String, Object>> failed = new ArrayList<>();

        for (Long id : forwardIds) {
            Forward forward = this.getById(id);
            if (forward == null) {
                Map<String, Object> failure = new HashMap<>();
                failure.put("id", id);
                failure.put("message", "转发不存在");
                failed.add(failure);
                continue;
            }

            ForwardUpdateDto updateDto = new ForwardUpdateDto();
            updateDto.setId(forward.getId());
            updateDto.setUserId(forward.getUserId());
            updateDto.setName(forward.getName());
            updateDto.setTunnelId(tunnelId);
            updateDto.setRemoteAddr(forward.getRemoteAddr());
            updateDto.setStrategy(forward.getStrategy());
            updateDto.setInPort(forward.getInPort());
            updateDto.setInterfaceName(forward.getInterfaceName());

            R updateResult = updateForward(updateDto);
            if (updateResult.getCode() == 0) {
                success++;
            } else {
                Map<String, Object> failure = new HashMap<>();
                failure.put("id", id);
                failure.put("message", updateResult.getMsg());
                failed.add(failure);
            }
        }

        Map<String, Object> summary = new HashMap<>();
        summary.put("total", forwardIds.size());
        summary.put("success", success);
        summary.put("failed", failed.size());
        summary.put("failedItems", failed);
        return R.ok(summary);
    }

    /**
     * 从地址字符串中提取IP地址
     * 支持格式: ip:port, [ipv6]:port, domain:port
     */
    private String extractIpFromAddress(String address) {
        if (address == null || address.trim().isEmpty()) {
            return null;
        }

        address = address.trim();

        // IPv6格式: [ipv6]:port
        if (address.startsWith("[")) {
            int closeBracket = address.indexOf(']');
            if (closeBracket > 1) {
                return address.substring(1, closeBracket);
            }
        }

        // IPv4或域名格式: ip:port 或 domain:port
        int lastColon = address.lastIndexOf(':');
        if (lastColon > 0) {
            return address.substring(0, lastColon);
        }

        // 如果没有端口，直接返回地址
        return address;
    }

    /**
     * 从地址字符串中提取端口号
     * 支持格式: ip:port, [ipv6]:port, domain:port
     */
    private int extractPortFromAddress(String address) {
        if (address == null || address.trim().isEmpty()) {
            return -1;
        }

        address = address.trim();

        // IPv6格式: [ipv6]:port
        if (address.startsWith("[")) {
            int closeBracket = address.indexOf(']');
            if (closeBracket > 1 && closeBracket + 1 < address.length() && address.charAt(closeBracket + 1) == ':') {
                String portStr = address.substring(closeBracket + 2);
                try {
                    return Integer.parseInt(portStr);
                } catch (NumberFormatException e) {
                    return -1;
                }
            }
        }

        // IPv4或域名格式: ip:port 或 domain:port
        int lastColon = address.lastIndexOf(':');
        if (lastColon > 0 && lastColon + 1 < address.length()) {
            String portStr = address.substring(lastColon + 1);
            try {
                return Integer.parseInt(portStr);
            } catch (NumberFormatException e) {
                return -1;
            }
        }

        // 如果没有端口，返回-1表示无法解析
        return -1;
    }

    /**
     * 执行TCP ping诊断
     *
     * @param node        执行TCP ping的节点
     * @param targetIp    目标IP地址
     * @param port        目标端口
     * @param description 诊断描述
     * @return 诊断结果
     */
    private DiagnosisResult performTcpPingDiagnosis(Node node, String targetIp, int port, String description) {
        try {
            // 构建TCP ping请求数据
            JSONObject tcpPingData = new JSONObject();
            tcpPingData.put("ip", targetIp);
            tcpPingData.put("port", port);
            tcpPingData.put("count", 2);
            tcpPingData.put("timeout", 3000); // 5秒超时

            // 发送TCP ping命令到节点
            GostDto gostResult = WebSocketServer.send_msg(node.getId(), tcpPingData, "TcpPing");

            DiagnosisResult result = new DiagnosisResult();
            result.setNodeId(node.getId());
            result.setNodeName(node.getName());
            result.setTargetIp(targetIp);
            result.setTargetPort(port);
            result.setDescription(description);
            result.setTimestamp(System.currentTimeMillis());

            if (gostResult != null && "OK".equals(gostResult.getMsg())) {
                // 尝试解析TCP ping响应数据
                try {
                    if (gostResult.getData() != null) {
                        JSONObject tcpPingResponse = (JSONObject) gostResult.getData();
                        boolean success = tcpPingResponse.getBooleanValue("success");

                        result.setSuccess(success);
                        if (success) {
                            result.setMessage("TCP连接成功");
                            result.setAverageTime(tcpPingResponse.getDoubleValue("averageTime"));
                            result.setPacketLoss(tcpPingResponse.getDoubleValue("packetLoss"));
                        } else {
                            result.setMessage(tcpPingResponse.getString("errorMessage"));
                            result.setAverageTime(-1.0);
                            result.setPacketLoss(100.0);
                        }
                    } else {
                        // 没有详细数据，使用默认值
                        result.setSuccess(true);
                        result.setMessage("TCP连接成功");
                        result.setAverageTime(0.0);
                        result.setPacketLoss(0.0);
                    }
                } catch (Exception e) {
                    // 解析响应数据失败，但TCP ping命令本身成功了
                    result.setSuccess(true);
                    result.setMessage("TCP连接成功，但无法解析详细数据");
                    result.setAverageTime(0.0);
                    result.setPacketLoss(0.0);
                }
            } else {
                result.setSuccess(false);
                result.setMessage(gostResult != null ? gostResult.getMsg() : "节点无响应");
                result.setAverageTime(-1.0);
                result.setPacketLoss(100.0);
            }

            return result;
        } catch (Exception e) {
            DiagnosisResult result = new DiagnosisResult();
            result.setNodeId(node.getId());
            result.setNodeName(node.getName());
            result.setTargetIp(targetIp);
            result.setTargetPort(port);
            result.setDescription(description);
            result.setSuccess(false);
            result.setMessage("诊断执行异常: " + e.getMessage());
            result.setTimestamp(System.currentTimeMillis());
            result.setAverageTime(-1.0);
            result.setPacketLoss(100.0);
            return result;
        }
    }

    /**
     * 获取当前用户信息
     */
    private UserInfo getCurrentUserInfo() {
        Integer userId = JwtUtil.getUserIdFromToken();
        Integer roleId = JwtUtil.getRoleIdFromToken();
        String userName = JwtUtil.getNameFromToken();
        return new UserInfo(userId, roleId, userName);
    }

    private boolean hasMultipleTargets(String remoteAddr) {
        if (StringUtils.isBlank(remoteAddr)) {
            return false;
        }
        return remoteAddr.contains(",") || remoteAddr.contains("\n") || remoteAddr.contains("\r");
    }

    private Set<Long> getOutOnlyNodeIdsForUser(Integer userId) {
        if (userId == null) {
            return Collections.emptySet();
        }
        return userNodeService.list(new QueryWrapper<UserNode>().eq("user_id", userId))
                .stream()
                .filter(userNode -> userNode.getAccessType() != null && userNode.getAccessType() == ACCESS_TYPE_OUT)
                .map(UserNode::getNodeId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
    }

    /**
     * 验证隧道是否存在
     */
    private Tunnel validateTunnel(Integer tunnelId) {
        return tunnelService.getById(tunnelId);
    }

    /**
     * 验证转发是否存在且用户有权限访问
     */
    private Forward validateForwardExists(Long forwardId, UserInfo currentUser) {
        Forward forward = this.getById(forwardId);
        if (forward == null) {
            return null;
        }

        // 普通用户只能操作自己的转发
        if (currentUser.getRoleId() != ADMIN_ROLE_ID &&
                !Objects.equals(currentUser.getUserId(), forward.getUserId())) {
            return null;
        }

        return forward;
    }

    /**
     * 获取所需的节点信息
     */
    private NodeInfo getRequiredNodes(Tunnel tunnel) {
        List<Node> inNodes = resolveInNodes(tunnel);
        if (inNodes.isEmpty()) {
            return NodeInfo.error("入口节点不存在");
        }

        List<Node> outNodes = Collections.emptyList();
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            outNodes = resolveOutNodes(tunnel);
            if (outNodes.isEmpty()) {
                return NodeInfo.error("出口节点不存在");
            }
        }

        return NodeInfo.success(inNodes, outNodes);
    }

    private List<Node> extractInNodes(NodeInfo nodeInfo) {
        if (nodeInfo == null) {
            return Collections.emptyList();
        }
        if (nodeInfo.getInNodes() != null && !nodeInfo.getInNodes().isEmpty()) {
            return nodeInfo.getInNodes();
        }
        if (nodeInfo.getInNode() != null) {
            return Collections.singletonList(nodeInfo.getInNode());
        }
        return Collections.emptyList();
    }

    private List<Node> filterOnlineNodes(List<Node> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            return Collections.emptyList();
        }
        return nodes.stream()
                .filter(node -> node != null && node.getStatus() != null && node.getStatus() == NODE_STATUS_ONLINE)
                .collect(Collectors.toList());
    }

    private List<Node> resolveInNodes(Tunnel tunnel) {
        List<Long> inNodeIds = new ArrayList<>();
        if (tunnel.getInNodeIds() != null && !tunnel.getInNodeIds().trim().isEmpty()) {
            String[] parts = tunnel.getInNodeIds().split(",");
            for (String part : parts) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    try {
                        inNodeIds.add(Long.parseLong(trimmed));
                    } catch (NumberFormatException ignored) {
                        // ignore invalid id
                    }
                }
            }
        }
        if (inNodeIds.isEmpty() && tunnel.getInNodeId() != null) {
            inNodeIds.add(tunnel.getInNodeId());
        }
        List<Node> nodes = new ArrayList<>();
        for (Long nodeId : inNodeIds) {
            Node node = nodeService.getById(nodeId);
            if (node != null) {
                nodes.add(node);
            }
        }
        return nodes;
    }

    private List<Node> resolveOutNodes(Tunnel tunnel) {
        List<Long> outNodeIds = new ArrayList<>();
        if (tunnel.getOutNodeIds() != null && !tunnel.getOutNodeIds().trim().isEmpty()) {
            String[] parts = tunnel.getOutNodeIds().split(",");
            for (String part : parts) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    try {
                        outNodeIds.add(Long.parseLong(trimmed));
                    } catch (NumberFormatException ignored) {
                        // ignore invalid id
                    }
                }
            }
        }
        if (outNodeIds.isEmpty() && tunnel.getOutNodeId() != null) {
            outNodeIds.add(tunnel.getOutNodeId());
        }
        if (outNodeIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<Node> nodes = new ArrayList<>();
        for (Long nodeId : new LinkedHashSet<>(outNodeIds)) {
            Node node = nodeService.getById(nodeId);
            if (node != null) {
                nodes.add(node);
            }
        }
        return nodes;
    }

    /**
     * 检查用户权限和限制
     */
    private UserPermissionResult checkUserPermissions(UserInfo currentUser, Tunnel tunnel, Long excludeForwardId) {
        if (currentUser.getRoleId() == ADMIN_ROLE_ID) {
            return UserPermissionResult.success(null);
        }

        // 获取用户信息
        User userInfo = userService.getById(currentUser.getUserId());
        if (userInfo == null) {
            return UserPermissionResult.error("用户不存在");
        }
        if (userInfo.getExpTime() != null && userInfo.getExpTime() <= System.currentTimeMillis()) {
            return UserPermissionResult.error("当前账号已到期");
        }
        if (userInfo.getStatus() != null && userInfo.getStatus() != 1) {
            return UserPermissionResult.error("当前账号已禁用");
        }

        if (!Objects.equals(tunnel.getOwnerId(), currentUser.getUserId().longValue())) {
            return UserPermissionResult.error("你只能使用自己创建的隧道");
        }

        // 流量限制检查
        if (userInfo.getFlow() <= 0) {
            return UserPermissionResult.error("用户总流量已用完");
        }

        // 转发数量限制检查
        R quotaCheckResult = checkForwardQuota(currentUser.getUserId(), userInfo, excludeForwardId);
        if (quotaCheckResult.getCode() != 0) {
            return UserPermissionResult.error(quotaCheckResult.getMsg());
        }

        return UserPermissionResult.success(userInfo.getSpeedId());
    }

    /**
     * 检查用户转发数量限制
     */
    private R checkForwardQuota(Integer userId, User userInfo, Long excludeForwardId) {
        // 检查用户总转发数量限制
        QueryWrapper<Forward> userForwardQuery = new QueryWrapper<Forward>().eq("user_id", userId);
        if (excludeForwardId != null) {
            userForwardQuery.ne("id", excludeForwardId);
        }
        long userForwardCount = this.count(userForwardQuery);
        if (userForwardCount >= userInfo.getNum()) {
            return R.err("用户总转发数量已达上限，当前限制：" + userInfo.getNum() + "个");
        }

        return R.ok();
    }

    /**
     * 检查用户流量限制
     */
    private R checkUserFlowLimits(Integer userId, Tunnel tunnel) {
        User userInfo = userService.getById(userId);
        if (userInfo.getExpTime() != null && userInfo.getExpTime() <= System.currentTimeMillis()) {
            return R.err("当前账号已到期");
        }
        if (userInfo.getStatus() != null && userInfo.getStatus() != 1) {
            return R.err("当前账号已禁用");
        }

        if (!Objects.equals(tunnel.getOwnerId(), userId.longValue())) {
            return R.err("你只能使用自己创建的隧道");
        }

        // 检查用户总流量限制
        if (userInfo.getFlow() * BYTES_TO_GB <= userInfo.getInFlow() + userInfo.getOutFlow()) {
            return R.err("用户总流量已用完，无法恢复服务");
        }

        return R.ok();
    }

    /**
     * 分配端口
     */
    private PortAllocation allocatePorts(Tunnel tunnel, Integer specifiedInPort) {
        return allocatePorts(tunnel, specifiedInPort, null);
    }

    /**
     * 分配端口
     */
    private PortAllocation allocatePorts(Tunnel tunnel, Integer specifiedInPort, Long excludeForwardId) {
        Integer inPort;

        if (specifiedInPort != null) {
            // 用户指定了入口端口，需要检查是否可用
            if (!isInPortAvailable(tunnel, specifiedInPort, excludeForwardId)) {
                return PortAllocation.error("指定的入口端口 " + specifiedInPort + " 已被占用或不在允许范围内");
            }
            inPort = specifiedInPort;
        } else {
            // 用户未指定端口时自动分配
            inPort = allocateInPort(tunnel, excludeForwardId);
            if (inPort == null) {
                return PortAllocation.error("隧道入口端口已满，无法分配新端口");
            }
        }

        Integer outPort = null;
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (Boolean.TRUE.equals(tunnel.getMuxEnabled())) {
                outPort = tunnel.getMuxPort();
                if (outPort == null) {
                    List<Node> outNodes = resolveOutNodes(tunnel);
                    if (!outNodes.isEmpty()) {
                        outPort = outNodes.get(0).getOutPort();
                    }
                }
                if (outPort == null) {
                    return PortAllocation.error("出口共享端口未配置");
                }
            } else {
                outPort = allocateOutPort(tunnel, excludeForwardId);
                if (outPort == null) {
                    return PortAllocation.error("隧道出口端口已满，无法分配新端口");
                }
            }
        }

        return PortAllocation.success(inPort, outPort);
    }

    /**
     * 创建Forward实体对象
     */
    private Forward createForwardEntity(ForwardDto forwardDto, UserInfo currentUser, PortAllocation portAllocation) {
        Forward forward = new Forward();
        // 先复制DTO的属性，再设置其他属性，避免被覆盖
        BeanUtils.copyProperties(forwardDto, forward);
        forward.setStatus(FORWARD_STATUS_ACTIVE);
        forward.setInPort(portAllocation.getInPort());
        forward.setOutPort(portAllocation.getOutPort());
        forward.setUserId(currentUser.getUserId());
        forward.setUserName(currentUser.getUserName());
        forward.setCreatedTime(System.currentTimeMillis());
        forward.setUpdatedTime(System.currentTimeMillis());
        return forward;
    }

    /**
     * 更新Forward实体对象
     */
    private Forward updateForwardEntity(ForwardUpdateDto forwardUpdateDto, Forward existForward, Tunnel tunnel) {
        Forward forward = new Forward();
        BeanUtils.copyProperties(forwardUpdateDto, forward);

        // 处理端口分配逻辑
        boolean tunnelChanged = !existForward.getTunnelId().equals(forwardUpdateDto.getTunnelId());
        boolean inPortChanged = forwardUpdateDto.getInPort() != null &&
                !Objects.equals(forwardUpdateDto.getInPort(), existForward.getInPort());

        if (tunnelChanged || inPortChanged) {
            // 隧道变化或入口端口变化时需要重新分配
            Integer specifiedInPort = forwardUpdateDto.getInPort();
            // 如果没有指定新端口但隧道未变化，保持原端口
            if (specifiedInPort == null && !tunnelChanged) {
                specifiedInPort = existForward.getInPort();
            }

            PortAllocation portAllocation = allocatePorts(tunnel, specifiedInPort, forwardUpdateDto.getId());
            if (portAllocation.isHasError()) {
                throw new RuntimeException(portAllocation.getErrorMessage());
            }
            forward.setInPort(portAllocation.getInPort());
            forward.setOutPort(portAllocation.getOutPort());
        } else {
            // 隧道和端口都未变化，保持原端口
            forward.setInPort(existForward.getInPort());
            forward.setOutPort(existForward.getOutPort());
        }

        forward.setUpdatedTime(System.currentTimeMillis());
        return forward;
    }

    /**
     * 创建Gost服务
     */
    private R createGostServices(Forward forward, Tunnel tunnel, Integer limiter, NodeInfo nodeInfo) {
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());
        List<Node> inNodes = filterOnlineNodes(extractInNodes(nodeInfo));
        if (inNodes.isEmpty()) {
            return R.err("入口节点当前离线，请确保节点正常运行");
        }
        boolean muxEnabled = Boolean.TRUE.equals(tunnel.getMuxEnabled());
        List<Node> outNodes = nodeInfo.getOutNodes() != null ? nodeInfo.getOutNodes() : Collections.emptyList();

        // 隧道转发需要创建链和远程服务
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (muxEnabled) {
                R muxResult = ensureMuxService(outNodes, tunnel, tunnel.getInterfaceName());
                if (muxResult.getCode() != 0) {
                    return muxResult;
                }
            }
            for (Node inNode : inNodes) {
                R chainResult = createChainService(inNode, serviceName, outNodes, forward.getOutPort(), tunnel.getProtocol(), tunnel.getInterfaceName(), muxEnabled, tunnel.getOutStrategy());
                if (chainResult.getCode() != 0) {
                    for (Node cleanupNode : inNodes) {
                        GostUtil.DeleteChains(cleanupNode.getId(), serviceName);
                    }
                    if (!muxEnabled) {
                        deleteRemoteServices(outNodes, serviceName);
                    }
                    return chainResult;
                }
            }
            if (!muxEnabled) {
                R remoteResult = createRemoteServices(outNodes, serviceName, forward, tunnel.getProtocol(), forward.getInterfaceName());
                if (remoteResult.getCode() != 0) {
                    for (Node cleanupNode : inNodes) {
                        GostUtil.DeleteChains(cleanupNode.getId(), serviceName);
                    }
                    deleteRemoteServices(outNodes, serviceName);
                    return remoteResult;
                }
            }
        }

        String interfaceName = null;
        // 创建主服务
        if (tunnel.getType() != TUNNEL_TYPE_TUNNEL_FORWARD) { // 不是隧道转发服务才会存在网络接口
            interfaceName = forward.getInterfaceName();
        }

        for (Node inNode : inNodes) {
            R serviceResult = createMainService(inNode, serviceName, forward, limiter, tunnel.getType(), tunnel, forward.getStrategy(), interfaceName);
            if (serviceResult.getCode() != 0) {
                for (Node cleanupNode : inNodes) {
                    GostUtil.DeleteChains(cleanupNode.getId(), serviceName);
                }
                if (!muxEnabled) {
                    deleteRemoteServices(outNodes, serviceName);
                }
                return serviceResult;
            }
        }
        return R.ok();
    }

    /**
     * 更新Gost服务
     */
    private R updateGostServices(Forward forward, Tunnel tunnel, Integer limiter, NodeInfo nodeInfo) {
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());
        List<Node> inNodes = filterOnlineNodes(extractInNodes(nodeInfo));
        if (inNodes.isEmpty()) {
            updateForwardStatusToError(forward);
            return R.err("入口节点当前离线，请确保节点正常运行");
        }
        boolean muxEnabled = Boolean.TRUE.equals(tunnel.getMuxEnabled());
        List<Node> outNodes = nodeInfo.getOutNodes() != null ? nodeInfo.getOutNodes() : Collections.emptyList();

        // 隧道转发需要更新链和远程服务
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (muxEnabled) {
                R muxResult = ensureMuxService(outNodes, tunnel, tunnel.getInterfaceName());
                if (muxResult.getCode() != 0) {
                    updateForwardStatusToError(forward);
                    return muxResult;
                }
            }
            for (Node inNode : inNodes) {
                R chainResult = updateChainService(inNode, serviceName, outNodes, forward.getOutPort(), tunnel.getProtocol(), tunnel.getInterfaceName(), muxEnabled, tunnel.getOutStrategy());
                if (chainResult.getCode() != 0) {
                    updateForwardStatusToError(forward);
                    return chainResult;
                }
            }
            if (!muxEnabled) {
                R remoteResult = updateRemoteServices(outNodes, serviceName, forward, tunnel.getProtocol(), forward.getInterfaceName());
                if (remoteResult.getCode() != 0) {
                    updateForwardStatusToError(forward);
                    return remoteResult;
                }
            }
        }
        String interfaceName = null;
        // 创建主服务
        if (tunnel.getType() != TUNNEL_TYPE_TUNNEL_FORWARD) { // 不是隧道转发服务才会存在网络接口
            interfaceName = forward.getInterfaceName();
        }
        // 更新主服务
        for (Node inNode : inNodes) {
            R serviceResult = updateMainService(inNode, serviceName, forward, limiter, tunnel.getType(), tunnel, forward.getStrategy(), interfaceName);
            if (serviceResult.getCode() != 0) {
                updateForwardStatusToError(forward);
                return serviceResult;
            }
        }

        return R.ok();
    }

    /**
     * 隧道变化时更新Gost服务：先删除原配置，再创建新配置
     */
    private R updateGostServicesWithTunnelChange(Forward existForward, Forward updatedForward, Tunnel newTunnel, Integer limiter, NodeInfo nodeInfo) {
        // 1. 获取原隧道信息
        Tunnel oldTunnel = tunnelService.getById(existForward.getTunnelId());
        if (oldTunnel == null) {
            return R.err("原隧道不存在，无法删除旧配置");
        }

        // 2. 删除原有的Gost服务配置
        R deleteResult = deleteOldGostServices(existForward, oldTunnel);
        if (deleteResult.getCode() != 0) {
            // 删除失败时记录日志，但不影响后续创建（可能原配置已不存在）
            log.info("删除原隧道{}的Gost配置失败: {}", oldTunnel.getId(), deleteResult.getMsg());
        }

        // 3. 创建新的Gost服务配置
        R createResult = createGostServices(updatedForward, newTunnel, limiter, nodeInfo);
        if (createResult.getCode() != 0) {
            updateForwardStatusToError(updatedForward);
            return R.err("创建新隧道配置失败: " + createResult.getMsg());
        }

        return R.ok();
    }

    /**
     * 删除原有的Gost服务（隧道变化时专用）
     */
    private R deleteOldGostServices(Forward forward, Tunnel oldTunnel) {
        // 获取原隧道的用户隧道关系
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());

        // 获取原隧道的节点信息
        NodeInfo oldNodeInfo = getRequiredNodes(oldTunnel);

        List<Node> inNodes = oldNodeInfo.getInNodes() != null && !oldNodeInfo.getInNodes().isEmpty()
                ? oldNodeInfo.getInNodes()
                : (oldNodeInfo.getInNode() != null ? Collections.singletonList(oldNodeInfo.getInNode()) : Collections.emptyList());

        // 删除主服务（使用原隧道的入口节点）
        if (!oldNodeInfo.isHasError()) {
            for (Node inNode : inNodes) {
                GostDto serviceResult = GostUtil.DeleteService(inNode.getId(), serviceName);
                if (!isGostOperationSuccess(serviceResult)) {
                    log.info("删除主服务失败: {}", serviceResult.getMsg());
                }
            }
        }

        // 如果原隧道是隧道转发类型，需要删除链和远程服务
        if (oldTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            boolean muxEnabled = Boolean.TRUE.equals(oldTunnel.getMuxEnabled());
            // 删除链服务
            for (Node inNode : inNodes) {
                GostDto chainResult = GostUtil.DeleteChains(inNode.getId(), serviceName);
                if (!isGostOperationSuccess(chainResult)) {
                    log.info("删除链服务失败: {}", chainResult.getMsg());
                }
            }

            if (!muxEnabled) {
                List<Node> outNodes = oldNodeInfo.isHasError() ? resolveOutNodes(oldTunnel) : oldNodeInfo.getOutNodes();
                if (outNodes != null) {
                    for (Node outNode : outNodes) {
                        if (outNode == null) {
                            continue;
                        }
                        GostDto remoteResult = GostUtil.DeleteRemoteService(outNode.getId(), serviceName);
                        if (!isGostOperationSuccess(remoteResult)) {
                            log.info("删除远程服务失败: {}", remoteResult.getMsg());
                        }
                    }
                }
            }
        }

        return R.ok();
    }

    /**
     * 删除Gost服务
     */
    private R deleteGostServices(Forward forward, Tunnel tunnel, NodeInfo nodeInfo) {
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());
        List<Node> inNodes = filterOnlineNodes(extractInNodes(nodeInfo));
        if (inNodes.isEmpty()) {
            return R.ok();
        }

        // 删除主服务
        for (Node inNode : inNodes) {
            GostDto serviceResult = GostUtil.DeleteService(inNode.getId(), serviceName);
            if (!isGostOperationSuccess(serviceResult)) {
                return R.err(serviceResult.getMsg());
            }
        }

        // 隧道转发需要删除链和远程服务
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            boolean muxEnabled = Boolean.TRUE.equals(tunnel.getMuxEnabled());
            for (Node inNode : inNodes) {
                GostDto chainResult = GostUtil.DeleteChains(inNode.getId(), serviceName);
                if (!isGostOperationSuccess(chainResult)) {
                    return R.err(chainResult.getMsg());
                }
            }

            if (!muxEnabled) {
                R remoteResult = deleteRemoteServices(nodeInfo.getOutNodes(), serviceName);
                if (remoteResult.getCode() != 0) {
                    return remoteResult;
                }
            }
        }

        return R.ok();
    }

    /**
     * 创建链服务
     */
    private R createChainService(Node inNode, String serviceName, List<Node> outNodes, Integer outPort, String protocol, String interfaceName, boolean useSocks, String strategy) {
        String remoteAddr = buildOutNodeRemoteAddr(outNodes, outPort);
        if (StringUtils.isBlank(remoteAddr)) {
            return R.err("出口节点未配置有效端口");
        }
        GostDto result = GostUtil.AddChains(inNode.getId(), serviceName, remoteAddr, protocol, interfaceName, useSocks, strategy);
        return isGostOperationSuccess(result) ? R.ok() : R.err(result.getMsg());
    }

    /**
     * 创建远程服务
     */
    private R createRemoteServices(List<Node> outNodes, String serviceName, Forward forward, String protocol, String interfaceName) {
        if (outNodes == null || outNodes.isEmpty()) {
            return R.err("出口节点不存在");
        }
        for (Node outNode : outNodes) {
            GostDto result = GostUtil.AddRemoteService(outNode.getId(), serviceName, forward.getOutPort(), forward.getRemoteAddr(), protocol, forward.getStrategy(), interfaceName);
            if (!isGostOperationSuccess(result)) {
                return R.err(result.getMsg());
            }
        }
        return R.ok();
    }

    private R ensureMuxService(List<Node> outNodes, Tunnel tunnel, String interfaceName) {
        if (outNodes == null || outNodes.isEmpty()) {
            return R.err("出口节点不存在");
        }
        for (Node outNode : outNodes) {
            if (outNode.getOutPort() == null) {
                return R.err("出口共享端口未配置");
            }
            String muxServiceName = buildMuxServiceName(outNode.getId());
            GostDto updateResult = GostUtil.UpdateMuxService(outNode.getId(), muxServiceName, outNode.getOutPort(), tunnel.getProtocol(), interfaceName);
            if (updateResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                updateResult = GostUtil.AddMuxService(outNode.getId(), muxServiceName, outNode.getOutPort(), tunnel.getProtocol(), interfaceName);
            }
            if (!isGostOperationSuccess(updateResult)) {
                return R.err(updateResult.getMsg());
            }
        }
        return R.ok();
    }

    /**
     * 创建主服务
     */
    private R createMainService(Node inNode, String serviceName, Forward forward, Integer limiter, Integer tunnelType, Tunnel tunnel, String strategy, String interfaceName) {
        GostDto result = GostUtil.AddService(inNode.getId(), serviceName, forward.getInPort(), limiter, forward.getRemoteAddr(), tunnelType, tunnel, strategy, interfaceName);
        return isGostOperationSuccess(result) ? R.ok() : R.err(result.getMsg());
    }

    /**
     * 更新链服务
     */
    private R updateChainService(Node inNode, String serviceName, List<Node> outNodes, Integer outPort, String protocol, String interfaceName, boolean useSocks, String strategy) {
        String remoteAddr = buildOutNodeRemoteAddr(outNodes, outPort);
        if (StringUtils.isBlank(remoteAddr)) {
            return R.err("出口节点未配置有效端口");
        }
        GostDto createResult = GostUtil.UpdateChains(inNode.getId(), serviceName, remoteAddr, protocol, interfaceName, useSocks, strategy);
        if (createResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
            createResult = GostUtil.AddChains(inNode.getId(), serviceName, remoteAddr, protocol, interfaceName, useSocks, strategy);
        }
        return isGostOperationSuccess(createResult) ? R.ok() : R.err(createResult.getMsg());
    }

    /**
     * 更新远程服务
     */
    private R updateRemoteServices(List<Node> outNodes, String serviceName, Forward forward, String protocol, String interfaceName) {
        if (outNodes == null || outNodes.isEmpty()) {
            return R.err("出口节点不存在");
        }
        for (Node outNode : outNodes) {
            GostDto createResult = GostUtil.UpdateRemoteService(outNode.getId(), serviceName, forward.getOutPort(), forward.getRemoteAddr(), protocol, forward.getStrategy(), interfaceName);
            if (createResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                createResult = GostUtil.AddRemoteService(outNode.getId(), serviceName, forward.getOutPort(), forward.getRemoteAddr(), protocol, forward.getStrategy(), interfaceName);
            }
            if (!isGostOperationSuccess(createResult)) {
                return R.err(createResult.getMsg());
            }
        }
        return R.ok();
    }

    private R deleteRemoteServices(List<Node> outNodes, String serviceName) {
        if (outNodes == null || outNodes.isEmpty()) {
            return R.ok();
        }
        for (Node outNode : outNodes) {
            GostDto remoteResult = GostUtil.DeleteRemoteService(outNode.getId(), serviceName);
            if (!isGostOperationSuccess(remoteResult)) {
                return R.err(remoteResult.getMsg());
            }
        }
        return R.ok();
    }

    private String buildOutNodeRemoteAddr(List<Node> outNodes, Integer fallbackPort) {
        if (outNodes == null || outNodes.isEmpty()) {
            return "";
        }
        List<String> addresses = new ArrayList<>();
        for (Node outNode : outNodes) {
            if (outNode == null || outNode.getServerIp() == null) {
                continue;
            }
            Integer port = outNode.getOutPort() != null ? outNode.getOutPort() : fallbackPort;
            if (port == null) {
                continue;
            }
            String ip = outNode.getServerIp();
            String addr = ip.contains(":") ? "[" + ip + "]:" + port : ip + ":" + port;
            addresses.add(addr);
        }
        return String.join(",", addresses);
    }

    private int resolveOutNodePort(Tunnel tunnel, Forward forward, Node outNode) {
        if (Boolean.TRUE.equals(tunnel.getMuxEnabled()) && outNode != null && outNode.getOutPort() != null) {
            return outNode.getOutPort();
        }
        if (forward != null && forward.getOutPort() != null) {
            return forward.getOutPort();
        }
        if (outNode != null && outNode.getOutPort() != null) {
            return outNode.getOutPort();
        }
        return -1;
    }

    /**
     * 更新主服务
     */
    private R updateMainService(Node inNode, String serviceName, Forward forward, Integer limiter, Integer tunnelType, Tunnel tunnel, String strategy, String interfaceName) {
        GostDto result = GostUtil.UpdateService(inNode.getId(), serviceName, forward.getInPort(), limiter, forward.getRemoteAddr(), tunnelType, tunnel, strategy, interfaceName);

        if (result.getMsg().contains(GOST_NOT_FOUND_MSG)) {
            result = GostUtil.AddService(inNode.getId(), serviceName, forward.getInPort(), limiter, forward.getRemoteAddr(), tunnelType, tunnel, strategy, interfaceName);
        }

        return isGostOperationSuccess(result) ? R.ok() : R.err(result.getMsg());
    }

    private String buildMuxServiceName(Long nodeId) {
        return "node_mux_" + nodeId;
    }

    /**
     * 更新转发状态为错误
     */
    private void updateForwardStatusToError(Forward forward) {
        forward.setStatus(FORWARD_STATUS_ERROR);
        this.updateById(forward);
    }

    private Integer getUserLimiter(Integer userId) {
        if (userId == null) {
            return null;
        }
        User user = userService.getById(userId);
        if (user == null) {
            return null;
        }
        return user.getSpeedId();
    }

    private R ensureLimiterOnNodes(List<Node> inNodes, Integer limiterId) {
        if (limiterId == null) {
            return R.ok();
        }
        List<Node> onlineNodes = filterOnlineNodes(inNodes);
        if (onlineNodes.isEmpty()) {
            return R.ok();
        }
        SpeedLimit speedLimit = speedLimitService.getById(limiterId);
        if (speedLimit == null) {
            return R.err("限速规则不存在");
        }
        String speedInMBps = convertBitsToMBps(speedLimit.getSpeed());
        for (Node inNode : onlineNodes) {
            GostDto updateResult = GostUtil.UpdateLimiters(inNode.getId(), speedLimit.getId(), speedInMBps);
            if (updateResult != null && updateResult.getMsg() != null && updateResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                GostDto addResult = GostUtil.AddLimiters(inNode.getId(), speedLimit.getId(), speedInMBps);
                if (!isGostOperationSuccess(addResult)) {
                    return R.err("创建限速器失败：" + addResult.getMsg());
                }
            } else if (!isGostOperationSuccess(updateResult)) {
                return R.err("更新限速器失败：" + (updateResult != null ? updateResult.getMsg() : "未知错误"));
            }
        }
        return R.ok();
    }

    private String convertBitsToMBps(Integer speedInBits) {
        if (speedInBits == null) {
            return "0";
        }
        double mbs = speedInBits / 8.0;
        BigDecimal bd = new BigDecimal(mbs).setScale(1, RoundingMode.HALF_UP);
        return bd.doubleValue() + "";
    }

    /**
     * 检查隧道是否发生变化
     */
    private boolean isTunnelChanged(Forward existForward, ForwardUpdateDto updateDto) {
        return !existForward.getTunnelId().equals(updateDto.getTunnelId());
    }

    /**
     * 检查Gost操作是否成功
     */
    private boolean isGostOperationSuccess(GostDto gostResult) {
        return Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }


    /**
     * 检查指定的入口端口是否可用（可排除指定的转发ID）
     */
    private boolean isInPortAvailable(Tunnel tunnel, Integer port, Long excludeForwardId) {
        // 获取入口节点信息
        Node inNode = nodeService.getNodeById(tunnel.getInNodeId());
        if (inNode == null) {
            return false;
        }

        // 检查端口是否在节点允许的范围内
        if (port < inNode.getPortSta() || port > inNode.getPortEnd()) {
            return false;
        }

        // 获取该节点上所有已被占用的端口（包括作为入口和出口使用的端口）
        Set<Integer> usedPorts = getAllUsedPortsOnNode(tunnel.getInNodeId(), excludeForwardId);

        // 检查端口是否已被占用（在节点级别检查，考虑入口和出口端口）
        return !usedPorts.contains(port);
    }

    /**
     * 为隧道分配一个可用的入口端口（可排除指定的转发ID）
     */
    private Integer allocateInPort(Tunnel tunnel, Long excludeForwardId) {
        return allocatePortForNode(tunnel.getInNodeId(), excludeForwardId);
    }

    /**
     * 为隧道分配一个可用的出口端口（可排除指定的转发ID）
     */
    private Integer allocateOutPort(Tunnel tunnel, Long excludeForwardId) {
        Long outNodeId = tunnel.getOutNodeId();
        if (outNodeId == null) {
            List<Node> outNodes = resolveOutNodes(tunnel);
            if (!outNodes.isEmpty()) {
                outNodeId = outNodes.get(0).getId();
            }
        }
        return allocatePortForNode(outNodeId, excludeForwardId);
    }

    private boolean tunnelUsesInNode(Tunnel tunnel, Long nodeId) {
        if (tunnel == null || nodeId == null) {
            return false;
        }
        if (Objects.equals(tunnel.getInNodeId(), nodeId)) {
            return true;
        }
        if (StringUtils.isBlank(tunnel.getInNodeIds())) {
            return false;
        }
        for (String part : tunnel.getInNodeIds().split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                if (Objects.equals(Long.parseLong(trimmed), nodeId)) {
                    return true;
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return false;
    }

    private boolean tunnelUsesOutNode(Tunnel tunnel, Long nodeId) {
        if (tunnel == null || nodeId == null) {
            return false;
        }
        if (Objects.equals(tunnel.getOutNodeId(), nodeId)) {
            return true;
        }
        if (StringUtils.isBlank(tunnel.getOutNodeIds())) {
            return false;
        }
        for (String part : tunnel.getOutNodeIds().split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                if (Objects.equals(Long.parseLong(trimmed), nodeId)) {
                    return true;
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return false;
    }

    private boolean tunnelUsesNode(Tunnel tunnel, Long nodeId) {
        return tunnelUsesInNode(tunnel, nodeId) || tunnelUsesOutNode(tunnel, nodeId);
    }

    private void syncForwardConfig(Forward forward, Tunnel tunnel) {
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            return;
        }
        Integer limiter = getUserLimiter(forward.getUserId());
        R limiterResult = ensureLimiterOnNodes(nodeInfo.getInNodes(), limiter);
        if (limiterResult.getCode() != 0) {
            updateForwardStatusToError(forward);
            return;
        }
        R updateResult = updateGostServices(forward, tunnel, limiter, nodeInfo);
        if (updateResult.getCode() != 0) {
            updateForwardStatusToError(forward);
            return;
        }
        if (forward.getStatus() == null || forward.getStatus() != FORWARD_STATUS_ACTIVE) {
            forward.setStatus(FORWARD_STATUS_ACTIVE);
            forward.setUpdatedTime(System.currentTimeMillis());
            this.updateById(forward);
        }
    }

    private void syncOutNodeForward(Forward forward, Tunnel tunnel, Node outNode) {
        if (forward == null || tunnel == null || outNode == null) {
            return;
        }
        if (outNode.getStatus() == null || outNode.getStatus() != NODE_STATUS_ONLINE) {
            return;
        }
        if (tunnel.getType() == null || tunnel.getType() != TUNNEL_TYPE_TUNNEL_FORWARD) {
            return;
        }
        if (Boolean.TRUE.equals(tunnel.getMuxEnabled())) {
            return;
        }
        String serviceName = buildServiceName(forward.getId(), forward.getUserId());
        R remoteResult = updateRemoteServices(Collections.singletonList(outNode), serviceName, forward, tunnel.getProtocol(), forward.getInterfaceName());
        if (remoteResult.getCode() != 0) {
            log.info("节点{}上线同步出口服务失败: {}", outNode.getId(), remoteResult.getMsg());
        }
    }

    /**
     * 为指定节点分配一个可用端口（通用方法）
     *
     * @param nodeId           节点ID
     * @param excludeForwardId 要排除的转发ID
     * @return 可用端口号，如果没有可用端口则返回null
     */
    private Integer allocatePortForNode(Long nodeId, Long excludeForwardId) {
        // 获取节点信息
        Node node = nodeService.getNodeById(nodeId);
        if (node == null) {
            return null;
        }

        // 获取该节点上所有已被占用的端口（包括作为入口和出口使用的端口）
        Set<Integer> usedPorts = getAllUsedPortsOnNode(nodeId, excludeForwardId);

        // 在节点端口范围内寻找未使用的端口
        for (int port = node.getPortSta(); port <= node.getPortEnd(); port++) {
            if (!usedPorts.contains(port)) {
                return port;
            }
        }
        return null;
    }

    /**
     * 获取指定节点上所有已被占用的端口（包括入口和出口端口）
     *
     * @param nodeId           节点ID
     * @param excludeForwardId 要排除的转发ID
     * @return 已占用的端口集合
     */
    private Set<Integer> getAllUsedPortsOnNode(Long nodeId, Long excludeForwardId) {
        Set<Integer> usedPorts = new HashSet<>();

        // 1. 收集该节点作为入口时占用的端口
        List<Tunnel> inTunnels = tunnelService.list(new QueryWrapper<Tunnel>().eq("in_node_id", nodeId));
        if (!inTunnels.isEmpty()) {
            Set<Long> inTunnelIds = inTunnels.stream()
                    .map(Tunnel::getId)
                    .collect(Collectors.toSet());

            QueryWrapper<Forward> inQueryWrapper = new QueryWrapper<Forward>().in("tunnel_id", inTunnelIds);
            if (excludeForwardId != null) {
                inQueryWrapper.ne("id", excludeForwardId);
            }

            List<Forward> inForwards = this.list(inQueryWrapper);
            for (Forward forward : inForwards) {
                if (forward.getInPort() != null) {
                    usedPorts.add(forward.getInPort());
                }
            }
        }

        // 2. 收集该节点作为出口时占用的端口
        List<Tunnel> outTunnels = tunnelService.list(new QueryWrapper<Tunnel>().eq("type", TUNNEL_TYPE_TUNNEL_FORWARD));
        List<Tunnel> matchedOutTunnels = outTunnels.stream()
                .filter(tunnel -> resolveOutNodes(tunnel).stream().anyMatch(node -> Objects.equals(node.getId(), nodeId)))
                .collect(Collectors.toList());
        if (!matchedOutTunnels.isEmpty()) {
            Set<Long> outTunnelIds = matchedOutTunnels.stream()
                    .map(Tunnel::getId)
                    .collect(Collectors.toSet());

            QueryWrapper<Forward> outQueryWrapper = new QueryWrapper<Forward>().in("tunnel_id", outTunnelIds);
            if (excludeForwardId != null) {
                outQueryWrapper.ne("id", excludeForwardId);
            }

            List<Forward> outForwards = this.list(outQueryWrapper);
            for (Forward forward : outForwards) {
                if (forward.getOutPort() != null) {
                    usedPorts.add(forward.getOutPort());
                }
            }
            for (Tunnel tunnel : matchedOutTunnels) {
                if (Boolean.TRUE.equals(tunnel.getMuxEnabled()) && tunnel.getMuxPort() != null) {
                    usedPorts.add(tunnel.getMuxPort());
                }
            }
        }

        return usedPorts;
    }


    /**
     * 构建服务名称，优化后减少重复查询
     */
    private String buildServiceName(Long forwardId, Integer userId) {
        return forwardId + "_" + userId + "_0";
    }

    @Override
    @Async
    public void syncNodeConfig(Long nodeId) {
        if (nodeId == null) {
            return;
        }
        Node node = nodeService.getById(nodeId);
        if (node == null || node.getStatus() == null || node.getStatus() != NODE_STATUS_ONLINE) {
            return;
        }

        List<Tunnel> tunnels = tunnelService.list();
        if (tunnels.isEmpty()) {
            return;
        }
        Map<Integer, Tunnel> matchedTunnels = new LinkedHashMap<>();
        for (Tunnel tunnel : tunnels) {
            if (tunnel == null || tunnel.getId() == null) {
                continue;
            }
            if (tunnelUsesNode(tunnel, nodeId)) {
                matchedTunnels.put(tunnel.getId().intValue(), tunnel);
            }
        }
        if (matchedTunnels.isEmpty()) {
            return;
        }

        List<Integer> tunnelIds = new ArrayList<>(matchedTunnels.keySet());
        List<Forward> forwards = this.list(new QueryWrapper<Forward>().in("tunnel_id", tunnelIds));
        for (Forward forward : forwards) {
            if (forward == null) {
                continue;
            }
            Tunnel tunnel = matchedTunnels.get(forward.getTunnelId());
            if (tunnel == null) {
                continue;
            }
            if (tunnel.getStatus() == null || tunnel.getStatus() != TUNNEL_STATUS_ACTIVE) {
                continue;
            }
            if (forward.getStatus() != null && forward.getStatus() == FORWARD_STATUS_PAUSED) {
                continue;
            }
            boolean usesIn = tunnelUsesInNode(tunnel, nodeId);
            boolean usesOut = tunnelUsesOutNode(tunnel, nodeId);
            if (usesIn) {
                syncForwardConfig(forward, tunnel);
            } else if (usesOut) {
                syncOutNodeForward(forward, tunnel, node);
            }
        }

        for (Tunnel tunnel : matchedTunnels.values()) {
            if (tunnel == null || tunnel.getId() == null) {
                continue;
            }
            if (tunnel.getType() == null || tunnel.getType() != TUNNEL_TYPE_TUNNEL_FORWARD) {
                continue;
            }
            if (!Boolean.TRUE.equals(tunnel.getMuxEnabled())) {
                continue;
            }
            if (!tunnelUsesOutNode(tunnel, nodeId)) {
                continue;
            }
            List<Node> outNodes = filterOnlineNodes(resolveOutNodes(tunnel));
            if (outNodes.isEmpty()) {
                continue;
            }
            R muxResult = ensureMuxService(outNodes, tunnel, tunnel.getInterfaceName());
            if (muxResult.getCode() != 0) {
                log.info("节点{}上线同步多路复用失败: {}", nodeId, muxResult.getMsg());
            }
        }
    }


    public void updateForwardA(Forward forward) {
        Tunnel tunnel = validateTunnel(forward.getTunnelId());
        if (tunnel == null) {
            return;
        }
        NodeInfo nodeInfo = getRequiredNodes(tunnel);
        if (nodeInfo.isHasError()) {
            return;
        }
        Integer limiter = getUserLimiter(forward.getUserId());
        ensureLimiterOnNodes(nodeInfo.getInNodes(), limiter);
        updateGostServices(forward, tunnel, limiter, nodeInfo);
    }

    @Override
    public R rebuildForwardsForTunnelUpdate(Tunnel oldTunnel, Tunnel newTunnel) {
        if (oldTunnel == null || newTunnel == null) {
            return R.err("隧道信息不完整，无法重建转发规则");
        }

        List<Forward> forwards = this.list(new QueryWrapper<Forward>().eq("tunnel_id", newTunnel.getId()));
        if (forwards.isEmpty()) {
            return R.ok();
        }

        NodeInfo nodeInfo = getRequiredNodes(newTunnel);
        if (nodeInfo.isHasError()) {
            return R.err(nodeInfo.getErrorMessage());
        }

        List<Node> newInNodes = resolveInNodes(newTunnel);
        List<Node> onlineInNodes = filterOnlineNodes(newInNodes);
        List<Node> newOutNodes = newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD ? resolveOutNodes(newTunnel) : Collections.emptyList();

        List<Node> oldInNodes = resolveInNodes(oldTunnel);
        List<Node> oldOutNodes = oldTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD ? resolveOutNodes(oldTunnel) : Collections.emptyList();

        Map<Long, String> serviceNames = new LinkedHashMap<>();
        for (Forward forward : forwards) {
            serviceNames.put(forward.getId(), buildServiceName(forward.getId(), forward.getUserId()));
        }

        boolean oldMuxEnabled = oldTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && Boolean.TRUE.equals(oldTunnel.getMuxEnabled());
        boolean newMuxEnabled = newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && Boolean.TRUE.equals(newTunnel.getMuxEnabled());

        deleteOldServicesBatch(oldInNodes, oldOutNodes, serviceNames.values(), oldTunnel.getType(), oldMuxEnabled);

        if (onlineInNodes.isEmpty()) {
            for (Forward forward : forwards) {
                updateForwardStatusToError(forward);
            }
            return R.err("入口节点当前离线，请确保节点正常运行");
        }

        if (newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && newMuxEnabled) {
            R muxResult = ensureMuxService(newOutNodes, newTunnel, newTunnel.getInterfaceName());
            if (muxResult.getCode() != 0) {
                for (Forward forward : forwards) {
                    updateForwardStatusToError(forward);
                }
                return R.err(muxResult.getMsg());
            }
        }

        Integer muxPort = null;
        if (newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && newMuxEnabled) {
            if (!newOutNodes.isEmpty() && newOutNodes.get(0).getOutPort() != null) {
                muxPort = newOutNodes.get(0).getOutPort();
            } else {
                muxPort = newTunnel.getMuxPort();
            }
        }

        Map<Long, Integer> limiterByForwardId = new HashMap<>();
        Map<Integer, List<Long>> limiterToForwardIds = new HashMap<>();
        for (Forward forward : forwards) {
            if (muxPort != null) {
                forward.setOutPort(muxPort);
            }
            Integer limiter = getUserLimiter(forward.getUserId());
            limiterByForwardId.put(forward.getId(), limiter);
            if (limiter != null) {
                limiterToForwardIds.computeIfAbsent(limiter, key -> new ArrayList<>()).add(forward.getId());
            }
        }

        Set<Long> failedForwardIds = new HashSet<>();
        for (Map.Entry<Integer, List<Long>> entry : limiterToForwardIds.entrySet()) {
            R limiterResult = ensureLimiterOnNodes(onlineInNodes, entry.getKey());
            if (limiterResult.getCode() != 0) {
                failedForwardIds.addAll(entry.getValue());
                log.info("批量更新限速器失败: {}", limiterResult.getMsg());
            }
        }

        if (newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            for (Forward forward : forwards) {
                if (failedForwardIds.contains(forward.getId())) {
                    continue;
                }
                String serviceName = serviceNames.get(forward.getId());
                if (serviceName == null) {
                    continue;
                }
                for (Node inNode : onlineInNodes) {
                    if (inNode == null || inNode.getId() == null) {
                        continue;
                    }
                    R chainResult = createChainService(inNode, serviceName, newOutNodes, forward.getOutPort(), newTunnel.getProtocol(), newTunnel.getInterfaceName(), newMuxEnabled, newTunnel.getOutStrategy());
                    if (chainResult.getCode() != 0) {
                        for (Node cleanupNode : onlineInNodes) {
                            if (cleanupNode == null || cleanupNode.getId() == null) {
                                continue;
                            }
                            GostUtil.DeleteChains(cleanupNode.getId(), serviceName);
                        }
                        if (!newMuxEnabled) {
                            deleteRemoteServices(newOutNodes, serviceName);
                        }
                        failedForwardIds.add(forward.getId());
                        break;
                    }
                }
            }
        }

        if (newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD && !newMuxEnabled) {
            Map<Long, List<ServicePayload>> remotePayloads = new LinkedHashMap<>();
            for (Forward forward : forwards) {
                if (failedForwardIds.contains(forward.getId())) {
                    continue;
                }
                String serviceName = serviceNames.get(forward.getId());
                if (serviceName == null) {
                    continue;
                }
                for (Node outNode : newOutNodes) {
                    if (outNode == null || outNode.getId() == null) {
                        continue;
                    }
                    JSONObject config = GostUtil.buildRemoteServiceConfig(serviceName, forward.getOutPort(), forward.getRemoteAddr(), newTunnel.getProtocol(), forward.getStrategy(), forward.getInterfaceName());
                    remotePayloads.computeIfAbsent(outNode.getId(), key -> new ArrayList<>())
                            .add(new ServicePayload(forward.getId(), config));
                }
            }
            Set<Long> failedBeforeRemote = new HashSet<>(failedForwardIds);
            sendServiceBatches(remotePayloads, failedForwardIds, "出口服务");
            Set<Long> remoteFailures = new HashSet<>(failedForwardIds);
            remoteFailures.removeAll(failedBeforeRemote);
            cleanupForwardResources(remoteFailures, serviceNames, onlineInNodes, newOutNodes, newMuxEnabled, false, true);
        }

        Map<Long, List<ServicePayload>> mainPayloads = new LinkedHashMap<>();
        for (Forward forward : forwards) {
            if (failedForwardIds.contains(forward.getId())) {
                continue;
            }
            String serviceName = serviceNames.get(forward.getId());
            if (serviceName == null) {
                continue;
            }
            Integer limiter = limiterByForwardId.get(forward.getId());
            String interfaceName = newTunnel.getType() != TUNNEL_TYPE_TUNNEL_FORWARD ? forward.getInterfaceName() : null;
            for (Node inNode : onlineInNodes) {
                if (inNode == null || inNode.getId() == null) {
                    continue;
                }
                JSONObject tcpConfig = GostUtil.buildServiceConfig(serviceName, forward.getInPort(), limiter, forward.getRemoteAddr(), "tcp", newTunnel.getType(), newTunnel, forward.getStrategy(), interfaceName);
                JSONObject udpConfig = GostUtil.buildServiceConfig(serviceName, forward.getInPort(), limiter, forward.getRemoteAddr(), "udp", newTunnel.getType(), newTunnel, forward.getStrategy(), interfaceName);
                List<ServicePayload> payloads = mainPayloads.computeIfAbsent(inNode.getId(), key -> new ArrayList<>());
                payloads.add(new ServicePayload(forward.getId(), tcpConfig));
                payloads.add(new ServicePayload(forward.getId(), udpConfig));
            }
        }
        Set<Long> failedBeforeMain = new HashSet<>(failedForwardIds);
        sendServiceBatches(mainPayloads, failedForwardIds, "入口服务");
        Set<Long> mainFailures = new HashSet<>(failedForwardIds);
        mainFailures.removeAll(failedBeforeMain);
        cleanupForwardResources(mainFailures, serviceNames, onlineInNodes, newOutNodes, newMuxEnabled, true, newTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD);

        for (Forward forward : forwards) {
            if (failedForwardIds.contains(forward.getId())) {
                forward.setStatus(FORWARD_STATUS_ERROR);
            } else {
                forward.setStatus(FORWARD_STATUS_ACTIVE);
            }
            this.updateById(forward);
        }

        if (!failedForwardIds.isEmpty()) {
            return R.err("入口节点已更新，但部分转发规则重建失败");
        }

        return R.ok();
    }

    private void deleteOldServicesBatch(List<Node> oldInNodes, List<Node> oldOutNodes, Collection<String> baseServiceNames, Integer tunnelType, boolean muxEnabled) {
        if (baseServiceNames == null || baseServiceNames.isEmpty()) {
            return;
        }
        List<String> mainServiceNames = new ArrayList<>(baseServiceNames.size() * 2);
        for (String baseServiceName : baseServiceNames) {
            if (baseServiceName == null) {
                continue;
            }
            mainServiceNames.add(baseServiceName + "_tcp");
            mainServiceNames.add(baseServiceName + "_udp");
        }
        if (oldInNodes != null && !oldInNodes.isEmpty()) {
            for (Node node : oldInNodes) {
                if (node == null || node.getId() == null) {
                    continue;
                }
                batchDeleteServiceNames(node.getId(), mainServiceNames);
            }
        }

        if (tunnelType != null && tunnelType == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (oldInNodes != null && !oldInNodes.isEmpty()) {
                for (String baseServiceName : baseServiceNames) {
                    if (baseServiceName == null) {
                        continue;
                    }
                    for (Node node : oldInNodes) {
                        if (node == null || node.getId() == null) {
                            continue;
                        }
                        GostDto chainResult = GostUtil.DeleteChains(node.getId(), baseServiceName);
                        if (!isGostOperationSuccess(chainResult)) {
                            log.info("删除旧链服务失败: {}", chainResult.getMsg());
                        }
                    }
                }
            }

            if (!muxEnabled && oldOutNodes != null && !oldOutNodes.isEmpty()) {
                List<String> remoteServiceNames = new ArrayList<>(baseServiceNames.size());
                for (String baseServiceName : baseServiceNames) {
                    if (baseServiceName == null) {
                        continue;
                    }
                    remoteServiceNames.add(baseServiceName + "_tls");
                }
                for (Node node : oldOutNodes) {
                    if (node == null || node.getId() == null) {
                        continue;
                    }
                    batchDeleteServiceNames(node.getId(), remoteServiceNames);
                }
            }
        }
    }

    private void batchDeleteServiceNames(Long nodeId, List<String> serviceNames) {
        if (nodeId == null || serviceNames == null || serviceNames.isEmpty()) {
            return;
        }
        for (int start = 0; start < serviceNames.size(); start += SERVICE_BATCH_SIZE) {
            int end = Math.min(start + SERVICE_BATCH_SIZE, serviceNames.size());
            List<String> batch = serviceNames.subList(start, end);
            GostDto deleteResult = GostUtil.DeleteServices(nodeId, batch);
            if (!isGostOperationSuccess(deleteResult)) {
                log.info("删除服务失败: {}", deleteResult.getMsg());
            }
        }
    }

    private void sendServiceBatches(Map<Long, List<ServicePayload>> payloadsByNode, Set<Long> failedForwardIds, String label) {
        if (payloadsByNode == null || payloadsByNode.isEmpty()) {
            return;
        }
        String logLabel = label == null ? "服务" : label;
        for (Map.Entry<Long, List<ServicePayload>> entry : payloadsByNode.entrySet()) {
            Long nodeId = entry.getKey();
            if (nodeId == null) {
                continue;
            }
            List<ServicePayload> payloads = entry.getValue();
            if (payloads == null || payloads.isEmpty()) {
                continue;
            }
            for (int start = 0; start < payloads.size(); start += SERVICE_BATCH_SIZE) {
                int end = Math.min(start + SERVICE_BATCH_SIZE, payloads.size());
                JSONArray services = new JSONArray();
                Set<Long> batchForwardIds = new HashSet<>();
                for (ServicePayload payload : payloads.subList(start, end)) {
                    if (payload == null || payload.getConfig() == null) {
                        continue;
                    }
                    services.add(payload.getConfig());
                    if (payload.getForwardId() != null) {
                        batchForwardIds.add(payload.getForwardId());
                    }
                }
                if (services.isEmpty()) {
                    continue;
                }
                GostDto addResult = GostUtil.AddServices(nodeId, services);
                if (addResult == null || !isGostOperationSuccess(addResult)) {
                    GostDto updateResult = GostUtil.UpdateServices(nodeId, services);
                    if (updateResult == null || !isGostOperationSuccess(updateResult)) {
                        failedForwardIds.addAll(batchForwardIds);
                        String msg = updateResult != null ? updateResult.getMsg()
                                : (addResult != null ? addResult.getMsg() : "未知错误");
                        log.info("{}批量下发失败: {}", logLabel, msg);
                    }
                }
            }
        }
    }

    private void cleanupForwardResources(Set<Long> forwardIds, Map<Long, String> serviceNames, List<Node> inNodes, List<Node> outNodes, boolean muxEnabled, boolean deleteMainServices, boolean isTunnelForward) {
        if (forwardIds == null || forwardIds.isEmpty()) {
            return;
        }
        for (Long forwardId : forwardIds) {
            String serviceName = serviceNames.get(forwardId);
            if (serviceName == null) {
                continue;
            }
            if (deleteMainServices && inNodes != null && !inNodes.isEmpty()) {
                List<String> mainServices = Arrays.asList(serviceName + "_tcp", serviceName + "_udp");
                for (Node inNode : inNodes) {
                    if (inNode == null || inNode.getId() == null) {
                        continue;
                    }
                    batchDeleteServiceNames(inNode.getId(), mainServices);
                }
            }
            if (isTunnelForward) {
                if (inNodes != null && !inNodes.isEmpty()) {
                    for (Node inNode : inNodes) {
                        if (inNode == null || inNode.getId() == null) {
                            continue;
                        }
                        GostUtil.DeleteChains(inNode.getId(), serviceName);
                    }
                }
                if (!muxEnabled) {
                    deleteRemoteServices(outNodes, serviceName);
                }
            }
        }
    }


    // ========== 内部数据类 ==========

    @Data
    private static class ServicePayload {
        private final Long forwardId;
        private final JSONObject config;
    }

    /**
     * 用户信息封装类
     */
    @Data
    private static class UserInfo {
        private final Integer userId;
        private final Integer roleId;
        private final String userName;
    }

    /**
     * 用户权限检查结果
     */
    @Data
    private static class UserPermissionResult {
        private final boolean hasError;
        private final String errorMessage;
        private final Integer limiter;

        private UserPermissionResult(boolean hasError, String errorMessage, Integer limiter) {
            this.hasError = hasError;
            this.errorMessage = errorMessage;
            this.limiter = limiter;
        }

        public static UserPermissionResult success(Integer limiter) {
            return new UserPermissionResult(false, null, limiter);
        }

        public static UserPermissionResult error(String errorMessage) {
            return new UserPermissionResult(true, errorMessage, null);
        }
    }

    /**
     * 端口分配结果
     */
    @Data
    private static class PortAllocation {
        private final boolean hasError;
        private final String errorMessage;
        private final Integer inPort;
        private final Integer outPort;

        private PortAllocation(boolean hasError, String errorMessage, Integer inPort, Integer outPort) {
            this.hasError = hasError;
            this.errorMessage = errorMessage;
            this.inPort = inPort;
            this.outPort = outPort;
        }

        public static PortAllocation success(Integer inPort, Integer outPort) {
            return new PortAllocation(false, null, inPort, outPort);
        }

        public static PortAllocation error(String errorMessage) {
            return new PortAllocation(true, errorMessage, null, null);
        }
    }

    /**
     * 节点信息封装类
     */
    @Data
    private static class NodeInfo {
        private final boolean hasError;
        private final String errorMessage;
        private final List<Node> inNodes;
        private final Node inNode;
        private final List<Node> outNodes;
        private final Node outNode;

        private NodeInfo(boolean hasError, String errorMessage, List<Node> inNodes, List<Node> outNodes) {
            this.hasError = hasError;
            this.errorMessage = errorMessage;
            this.inNodes = inNodes;
            this.inNode = (inNodes == null || inNodes.isEmpty()) ? null : inNodes.get(0);
            this.outNodes = outNodes;
            this.outNode = (outNodes == null || outNodes.isEmpty()) ? null : outNodes.get(0);
        }

        public static NodeInfo success(List<Node> inNodes, List<Node> outNodes) {
            return new NodeInfo(false, null, inNodes, outNodes);
        }

        public static NodeInfo error(String errorMessage) {
            return new NodeInfo(true, errorMessage, null, null);
        }
    }

    /**
     * 诊断结果数据类
     */
    @Data
    public static class DiagnosisResult {
        private Long nodeId;
        private String nodeName;
        private String targetIp;
        private Integer targetPort;
        private String description;
        private boolean success;
        private String message;
        private double averageTime;
        private double packetLoss;
        private long timestamp;
    }
}
