package com.admin.service.impl;

import cn.hutool.core.util.StrUtil;
import com.admin.common.dto.*;

import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.JwtUtil;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.Forward;
import com.admin.entity.Node;
import com.admin.entity.Tunnel;
import com.admin.entity.UserNode;
import com.admin.mapper.TunnelMapper;
import com.admin.service.ForwardService;
import com.admin.service.NodeService;
import com.admin.service.TunnelService;
import com.admin.service.UserNodeService;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.Data;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * <p>
 * 隧道服务实现类
 * 提供隧道的增删改查功能，包括隧道创建、删除和用户权限管理
 * 支持端口转发和隧道转发两种模式
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
@Service
public class TunnelServiceImpl extends ServiceImpl<TunnelMapper, Tunnel> implements TunnelService {
    private static final String GOST_SUCCESS_MSG = "OK";
    private static final String GOST_NOT_FOUND_MSG = "not found";

    // ========== 常量定义 ==========
    
    /** 隧道类型常量 */
    private static final int TUNNEL_TYPE_PORT_FORWARD = 1;  // 端口转发
    private static final int TUNNEL_TYPE_TUNNEL_FORWARD = 2; // 隧道转发
    
    /** 隧道状态常量 */
    private static final int TUNNEL_STATUS_ACTIVE = 1;      // 启用状态
    
    /** 节点状态常量 */
    private static final int NODE_STATUS_ONLINE = 1;        // 节点在线状态
    
    /** 用户角色常量 */
    private static final int ADMIN_ROLE_ID = 0;             // 管理员角色ID

    /** 用户节点权限类型 */
    private static final int ACCESS_TYPE_BOTH = 0;
    private static final int ACCESS_TYPE_IN = 1;
    private static final int ACCESS_TYPE_OUT = 2;
    
    /** 成功响应消息 */
    private static final String SUCCESS_CREATE_MSG = "隧道创建成功";
    private static final String SUCCESS_DELETE_MSG = "隧道删除成功";
    
    /** 错误响应消息 */
    private static final String ERROR_CREATE_MSG = "隧道创建失败";
    private static final String ERROR_DELETE_MSG = "隧道删除失败";
    private static final String ERROR_TUNNEL_NOT_FOUND = "隧道不存在";
    private static final String ERROR_TUNNEL_NAME_EXISTS = "隧道名称已存在";
    private static final String ERROR_IN_NODE_NOT_FOUND = "入口节点不存在";
    private static final String ERROR_OUT_NODE_NOT_FOUND = "出口节点不存在";
    private static final String ERROR_OUT_NODE_REQUIRED = "出口节点不能为空";
    private static final String ERROR_OUT_PORT_REQUIRED = "出口端口不能为空";
    private static final String ERROR_SAME_NODE_NOT_ALLOWED = "隧道转发模式下，入口和出口不能是同一个节点";
    private static final String ERROR_IN_PORT_RANGE_INVALID = "入口端口开始不能大于结束端口";
    private static final String ERROR_OUT_PORT_RANGE_INVALID = "出口端口开始不能大于结束端口";
    private static final String ERROR_NO_AVAILABLE_TUNNELS = "暂无可用隧道";
    private static final String ERROR_IN_NODE_OFFLINE = "入口节点当前离线，请确保节点正常运行";
    private static final String ERROR_OUT_NODE_OFFLINE = "出口节点当前离线，请确保节点正常运行";
    private static final String ERROR_OUT_NODE_MULTI_NOT_SUPPORTED = "暂不支持多个出口节点";
    private static final String ERROR_MUX_PORT_ALLOCATE_FAILED = "多路复用端口已满，无法分配新端口";
    private static final String DEFAULT_OUT_STRATEGY = "fifo";
    private static final Set<String> SUPPORTED_OUT_STRATEGIES = new HashSet<>(Arrays.asList("fifo", "round", "random", "hash"));
    
    /** 使用检查相关消息 */
    private static final String ERROR_FORWARDS_IN_USE = "该隧道还有 %d 个转发在使用，请先删除相关转发";

    // ========== 依赖注入 ==========
    
    @Resource
    NodeService nodeService;
    
    @Resource
    ForwardService forwardService;

    @Resource
    UserNodeService userNodeService;

    // ========== 公共接口实现 ==========

    /**
     * 创建隧道
     * 支持端口转发和隧道转发两种模式
     * 
     * @param tunnelDto 隧道创建数据传输对象
     * @return 创建结果响应
     */
    @Override
    public R createTunnel(TunnelDto tunnelDto) {
        UserInfo currentUser = getCurrentUserInfo();
        // 1. 验证隧道名称唯一性
        R nameValidationResult = validateTunnelNameUniqueness(tunnelDto.getName());
        if (nameValidationResult.getCode() != 0) {
            return nameValidationResult;
        }

        // 2. 验证隧道转发类型的必要参数
        if (tunnelDto.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            R tunnelForwardValidationResult = validateTunnelForwardCreate(tunnelDto);
            if (tunnelForwardValidationResult.getCode() != 0) {
                return tunnelForwardValidationResult;
            }
        }

        // 3. 验证入口节点
        List<Long> inNodeIds = resolveInNodeIds(tunnelDto.getInNodeIds(), tunnelDto.getInNodeId());
        if (inNodeIds.isEmpty()) {
            return R.err("入口节点不能为空");
        }
        NodeValidationResult inNodeValidation = validateInNodes(inNodeIds);
        if (inNodeValidation.isHasError()) {
            return R.err(inNodeValidation.getErrorMessage());
        }
        List<Long> outNodeIds = resolveOutNodeIds(tunnelDto.getOutNodeIds(), tunnelDto.getOutNodeId());
        NodeValidationResult outNodeValidation = null;
        if (tunnelDto.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            outNodeValidation = validateOutNodes(outNodeIds);
            if (outNodeValidation.isHasError()) {
                return R.err(outNodeValidation.getErrorMessage());
            }
        }

        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            R accessResult = validateUserNodeAccess(currentUser.getUserId(), inNodeValidation.getNodes(),
                    outNodeValidation != null ? outNodeValidation.getNodes() : Collections.emptyList());
            if (accessResult.getCode() != 0) {
                return accessResult;
            }
        }

        // 4. 构建隧道实体
        Tunnel tunnel = buildTunnelEntity(tunnelDto, inNodeValidation.getNodes());
        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            tunnel.setOwnerId(currentUser.getUserId().longValue());
        }

        // 5. 根据隧道类型设置出口参数
        R outNodeSetupResult = setupOutNodeParameters(tunnel, tunnelDto, inNodeValidation.getNodes().get(0).getServerIp(), inNodeIds,
                outNodeValidation != null ? outNodeValidation.getNodes() : Collections.emptyList());
        if (outNodeSetupResult.getCode() != 0) {
            return outNodeSetupResult;
        }
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            List<Node> outNodes = outNodeValidation != null ? outNodeValidation.getNodes() : Collections.emptyList();
            if (outNodes.isEmpty()) {
                return R.err(ERROR_OUT_NODE_NOT_FOUND);
            }
            for (Node outNode : outNodes) {
                if (outNode.getOutPort() == null) {
                    return R.err("出口共享端口未配置");
                }
                R sharedConfigResult = validateSharedOutNodeConfig(outNode.getId(), tunnel.getProtocol(), tunnel.getInterfaceName(), null);
                if (sharedConfigResult.getCode() != 0) {
                    return sharedConfigResult;
                }
            }
            tunnel.setMuxEnabled(true);
            tunnel.setMuxPort(outNodes.get(0).getOutPort());
        } else {
            tunnel.setMuxEnabled(false);
            tunnel.setMuxPort(null);
        }

        // 6. 设置默认属性并保存
        setDefaultTunnelProperties(tunnel);
        boolean result = this.save(tunnel);
        if (!result) {
            return R.err(ERROR_CREATE_MSG);
        }
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            R muxResult = ensureMuxService(tunnel);
            if (muxResult.getCode() != 0) {
                this.removeById(tunnel.getId());
                return muxResult;
            }
        }

        return R.ok(SUCCESS_CREATE_MSG);
    }

    /**
     * 获取所有隧道列表
     * 
     * @return 包含所有隧道的响应对象
     */
    @Override
    public R getAllTunnels() {
        UserInfo currentUser = getCurrentUserInfo();
        List<Tunnel> tunnelList;
        if (currentUser.getRoleId() == ADMIN_ROLE_ID) {
            tunnelList = this.list();
        } else {
            tunnelList = this.list(new QueryWrapper<Tunnel>().eq("owner_id", currentUser.getUserId()));
            maskOutIpForUser(tunnelList, currentUser.getUserId());
        }
        return R.ok(tunnelList);
    }

    /**
     * 更新隧道（允许修改名称、流量计费、协议与监听地址、入口节点）
     *
     * @param tunnelUpdateDto 更新数据传输对象
     * @return 更新结果响应
     */
    @Override
    public R updateTunnel(TunnelUpdateDto tunnelUpdateDto) {
        // 1. 验证隧道是否存在
        Tunnel existingTunnel = this.getById(tunnelUpdateDto.getId());
        if (existingTunnel == null) {
            return R.err(ERROR_TUNNEL_NOT_FOUND);
        }
        UserInfo currentUser = getCurrentUserInfo();
        if (currentUser.getRoleId() != ADMIN_ROLE_ID && !Objects.equals(existingTunnel.getOwnerId(), currentUser.getUserId().longValue())) {
            return R.err("无权限操作该隧道");
        }
        Tunnel oldTunnelSnapshot = new Tunnel();
        BeanUtils.copyProperties(existingTunnel, oldTunnelSnapshot);

        // 2. 验证隧道名称唯一性（排除自身）
        R nameValidationResult = validateTunnelNameUniquenessForUpdate(tunnelUpdateDto.getName(), tunnelUpdateDto.getId());
        if (nameValidationResult.getCode() != 0) {
            return nameValidationResult;
        }
        boolean inNodeChanged = false;
        boolean outNodeChanged = false;
        boolean muxChanged = false;
        List<Long> resolvedInNodeIds = resolveInNodeIds(tunnelUpdateDto.getInNodeIds(), tunnelUpdateDto.getInNodeId());
        NodeValidationResult inNodeValidation = null;
        if (!resolvedInNodeIds.isEmpty()) {
            inNodeValidation = validateInNodes(resolvedInNodeIds, true);
            if (inNodeValidation.isHasError()) {
                return R.err(inNodeValidation.getErrorMessage());
            }
            if (existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
                List<Long> existingOutNodeIdsForCheck = resolveOutNodeIdsFromTunnel(existingTunnel);
                for (Long nodeId : resolvedInNodeIds) {
                    if (existingOutNodeIdsForCheck.contains(nodeId)) {
                        return R.err(ERROR_SAME_NODE_NOT_ALLOWED);
                    }
                }
            }
            String nextInNodeIds = joinNodeIds(resolvedInNodeIds);
            if (!Objects.equals(existingTunnel.getInNodeIds(), nextInNodeIds)) {
                existingTunnel.setInNodeIds(nextInNodeIds);
                existingTunnel.setInNodeId(inNodeValidation.getNodes().get(0).getId());
                existingTunnel.setInIp(joinNodeIps(inNodeValidation.getNodes()));
                inNodeChanged = true;
            }

            if (existingTunnel.getType() == TUNNEL_TYPE_PORT_FORWARD) {
                Node firstInNode = inNodeValidation.getNodes().get(0);
                existingTunnel.setOutNodeId(firstInNode.getId());
                existingTunnel.setOutIp(firstInNode.getServerIp());
            }
        }

        List<Long> currentInNodeIds = !resolvedInNodeIds.isEmpty()
                ? resolvedInNodeIds
                : resolveInNodesFromTunnel(existingTunnel).stream()
                    .map(Node::getId)
                    .collect(Collectors.toList());

        List<Long> existingOutNodeIds = resolveOutNodeIdsFromTunnel(existingTunnel);
        boolean hasOutNodeUpdate = (tunnelUpdateDto.getOutNodeIds() != null && !tunnelUpdateDto.getOutNodeIds().isEmpty())
                || tunnelUpdateDto.getOutNodeId() != null;
        List<Long> requestedOutNodeIds = resolveOutNodeIds(tunnelUpdateDto.getOutNodeIds(), tunnelUpdateDto.getOutNodeId());
        List<Long> nextOutNodeIds = existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD
                ? (hasOutNodeUpdate ? requestedOutNodeIds : existingOutNodeIds)
                : Collections.emptyList();
        NodeValidationResult outNodeValidation = null;
        List<Node> outNodes = Collections.emptyList();
        boolean outStrategyChanged = false;

        if (existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (nextOutNodeIds.isEmpty()) {
                return R.err(ERROR_OUT_NODE_REQUIRED);
            }
            outNodeValidation = validateOutNodes(nextOutNodeIds);
            if (outNodeValidation.isHasError()) {
                return R.err(outNodeValidation.getErrorMessage());
            }
            outNodes = outNodeValidation.getNodes();
            for (Node outNode : outNodes) {
                if (currentInNodeIds.contains(outNode.getId())) {
                    return R.err(ERROR_SAME_NODE_NOT_ALLOWED);
                }
            }

            String nextOutNodeIdsValue = joinNodeIds(nextOutNodeIds);
            if (!Objects.equals(existingTunnel.getOutNodeIds(), nextOutNodeIdsValue)) {
                existingTunnel.setOutNodeIds(nextOutNodeIdsValue);
                existingTunnel.setOutNodeId(outNodes.get(0).getId());
                existingTunnel.setOutIp(joinOutNodeIps(outNodes));
                outNodeChanged = true;
            } else if (existingTunnel.getOutNodeId() == null && !outNodes.isEmpty()) {
                existingTunnel.setOutNodeId(outNodes.get(0).getId());
            }

            String normalizedStrategy;
            if (StringUtils.isBlank(tunnelUpdateDto.getOutStrategy())) {
                normalizedStrategy = StringUtils.isBlank(existingTunnel.getOutStrategy())
                        ? DEFAULT_OUT_STRATEGY
                        : existingTunnel.getOutStrategy();
            } else {
                normalizedStrategy = normalizeOutStrategy(tunnelUpdateDto.getOutStrategy());
            }
            if (normalizedStrategy == null) {
                return R.err("出口负载策略不支持");
            }
            if (!Objects.equals(existingTunnel.getOutStrategy(), normalizedStrategy)) {
                existingTunnel.setOutStrategy(normalizedStrategy);
                outStrategyChanged = true;
            }
        } else {
            existingTunnel.setOutNodeIds(null);
            existingTunnel.setOutStrategy(null);
        }

        if (currentUser.getRoleId() != ADMIN_ROLE_ID) {
            List<Node> inNodesToCheck = inNodeValidation != null ? inNodeValidation.getNodes() : resolveInNodesFromTunnel(existingTunnel);
            List<Node> outNodesToCheck = existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD ? outNodes : Collections.emptyList();
            R accessResult = validateUserNodeAccess(currentUser.getUserId(), inNodesToCheck, outNodesToCheck);
            if (accessResult.getCode() != 0) {
                return accessResult;
            }
        }
        Set<Long> removedOutNodeIds = new LinkedHashSet<>(existingOutNodeIds);
        removedOutNodeIds.removeAll(nextOutNodeIds);
        int up = 0;
        if (!Objects.equals(existingTunnel.getTcpListenAddr(), tunnelUpdateDto.getTcpListenAddr()) ||
                !Objects.equals(existingTunnel.getUdpListenAddr(), tunnelUpdateDto.getUdpListenAddr()) ||
                !Objects.equals(existingTunnel.getProtocol(), tunnelUpdateDto.getProtocol()) ||
                !Objects.equals(existingTunnel.getInterfaceName(), tunnelUpdateDto.getInterfaceName())) {
            up++;
        }


        // 5. 更新允许修改的字段
        existingTunnel.setName(tunnelUpdateDto.getName());
        existingTunnel.setTcpListenAddr(tunnelUpdateDto.getTcpListenAddr());
        existingTunnel.setUdpListenAddr(tunnelUpdateDto.getUdpListenAddr());
        existingTunnel.setProtocol(tunnelUpdateDto.getProtocol());
        existingTunnel.setInterfaceName(tunnelUpdateDto.getInterfaceName());
        existingTunnel.setFlow(1);
        if (existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            if (outNodes.isEmpty()) {
                return R.err(ERROR_OUT_NODE_NOT_FOUND);
            }
            for (Node outNode : outNodes) {
                if (outNode.getOutPort() == null) {
                    return R.err("出口共享端口未配置");
                }
                R sharedConfigResult = validateSharedOutNodeConfig(outNode.getId(), existingTunnel.getProtocol(), existingTunnel.getInterfaceName(), existingTunnel.getId());
                if (sharedConfigResult.getCode() != 0) {
                    return sharedConfigResult;
                }
            }
            existingTunnel.setMuxPort(outNodes.get(0).getOutPort());
            existingTunnel.setMuxEnabled(true);
            muxChanged = !Objects.equals(oldTunnelSnapshot.getMuxPort(), existingTunnel.getMuxPort())
                    || !Boolean.TRUE.equals(oldTunnelSnapshot.getMuxEnabled());
        } else {
            existingTunnel.setMuxEnabled(false);
            existingTunnel.setMuxPort(null);
            muxChanged = Boolean.TRUE.equals(oldTunnelSnapshot.getMuxEnabled());
        }
        this.updateById(existingTunnel);
        if (existingTunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            R muxResult = ensureMuxService(existingTunnel);
            if (muxResult.getCode() != 0) {
                return muxResult;
            }
        }
        if (Boolean.TRUE.equals(oldTunnelSnapshot.getMuxEnabled()) && !Boolean.TRUE.equals(existingTunnel.getMuxEnabled())) {
            deleteMuxServiceForNodes(existingOutNodeIds, oldTunnelSnapshot.getId());
        } else if (outNodeChanged && Boolean.TRUE.equals(oldTunnelSnapshot.getMuxEnabled()) && !removedOutNodeIds.isEmpty()) {
            deleteMuxServiceForNodes(removedOutNodeIds, oldTunnelSnapshot.getId());
        }
        if (inNodeChanged || outNodeChanged || muxChanged || outStrategyChanged || up != 0) {
            R rebuildResult = forwardService.rebuildForwardsForTunnelUpdate(oldTunnelSnapshot, existingTunnel);
            if (rebuildResult.getCode() != 0) {
                return rebuildResult;
            }
        }
        return R.ok("隧道更新成功");
    }

    /**
     * 删除隧道
     * 删除前会检查是否有转发或用户权限在使用该隧道
     * 
     * @param id 隧道ID
     * @return 删除结果响应
     */
    @Override
    public R deleteTunnel(Long id) {
        // 1. 验证隧道是否存在
        Tunnel tunnel = this.getById(id);
        if (tunnel == null) {
            return R.err(ERROR_TUNNEL_NOT_FOUND);
        }

        // 2. 删除隧道关联转发
        int forwardCleanupFailures = deleteTunnelForwards(id);

        if (Boolean.TRUE.equals(tunnel.getMuxEnabled())) {
            deleteMuxService(tunnel);
        }

        // 3. 执行删除操作
        boolean result = this.removeById(id);
        if (!result) {
            return R.err(ERROR_DELETE_MSG);
        }

        if (forwardCleanupFailures > 0) {
            return R.ok("隧道删除成功，部分转发清理失败");
        }
        return R.ok(SUCCESS_DELETE_MSG);
    }

    /**
     * 获取用户可用的隧道列表
     * 管理员可以看到所有启用的隧道，普通用户只能看到有权限的启用隧道
     * 
     * @return 用户可用隧道列表响应
     */
    @Override
    public R userTunnel() {
        UserInfo currentUser = getCurrentUserInfo();
        
        // 根据用户角色获取隧道列表
        List<Tunnel> tunnelEntities = getUserAccessibleTunnels(currentUser);
        
        // 转换为DTO并返回
        List<TunnelListDto> tunnelDtos = convertToTunnelListDtos(tunnelEntities);
        return R.ok(tunnelDtos);
    }

    // ========== 私有辅助方法 ==========

    /**
     * 获取当前用户信息
     * 
     * @return 用户信息对象
     */
    private UserInfo getCurrentUserInfo() {
        Integer roleId = JwtUtil.getRoleIdFromToken();
        Integer userId = JwtUtil.getUserIdFromToken();
        return new UserInfo(userId, roleId);
    }

    /**
     * 验证隧道名称唯一性
     * 
     * @param tunnelName 隧道名称
     * @return 验证结果响应
     */
    private R validateTunnelNameUniqueness(String tunnelName) {
        Tunnel existTunnel = this.getOne(new QueryWrapper<Tunnel>().eq("name", tunnelName));
        if (existTunnel != null) {
            return R.err(ERROR_TUNNEL_NAME_EXISTS);
        }
        return R.ok();
    }

    /**
     * 验证隧道名称唯一性（更新时使用，排除自身）
     * 
     * @param tunnelName 隧道名称
     * @param tunnelId 隧道ID（要排除的隧道）
     * @return 验证结果响应
     */
    private R validateTunnelNameUniquenessForUpdate(String tunnelName, Long tunnelId) {
        QueryWrapper<Tunnel> query = new QueryWrapper<>();
        query.eq("name", tunnelName);
        query.ne("id", tunnelId);  // 排除自身
        Tunnel existTunnel = this.getOne(query);
        if (existTunnel != null) {
            return R.err(ERROR_TUNNEL_NAME_EXISTS);
        }
        return R.ok();
    }



    /**
     * 验证隧道转发创建时的必要参数
     *
     * @param tunnelDto 隧道创建数据传输对象
     * @return 验证结果响应
     */
    private R validateTunnelForwardCreate(TunnelDto tunnelDto) {
        // 验证出口节点不能为空
        List<Long> outNodeIds = resolveOutNodeIds(tunnelDto.getOutNodeIds(), tunnelDto.getOutNodeId());
        if (outNodeIds.isEmpty()) {
            return R.err(ERROR_OUT_NODE_REQUIRED);
        }
        String normalizedStrategy = normalizeOutStrategy(tunnelDto.getOutStrategy());
        if (normalizedStrategy == null) {
            return R.err("出口负载策略不支持");
        }
        return R.ok();
    }

    /**
     * 验证入口节点和端口
     * 
     * @param tunnelDto 隧道创建DTO
     * @return 节点验证结果
     */
    private NodeValidationResult validateInNodes(List<Long> inNodeIds) {
        return validateInNodes(inNodeIds, false);
    }

    private NodeValidationResult validateInNodes(List<Long> inNodeIds, boolean allowPartialOffline) {
        List<Node> nodes = new ArrayList<>();
        Set<Long> uniqueIds = new LinkedHashSet<>(inNodeIds);
        boolean hasOnline = false;
        for (Long nodeId : uniqueIds) {
            Node inNode = nodeService.getById(nodeId);
            if (inNode == null) {
                return NodeValidationResult.error(ERROR_IN_NODE_NOT_FOUND);
            }
            if (inNode.getStatus() != NODE_STATUS_ONLINE) {
                if (!allowPartialOffline) {
                    return NodeValidationResult.error(ERROR_IN_NODE_OFFLINE);
                }
            } else {
                hasOnline = true;
            }
            nodes.add(inNode);
        }
        if (allowPartialOffline && !hasOnline) {
            return NodeValidationResult.error(ERROR_IN_NODE_OFFLINE);
        }
        return NodeValidationResult.success(nodes);
    }

    private NodeValidationResult validateOutNodes(List<Long> outNodeIds) {
        if (outNodeIds == null || outNodeIds.isEmpty()) {
            return NodeValidationResult.error(ERROR_OUT_NODE_REQUIRED);
        }
        if (outNodeIds.size() > 1) {
            return NodeValidationResult.error(ERROR_OUT_NODE_MULTI_NOT_SUPPORTED);
        }
        List<Node> nodes = new ArrayList<>();
        Set<Long> uniqueIds = new LinkedHashSet<>(outNodeIds);
        for (Long nodeId : uniqueIds) {
            Node outNode = nodeService.getById(nodeId);
            if (outNode == null) {
                return NodeValidationResult.error(ERROR_OUT_NODE_NOT_FOUND);
            }
            if (outNode.getStatus() != NODE_STATUS_ONLINE) {
                return NodeValidationResult.error(ERROR_OUT_NODE_OFFLINE);
            }
            nodes.add(outNode);
        }
        return NodeValidationResult.success(nodes);
    }

    private List<Long> resolveInNodeIds(List<Long> inNodeIds, Long inNodeId) {
        if (inNodeIds != null && !inNodeIds.isEmpty()) {
            return new ArrayList<>(new LinkedHashSet<>(inNodeIds));
        }
        if (inNodeId != null) {
            return Collections.singletonList(inNodeId);
        }
        return Collections.emptyList();
    }

    private List<Long> resolveOutNodeIds(List<Long> outNodeIds, Long outNodeId) {
        if (outNodeIds != null && !outNodeIds.isEmpty()) {
            return new ArrayList<>(new LinkedHashSet<>(outNodeIds));
        }
        if (outNodeId != null) {
            return Collections.singletonList(outNodeId);
        }
        return Collections.emptyList();
    }

    private String joinNodeIds(List<Long> nodeIds) {
        return nodeIds.stream()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
    }

    private String joinNodeIps(List<Node> nodes) {
        return nodes.stream()
                .map(Node::getIp)
                .filter(Objects::nonNull)
                .collect(Collectors.joining(","));
    }

    private String joinOutNodeIps(List<Node> nodes) {
        return nodes.stream()
                .map(Node::getServerIp)
                .filter(Objects::nonNull)
                .collect(Collectors.joining(","));
    }

    private String normalizeOutStrategy(String strategy) {
        if (StringUtils.isBlank(strategy)) {
            return DEFAULT_OUT_STRATEGY;
        }
        String normalized = strategy.trim().toLowerCase();
        return SUPPORTED_OUT_STRATEGIES.contains(normalized) ? normalized : null;
    }

    /**
     * 构建隧道实体对象
     * 
     * @param tunnelDto 隧道创建DTO
     * @param inNode 入口节点
     * @return 构建完成的隧道对象
     */
    private Tunnel buildTunnelEntity(TunnelDto tunnelDto, List<Node> inNodes) {
        Tunnel tunnel = new Tunnel();
        BeanUtils.copyProperties(tunnelDto, tunnel);
        
        // 设置入口节点信息
        tunnel.setInNodeIds(joinNodeIds(inNodes.stream().map(Node::getId).collect(Collectors.toList())));
        tunnel.setInNodeId(inNodes.get(0).getId());
        tunnel.setInIp(joinNodeIps(inNodes));
        
        // 默认单向计费
        tunnel.setFlow(1);
        tunnel.setTrafficRatio(new BigDecimal("1.0"));
        
        // 设置协议类型（仅隧道转发需要）
        if (tunnelDto.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            // 隧道转发时，设置协议类型，默认为tls
            String protocol = StrUtil.isNotBlank(tunnelDto.getProtocol()) ? tunnelDto.getProtocol() : "tls";
            tunnel.setProtocol(protocol);
        } else {
            // 端口转发时，协议类型为null
            tunnel.setProtocol(null);
        }
        
        // 设置TCP和UDP监听地址
        tunnel.setTcpListenAddr(StrUtil.isNotBlank(tunnelDto.getTcpListenAddr()) ? 
                               tunnelDto.getTcpListenAddr() : "0.0.0.0");
        tunnel.setUdpListenAddr(StrUtil.isNotBlank(tunnelDto.getUdpListenAddr()) ? 
                               tunnelDto.getUdpListenAddr() : "0.0.0.0");
        
        return tunnel;
    }

    private Integer allocateMuxPort(Long nodeId, Long excludeTunnelId) {
        Node node = nodeService.getNodeById(nodeId);
        if (node == null) {
            return null;
        }
        Set<Integer> usedPorts = collectMuxUsedPorts(nodeId, excludeTunnelId);
        for (int port = node.getPortSta(); port <= node.getPortEnd(); port++) {
            if (!usedPorts.contains(port)) {
                return port;
            }
        }
        return null;
    }

    private boolean isMuxPortAvailable(Long nodeId, Integer port, Long excludeTunnelId) {
        if (nodeId == null || port == null) {
            return false;
        }
        Node node = nodeService.getNodeById(nodeId);
        if (node == null || port < node.getPortSta() || port > node.getPortEnd()) {
            return false;
        }
        Set<Integer> usedPorts = collectMuxUsedPorts(nodeId, excludeTunnelId);
        return !usedPorts.contains(port);
    }

    private Set<Integer> collectMuxUsedPorts(Long nodeId, Long excludeTunnelId) {
        Set<Integer> usedPorts = new HashSet<>();

        List<Tunnel> inTunnels = this.list(new QueryWrapper<Tunnel>().eq("in_node_id", nodeId));
        if (!inTunnels.isEmpty()) {
            Set<Long> inTunnelIds = inTunnels.stream()
                    .map(Tunnel::getId)
                    .collect(Collectors.toSet());
            QueryWrapper<Forward> inQueryWrapper = new QueryWrapper<Forward>().in("tunnel_id", inTunnelIds);
            List<Forward> inForwards = forwardService.list(inQueryWrapper);
            for (Forward forward : inForwards) {
                if (forward.getInPort() != null) {
                    usedPorts.add(forward.getInPort());
                }
            }
        }

        List<Tunnel> outTunnels = this.list(new QueryWrapper<Tunnel>().eq("type", TUNNEL_TYPE_TUNNEL_FORWARD));
        List<Tunnel> matchedOutTunnels = outTunnels.stream()
                .filter(tunnel -> resolveOutNodeIdsFromTunnel(tunnel).contains(nodeId))
                .collect(Collectors.toList());
        if (!matchedOutTunnels.isEmpty()) {
            Set<Long> outTunnelIds = matchedOutTunnels.stream()
                    .map(Tunnel::getId)
                    .collect(Collectors.toSet());
            QueryWrapper<Forward> outQueryWrapper = new QueryWrapper<Forward>().in("tunnel_id", outTunnelIds);
            List<Forward> outForwards = forwardService.list(outQueryWrapper);
            for (Forward forward : outForwards) {
                if (forward.getOutPort() != null) {
                    usedPorts.add(forward.getOutPort());
                }
            }
            for (Tunnel tunnel : matchedOutTunnels) {
                if (excludeTunnelId != null && Objects.equals(tunnel.getId().longValue(), excludeTunnelId)) {
                    continue;
                }
                if (Boolean.TRUE.equals(tunnel.getMuxEnabled()) && tunnel.getMuxPort() != null) {
                    usedPorts.add(tunnel.getMuxPort());
                }
            }
        }

        return usedPorts;
    }

    /**
     * 设置出口节点参数
     * 
     * @param tunnel 隧道对象
     * @param tunnelDto 隧道创建DTO
     * @return 设置结果响应
     */
    private R setupOutNodeParameters(Tunnel tunnel, TunnelDto tunnelDto, String serverIp, List<Long> inNodeIds, List<Node> outNodes) {
        if (tunnelDto.getType() == TUNNEL_TYPE_PORT_FORWARD) {
            // 端口转发：出口参数使用入口参数
            return setupPortForwardOutParameters(tunnel, tunnelDto, serverIp);
        } else {
            // 隧道转发：需要验证出口参数
            return setupTunnelForwardOutParameters(tunnel, tunnelDto, inNodeIds, outNodes);
        }
    }

    /**
     * 设置端口转发的出口参数
     * 
     * @param tunnel 隧道对象
     * @param tunnelDto 隧道创建DTO
     * @return 设置结果响应
     */
    private R setupPortForwardOutParameters(Tunnel tunnel, TunnelDto tunnelDto, String server_ip) {
        tunnel.setOutNodeId(tunnel.getInNodeId());
        tunnel.setOutIp(server_ip);
        tunnel.setOutNodeIds(null);
        tunnel.setOutStrategy(null);
        return R.ok();
    }

    /**
     * 设置隧道转发的出口参数
     * 
     * @param tunnel 隧道对象
     * @param tunnelDto 隧道创建DTO
     * @return 设置结果响应
     */
    private R setupTunnelForwardOutParameters(Tunnel tunnel, TunnelDto tunnelDto, List<Long> inNodeIds, List<Node> outNodes) {
        // 验证出口节点不能为空
        if (outNodes == null || outNodes.isEmpty()) {
            return R.err(ERROR_OUT_NODE_REQUIRED);
        }
        if (outNodes.size() > 1) {
            return R.err(ERROR_OUT_NODE_MULTI_NOT_SUPPORTED);
        }

        // 验证入口和出口不能是同一个节点
        if (inNodeIds != null) {
            for (Node outNode : outNodes) {
                if (inNodeIds.contains(outNode.getId())) {
                    return R.err(ERROR_SAME_NODE_NOT_ALLOWED);
                }
            }
        }

        // 验证协议类型
        String protocol = tunnelDto.getProtocol();
        if (StrUtil.isBlank(protocol)) {
            return R.err("协议类型必选");
        }

        String normalizedStrategy = normalizeOutStrategy(tunnelDto.getOutStrategy());
        if (normalizedStrategy == null) {
            return R.err("出口负载策略不支持");
        }

        tunnel.setOutNodeIds(joinNodeIds(outNodes.stream().map(Node::getId).collect(Collectors.toList())));
        tunnel.setOutNodeId(outNodes.get(0).getId());
        tunnel.setOutIp(joinOutNodeIps(outNodes));
        tunnel.setOutStrategy(normalizedStrategy);

        return R.ok();
    }

    private R validateSharedOutNodeConfig(Long outNodeId, String protocol, String interfaceName, Long excludeTunnelId) {
        if (outNodeId == null) {
            return R.ok();
        }
        String normalizedInterface = StringUtils.isBlank(interfaceName) ? null : interfaceName.trim();
        List<Tunnel> tunnels = this.list(new QueryWrapper<Tunnel>().eq("type", TUNNEL_TYPE_TUNNEL_FORWARD));
        for (Tunnel tunnel : tunnels) {
            if (excludeTunnelId != null && Objects.equals(tunnel.getId().longValue(), excludeTunnelId)) {
                continue;
            }
            if (!resolveOutNodeIdsFromTunnel(tunnel).contains(outNodeId)) {
                continue;
            }
            if (protocol != null && tunnel.getProtocol() != null && !Objects.equals(protocol, tunnel.getProtocol())) {
                return R.err("同一出口节点仅支持一种协议");
            }
            String existingInterface = StringUtils.isBlank(tunnel.getInterfaceName()) ? null : tunnel.getInterfaceName().trim();
            if (!Objects.equals(normalizedInterface, existingInterface)) {
                return R.err("同一出口节点需使用相同出口网卡");
            }
        }
        return R.ok();
    }

    /**
     * 设置隧道默认属性
     * 
     * @param tunnel 隧道对象
     */
    private void setDefaultTunnelProperties(Tunnel tunnel) {
        tunnel.setStatus(TUNNEL_STATUS_ACTIVE);
        long currentTime = System.currentTimeMillis();
        tunnel.setCreatedTime(currentTime);
        tunnel.setUpdatedTime(currentTime);
    }

    /**
     * 检查隧道是否存在
     * 
     * @param tunnelId 隧道ID
     * @return 隧道是否存在
     */
    private boolean isTunnelExists(Long tunnelId) {
        return this.getById(tunnelId) != null;
    }

    /**
     * 检查隧道使用情况
     * 
     * @param tunnelId 隧道ID
     * @return 检查结果响应
     */
    private R checkTunnelUsage(Long tunnelId) {
        // 检查转发使用情况
        R forwardCheckResult = checkForwardUsage(tunnelId);
        if (forwardCheckResult.getCode() != 0) {
            return forwardCheckResult;
        }
        return R.ok();
    }

    /**
     * 检查转发使用情况
     * 
     * @param tunnelId 隧道ID
     * @return 检查结果响应
     */
    private R checkForwardUsage(Long tunnelId) {
        QueryWrapper<Forward> forwardQuery = new QueryWrapper<>();
        forwardQuery.eq("tunnel_id", tunnelId);
        long forwardCount = forwardService.count(forwardQuery);
        
        if (forwardCount > 0) {
            String errorMsg = String.format(ERROR_FORWARDS_IN_USE, forwardCount);
            return R.err(errorMsg);
        }
        
        return R.ok();
    }

    private int deleteTunnelForwards(Long tunnelId) {
        QueryWrapper<Forward> forwardQuery = new QueryWrapper<>();
        forwardQuery.eq("tunnel_id", tunnelId);
        List<Forward> forwards = forwardService.list(forwardQuery);

        int failures = 0;
        for (Forward forward : forwards) {
            R deleteResult = forwardService.deleteForward(forward.getId());
            if (deleteResult.getCode() != 0) {
                R forceResult = forwardService.forceDeleteForward(forward.getId());
                if (forceResult.getCode() != 0) {
                    boolean removed = forwardService.removeById(forward.getId());
                    if (!removed) {
                        failures++;
                    }
                }
            }
        }

        return failures;
    }

    private void deleteMuxService(Tunnel tunnel) {
        if (tunnel == null) {
            return;
        }
        deleteMuxServiceForNodes(resolveOutNodeIdsFromTunnel(tunnel), tunnel.getId());
    }

    private void deleteMuxServiceForNodes(Collection<Long> nodeIds, Long excludeTunnelId) {
        if (nodeIds == null || nodeIds.isEmpty()) {
            return;
        }
        for (Long nodeId : nodeIds) {
            if (nodeId == null) {
                continue;
            }
            long remaining = countTunnelsUsingOutNode(nodeId, excludeTunnelId);
            if (remaining > 0) {
                continue;
            }
            Node outNode = nodeService.getNodeById(nodeId);
            if (outNode == null) {
                continue;
            }
            String muxServiceName = buildMuxServiceName(outNode.getId());
            GostUtil.DeleteMuxService(outNode.getId(), muxServiceName);
        }
    }

    private long countTunnelsUsingOutNode(Long outNodeId, Long excludeTunnelId) {
        if (outNodeId == null) {
            return 0;
        }
        List<Tunnel> tunnels = this.list(new QueryWrapper<Tunnel>().eq("type", TUNNEL_TYPE_TUNNEL_FORWARD));
        long count = 0;
        for (Tunnel tunnel : tunnels) {
            if (excludeTunnelId != null && Objects.equals(tunnel.getId().longValue(), excludeTunnelId)) {
                continue;
            }
            if (resolveOutNodeIdsFromTunnel(tunnel).contains(outNodeId)) {
                count++;
            }
        }
        return count;
    }

    private String buildMuxServiceName(Long nodeId) {
        return "node_mux_" + nodeId;
    }

    private R ensureMuxService(Tunnel tunnel) {
        List<Node> outNodes = resolveOutNodesFromTunnel(tunnel);
        if (outNodes.isEmpty()) {
            return R.err(ERROR_OUT_NODE_NOT_FOUND);
        }
        for (Node outNode : outNodes) {
            if (outNode.getOutPort() == null) {
                return R.err("出口共享端口未配置");
            }
            String muxServiceName = buildMuxServiceName(outNode.getId());
            GostDto updateResult = GostUtil.UpdateMuxService(outNode.getId(), muxServiceName, outNode.getOutPort(), tunnel.getProtocol(), tunnel.getInterfaceName());
            if (updateResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                updateResult = GostUtil.AddMuxService(outNode.getId(), muxServiceName, outNode.getOutPort(), tunnel.getProtocol(), tunnel.getInterfaceName());
            }
            if (!isGostOperationSuccess(updateResult)) {
                return R.err(updateResult.getMsg());
            }
        }
        return R.ok();
    }

    private boolean isGostOperationSuccess(GostDto gostResult) {
        return gostResult != null && Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }

    /**
     * 获取用户可访问的隧道列表
     * 
     * @param userInfo 用户信息
     * @return 隧道列表
     */
    private List<Tunnel> getUserAccessibleTunnels(UserInfo userInfo) {
        if (userInfo.getRoleId() == ADMIN_ROLE_ID) {
            return this.list(new QueryWrapper<Tunnel>().eq("status", TUNNEL_STATUS_ACTIVE));
        }
        return this.list(new QueryWrapper<Tunnel>()
                .eq("owner_id", userInfo.getUserId())
                .eq("status", TUNNEL_STATUS_ACTIVE));
    }

    /**
     * 将隧道实体列表转换为DTO列表
     * 
     * @param tunnelEntities 隧道实体列表
     * @return 隧道DTO列表
     */
    private List<TunnelListDto> convertToTunnelListDtos(List<Tunnel> tunnelEntities) {
        return tunnelEntities.stream()
                .map(this::convertToTunnelListDto)
                .collect(Collectors.toList());
    }

    private void maskOutIpForUser(List<Tunnel> tunnels, Integer userId) {
        if (tunnels == null || tunnels.isEmpty()) {
            return;
        }
        Set<Long> outOnlyNodeIds = getOutOnlyNodeIdsForUser(userId);
        if (outOnlyNodeIds.isEmpty()) {
            return;
        }
        Set<Long> outNodeIds = new LinkedHashSet<>();
        for (Tunnel tunnel : tunnels) {
            outNodeIds.addAll(resolveOutNodeIdsFromTunnel(tunnel));
        }
        if (outNodeIds.isEmpty()) {
            return;
        }
        Map<Long, Node> nodeMap = nodeService.listByIds(outNodeIds).stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(Node::getId, node -> node, (first, second) -> first));
        for (Tunnel tunnel : tunnels) {
            List<Long> tunnelOutNodeIds = resolveOutNodeIdsFromTunnel(tunnel);
            if (tunnelOutNodeIds.isEmpty()) {
                continue;
            }
            List<String> maskedIps = new ArrayList<>();
            for (Long nodeId : tunnelOutNodeIds) {
                if (outOnlyNodeIds.contains(nodeId)) {
                    maskedIps.add("隐藏");
                    continue;
                }
                Node node = nodeMap.get(nodeId);
                maskedIps.add(node != null && node.getServerIp() != null ? node.getServerIp() : "");
            }
            tunnel.setOutIp(String.join(",", maskedIps));
        }
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

    private R validateUserNodeAccess(Integer userId, List<Node> inNodes, List<Node> outNodes) {
        Map<Long, Integer> accessTypeMap = userNodeService.list(new QueryWrapper<UserNode>().eq("user_id", userId))
                .stream()
                .filter(userNode -> userNode.getNodeId() != null)
                .collect(Collectors.toMap(UserNode::getNodeId,
                        userNode -> userNode.getAccessType() == null ? ACCESS_TYPE_BOTH : userNode.getAccessType(),
                        (first, second) -> first));

        for (Node inNode : inNodes) {
            if (!hasInNodeAccess(userId, inNode, accessTypeMap)) {
                return R.err("无权限使用入口节点");
            }
        }

        if (outNodes != null) {
            for (Node outNode : outNodes) {
                if (outNode == null) {
                    return R.err(ERROR_OUT_NODE_NOT_FOUND);
                }
                if (!hasOutNodeAccess(userId, outNode, accessTypeMap)) {
                    return R.err("无权限使用出口节点");
                }
            }
        }

        return R.ok();
    }

    private boolean hasInNodeAccess(Integer userId, Node node, Map<Long, Integer> accessTypeMap) {
        if (node == null) {
            return false;
        }
        if (Objects.equals(node.getOwnerId(), userId.longValue())) {
            return true;
        }
        Integer accessType = accessTypeMap.get(node.getId());
        return accessType != null && (accessType == ACCESS_TYPE_BOTH || accessType == ACCESS_TYPE_IN);
    }

    private boolean hasOutNodeAccess(Integer userId, Node node, Map<Long, Integer> accessTypeMap) {
        if (node == null) {
            return false;
        }
        if (Objects.equals(node.getOwnerId(), userId.longValue())) {
            return true;
        }
        Integer accessType = accessTypeMap.get(node.getId());
        return accessType != null && (accessType == ACCESS_TYPE_BOTH || accessType == ACCESS_TYPE_OUT);
    }

    private List<Node> resolveInNodesFromTunnel(Tunnel tunnel) {
        List<Long> inNodeIds = new ArrayList<>();
        if (tunnel.getInNodeIds() != null && !tunnel.getInNodeIds().trim().isEmpty()) {
            for (String part : tunnel.getInNodeIds().split(",")) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    try {
                        inNodeIds.add(Long.parseLong(trimmed));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
        }
        if (inNodeIds.isEmpty() && tunnel.getInNodeId() != null) {
            inNodeIds.add(tunnel.getInNodeId());
        }

        List<Node> nodes = new ArrayList<>();
        for (Long nodeId : inNodeIds) {
            Node node = nodeService.getNodeById(nodeId);
            if (node != null) {
                nodes.add(node);
            }
        }
        return nodes;
    }

    private List<Long> resolveOutNodeIdsFromTunnel(Tunnel tunnel) {
        List<Long> outNodeIds = new ArrayList<>();
        if (tunnel.getOutNodeIds() != null && !tunnel.getOutNodeIds().trim().isEmpty()) {
            for (String part : tunnel.getOutNodeIds().split(",")) {
                String trimmed = part.trim();
                if (!trimmed.isEmpty()) {
                    try {
                        outNodeIds.add(Long.parseLong(trimmed));
                    } catch (NumberFormatException ignored) {
                    }
                }
            }
        }
        if (outNodeIds.isEmpty() && tunnel.getOutNodeId() != null) {
            outNodeIds.add(tunnel.getOutNodeId());
        }
        if (outNodeIds.size() > 1) {
            return Collections.singletonList(outNodeIds.get(0));
        }
        return outNodeIds;
    }

    private List<Node> resolveOutNodesFromTunnel(Tunnel tunnel) {
        List<Long> outNodeIds = resolveOutNodeIdsFromTunnel(tunnel);
        if (outNodeIds.isEmpty()) {
            return Collections.emptyList();
        }
        List<Node> nodes = new ArrayList<>();
        Set<Long> uniqueIds = new LinkedHashSet<>(outNodeIds);
        for (Long nodeId : uniqueIds) {
            Node node = nodeService.getNodeById(nodeId);
            if (node == null) {
                return Collections.emptyList();
            }
            nodes.add(node);
        }
        return nodes;
    }

    /**
     * 将Tunnel实体转换为TunnelListDto
     * 
     * @param tunnel 隧道实体
     * @return 隧道列表DTO
     */
    private TunnelListDto convertToTunnelListDto(Tunnel tunnel) {
        TunnelListDto dto = new TunnelListDto();
        dto.setId(tunnel.getId().intValue());
        dto.setName(tunnel.getName());
        dto.setIp(tunnel.getInIp());
        dto.setType(tunnel.getType());
        dto.setProtocol(tunnel.getProtocol());
        
        // 获取入口节点的端口范围信息
        if (tunnel.getInNodeId() != null) {
            Node inNode = nodeService.getById(tunnel.getInNodeId());
            if (inNode != null) {
                dto.setInNodePortSta(inNode.getPortSta());
                dto.setInNodePortEnd(inNode.getPortEnd());
            }
        }
        
        return dto;
    }

    /**
     * 隧道诊断功能
     * 
     * @param tunnelId 隧道ID
     * @return 诊断结果响应
     */
    @Override
    public R diagnoseTunnel(Long tunnelId) {
        // 1. 验证隧道是否存在
        Tunnel tunnel = this.getById(tunnelId);
        if (tunnel == null) {
            return R.err(ERROR_TUNNEL_NOT_FOUND);
        }
        UserInfo currentUser = getCurrentUserInfo();
        Set<Long> outOnlyNodeIds = currentUser.getRoleId() == ADMIN_ROLE_ID
                ? Collections.emptySet()
                : getOutOnlyNodeIdsForUser(currentUser.getUserId());

        // 2. 获取入口和出口节点信息
        List<Node> inNodes = resolveInNodesForDiagnosis(tunnel);
        if (inNodes.isEmpty()) {
            return R.err(ERROR_IN_NODE_NOT_FOUND);
        }

        List<Node> outNodes = Collections.emptyList();
        if (tunnel.getType() == TUNNEL_TYPE_TUNNEL_FORWARD) {
            outNodes = resolveOutNodesFromTunnel(tunnel);
            if (outNodes.isEmpty()) {
                return R.err(ERROR_OUT_NODE_NOT_FOUND);
            }
        }

        List<DiagnosisResult> results = new ArrayList<>();

        // 3. 根据隧道类型执行不同的诊断策略
        if (tunnel.getType() == TUNNEL_TYPE_PORT_FORWARD) {
            // 端口转发：只给入口节点发送诊断指令，TCP ping谷歌443端口
            for (Node inNode : inNodes) {
                DiagnosisResult inResult = performTcpPingDiagnosisWithConnectionCheck(inNode, "www.icloud.com.cn", 443, "入口->外网");
                results.add(inResult);
            }
        } else {
            // 隧道转发：入口TCP ping出口，出口TCP ping外网
            for (Node outNode : outNodes) {
                int outNodePort = getOutNodeTcpPort(tunnel, outNode);
                for (Node inNode : inNodes) {
                    DiagnosisResult inToOutResult = performTcpPingDiagnosisWithConnectionCheck(
                            inNode,
                            outNode.getServerIp(),
                            outNodePort,
                            "入口->出口(" + outNode.getName() + ")");
                    if (outOnlyNodeIds.contains(outNode.getId())) {
                        inToOutResult.setTargetIp("隐藏");
                    }
                    results.add(inToOutResult);
                }

                DiagnosisResult outToExternalResult = performTcpPingDiagnosisWithConnectionCheck(outNode, "www.icloud.com.cn", 443, "出口->外网");
                results.add(outToExternalResult);
            }
        }

        // 4. 构建诊断报告
        Map<String, Object> diagnosisReport = new HashMap<>();
        diagnosisReport.put("tunnelId", tunnelId);
        diagnosisReport.put("tunnelName", tunnel.getName());
        diagnosisReport.put("tunnelType", tunnel.getType() == TUNNEL_TYPE_PORT_FORWARD ? "端口转发" : "隧道转发");
        diagnosisReport.put("results", results);
        diagnosisReport.put("timestamp", System.currentTimeMillis());

        return R.ok(diagnosisReport);
    }

    private List<Node> resolveInNodesForDiagnosis(Tunnel tunnel) {
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
        if (inNodeIds.isEmpty()) {
            return Collections.emptyList();
        }

        List<Node> nodes = new ArrayList<>();
        Set<Long> uniqueIds = new LinkedHashSet<>(inNodeIds);
        for (Long nodeId : uniqueIds) {
            Node node = nodeService.getById(nodeId);
            if (node == null) {
                return Collections.emptyList();
            }
            nodes.add(node);
        }
        return nodes;
    }

    /**
     * 获取出口节点的TCP端口
     * 通过隧道ID查找转发服务的出口端口，如果没有则使用默认SSH端口22
     * 
     * @param tunnelId 隧道ID
     * @return TCP端口号
     */
    private int getOutNodeTcpPort(Tunnel tunnel, Node outNode) {
        if (tunnel == null) {
            return 22;
        }
        if (Boolean.TRUE.equals(tunnel.getMuxEnabled()) && outNode != null && outNode.getOutPort() != null) {
            return outNode.getOutPort();
        }
        if (outNode != null && outNode.getOutPort() != null) {
            return outNode.getOutPort();
        }
        return getOutNodeTcpPort(tunnel.getId());
    }

    private int getOutNodeTcpPort(Long tunnelId) {
        Tunnel tunnel = this.getById(tunnelId);
        if (tunnel != null && Boolean.TRUE.equals(tunnel.getMuxEnabled()) && tunnel.getMuxPort() != null) {
            return tunnel.getMuxPort();
        }
        if (tunnel != null && tunnel.getOutNodeId() != null) {
            Node outNode = nodeService.getById(tunnel.getOutNodeId());
            if (outNode != null && outNode.getOutPort() != null) {
                return outNode.getOutPort();
            }
        }
        List<Forward> forwards = forwardService.list(new QueryWrapper<Forward>().eq("tunnel_id", tunnelId).eq("status", TUNNEL_STATUS_ACTIVE));
        if (!forwards.isEmpty()) {
            return forwards.get(0).getOutPort();
        }
        // 如果没有转发服务，使用默认SSH端口22
        return 22;
    }

    /**
     * 执行TCP ping诊断
     * 
     * @param node 执行TCP ping的节点
     * @param targetIp 目标IP地址
     * @param port 目标端口
     * @param description 诊断描述
     * @return 诊断结果
     */
    private DiagnosisResult performTcpPingDiagnosis(Node node, String targetIp, int port, String description) {
        try {
            // 构建TCP ping请求数据
            JSONObject tcpPingData = new JSONObject();
            tcpPingData.put("ip", targetIp);
            tcpPingData.put("port", port);
            tcpPingData.put("count", 4);
            tcpPingData.put("timeout", 5000); // 5秒超时

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
     * 执行TCP ping诊断（带连接状态检查）
     * 
     * @param node 执行TCP ping的节点
     * @param targetIp 目标IP地址
     * @param port 目标端口
     * @param description 诊断描述
     * @return 诊断结果
     */
    private DiagnosisResult performTcpPingDiagnosisWithConnectionCheck(Node node, String targetIp, int port, String description) {
        DiagnosisResult result = new DiagnosisResult();
        result.setNodeId(node.getId());
        result.setNodeName(node.getName());
        result.setTargetIp(targetIp);
        result.setTargetPort(port);
        result.setDescription(description);
        result.setTimestamp(System.currentTimeMillis());

        try {
            return performTcpPingDiagnosis(node, targetIp, port, description);
        } catch (Exception e) {
            result.setSuccess(false);
            result.setMessage("连接检查异常: " + e.getMessage());
            result.setAverageTime(-1.0);
            result.setPacketLoss(100.0);
            return result;
        }
    }


    // ========== 内部数据类 ==========

    /**
     * 用户信息封装类
     */
    @Data
    private static class UserInfo {
        private final Integer userId;
        private final Integer roleId;
    }

    /**
     * 节点验证结果封装类
     */
    @Data
    private static class NodeValidationResult {
        private final boolean hasError;
        private final String errorMessage;
        private final List<Node> nodes;

        private NodeValidationResult(boolean hasError, String errorMessage, List<Node> nodes) {
            this.hasError = hasError;
            this.errorMessage = errorMessage;
            this.nodes = nodes;
        }

        public static NodeValidationResult success(List<Node> nodes) {
            return new NodeValidationResult(false, null, nodes);
        }

        public static NodeValidationResult error(String errorMessage) {
            return new NodeValidationResult(true, errorMessage, null);
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
