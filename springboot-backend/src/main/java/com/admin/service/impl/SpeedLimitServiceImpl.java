package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.SpeedLimitDto;
import com.admin.common.dto.SpeedLimitUpdateDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.entity.Forward;
import com.admin.entity.Node;
import com.admin.entity.SpeedLimit;
import com.admin.entity.Tunnel;
import com.admin.entity.User;
import com.admin.mapper.SpeedLimitMapper;
import com.admin.service.ForwardService;
import com.admin.service.NodeService;
import com.admin.service.SpeedLimitService;
import com.admin.service.TunnelService;
import com.admin.service.UserService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * <p>
 * 限速规则服务实现类
 * 提供限速规则的增删改查功能，包括与Gost服务的集成
 * 支持限速器的创建、更新、删除和查询操作
 * </p>
 *
 * @author QAQ
 * @since 2025-06-04
 */
@Service
public class SpeedLimitServiceImpl extends ServiceImpl<SpeedLimitMapper, SpeedLimit> implements SpeedLimitService {

    // ========== 常量定义 ==========

    /** Gost操作成功响应消息 */
    private static final String GOST_SUCCESS_MSG = "OK";

    /** Gost未找到资源响应消息 */
    private static final String GOST_NOT_FOUND_MSG = "not found";

    /** 限速规则状态 */
    private static final int SPEED_LIMIT_ACTIVE_STATUS = 1;

    /** 速度转换比率：比特到字节 */
    private static final double BITS_TO_BYTES_RATIO = 8.0;

    /** 成功响应消息 */
    private static final String SUCCESS_UPDATE_MSG = "限速规则更新成功";
    private static final String SUCCESS_DELETE_MSG = "限速规则删除成功";

    /** 错误响应消息 */
    private static final String ERROR_CREATE_MSG = "限速规则创建失败";
    private static final String ERROR_UPDATE_MSG = "限速规则更新失败";
    private static final String ERROR_DELETE_MSG = "限速规则删除失败";
    private static final String ERROR_SPEED_LIMIT_NOT_FOUND = "限速规则不存在";
    private static final String ERROR_SPEED_LIMIT_IN_USE = "该限速规则还有用户在使用 请先取消分配";

    // ========== 依赖注入 ==========

    @Autowired
    @Lazy
    private NodeService nodeService;

    @Autowired
    @Lazy
    private UserService userService;

    @Autowired
    @Lazy
    private ForwardService forwardService;

    @Autowired
    @Lazy
    private TunnelService tunnelService;

    // ========== 公共接口实现 ==========

    /**
     * 创建限速规则
     *
     * @param speedLimitDto 限速规则创建数据传输对象
     * @return 创建结果响应
     */
    @Override
    public R createSpeedLimit(SpeedLimitDto speedLimitDto) {
        SpeedLimit speedLimit = createSpeedLimitEntity(speedLimitDto);
        if (!this.save(speedLimit)) {
            return R.err(ERROR_CREATE_MSG);
        }
        return R.ok();
    }

    /**
     * 获取所有限速规则
     *
     * @return 包含所有限速规则的响应对象
     */
    @Override
    public R getAllSpeedLimits() {
        List<SpeedLimit> speedLimits = this.list();
        return R.ok(speedLimits);
    }

    /**
     * 更新限速规则
     *
     * @param speedLimitUpdateDto 限速规则更新数据传输对象
     * @return 更新结果响应
     */
    @Override
    public R updateSpeedLimit(SpeedLimitUpdateDto speedLimitUpdateDto) {
        SpeedLimit speedLimit = this.getById(speedLimitUpdateDto.getId());
        if (speedLimit == null) {
            return R.err(ERROR_SPEED_LIMIT_NOT_FOUND);
        }

        updateSpeedLimitEntity(speedLimitUpdateDto, speedLimit);
        boolean result = this.updateById(speedLimit);
        if (!result) {
            return R.err(ERROR_UPDATE_MSG);
        }

        R limiterResult = refreshUserLimiters(speedLimit);
        if (limiterResult.getCode() != 0) {
            return limiterResult;
        }

        return R.ok(SUCCESS_UPDATE_MSG);
    }

    /**
     * 删除限速规则
     * 删除前会检查是否有用户正在使用该限速规则
     *
     * @param id 限速规则ID
     * @return 删除结果响应
     */
    @Override
    public R deleteSpeedLimit(Long id) {
        SpeedLimit speedLimit = this.getById(id);
        if (speedLimit == null) {
            return R.err(ERROR_SPEED_LIMIT_NOT_FOUND);
        }

        R usageCheckResult = checkSpeedLimitUsage(id);
        if (usageCheckResult.getCode() != 0) {
            return usageCheckResult;
        }

        deleteLimitersFromNodes(id);
        boolean result = this.removeById(id);
        return result ? R.ok(SUCCESS_DELETE_MSG) : R.err(ERROR_DELETE_MSG);
    }

    // ========== 私有辅助方法 ==========

    /**
     * 创建限速规则实体对象
     *
     * @param speedLimitDto 限速规则创建DTO
     * @return 构建完成的限速规则对象
     */
    private SpeedLimit createSpeedLimitEntity(SpeedLimitDto speedLimitDto) {
        SpeedLimit speedLimit = new SpeedLimit();
        BeanUtils.copyProperties(speedLimitDto, speedLimit);

        long currentTime = System.currentTimeMillis();
        speedLimit.setCreatedTime(currentTime);
        speedLimit.setUpdatedTime(currentTime);
        speedLimit.setStatus(SPEED_LIMIT_ACTIVE_STATUS);

        return speedLimit;
    }

    /**
     * 更新限速规则实体对象
     *
     * @param speedLimitUpdateDto 限速规则更新DTO
     * @param speedLimit 待更新的限速规则对象
     */
    private void updateSpeedLimitEntity(SpeedLimitUpdateDto speedLimitUpdateDto, SpeedLimit speedLimit) {
        BeanUtils.copyProperties(speedLimitUpdateDto, speedLimit);
        speedLimit.setUpdatedTime(System.currentTimeMillis());
    }

    /**
     * 检查限速规则使用情况
     *
     * @param speedLimitId 限速规则ID
     * @return 检查结果响应
     */
    private R checkSpeedLimitUsage(Long speedLimitId) {
        int userCount = userService.count(new QueryWrapper<User>().eq("speed_id", speedLimitId));
        if (userCount != 0) {
            return R.err(ERROR_SPEED_LIMIT_IN_USE);
        }
        return R.ok();
    }

    private R refreshUserLimiters(SpeedLimit speedLimit) {
        List<User> users = userService.list(new QueryWrapper<User>().eq("speed_id", speedLimit.getId()));
        if (users == null || users.isEmpty()) {
            return R.ok();
        }
        List<Long> userIds = new ArrayList<>();
        for (User user : users) {
            userIds.add(user.getId());
        }

        List<Forward> forwards = forwardService.list(new QueryWrapper<Forward>().in("user_id", userIds));
        if (forwards == null || forwards.isEmpty()) {
            return R.ok();
        }

        Map<Long, Tunnel> tunnelCache = new HashMap<>();
        Set<Long> nodeIds = new HashSet<>();
        for (Forward forward : forwards) {
            if (forward.getTunnelId() == null) {
                continue;
            }
            Long tunnelId = forward.getTunnelId().longValue();
            Tunnel tunnel = tunnelCache.computeIfAbsent(tunnelId, tunnelService::getById);
            if (tunnel == null) {
                continue;
            }
            for (Long nodeId : resolveInNodeIds(tunnel)) {
                nodeIds.add(nodeId);
            }
        }

        if (nodeIds.isEmpty()) {
            return R.ok();
        }

        String speedInMBps = convertBitsToMBps(speedLimit.getSpeed());
        for (Long nodeId : nodeIds) {
            Node node = nodeService.getById(nodeId);
            if (node == null) {
                continue;
            }
            GostDto updateResult = GostUtil.UpdateLimiters(node.getId(), speedLimit.getId(), speedInMBps);
            if (updateResult != null && updateResult.getMsg() != null && updateResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                GostDto addResult = GostUtil.AddLimiters(node.getId(), speedLimit.getId(), speedInMBps);
                if (!isGostOperationSuccess(addResult)) {
                    return R.err("创建限速器失败：" + addResult.getMsg());
                }
            } else if (!isGostOperationSuccess(updateResult)) {
                return R.err("更新限速器失败：" + (updateResult != null ? updateResult.getMsg() : "未知错误"));
            }
        }

        return R.ok();
    }

    private void deleteLimitersFromNodes(Long speedLimitId) {
        List<Node> nodes = nodeService.list();
        if (nodes == null || nodes.isEmpty()) {
            return;
        }
        for (Node node : nodes) {
            GostUtil.DeleteLimiters(node.getId(), speedLimitId);
        }
    }

    private List<Long> resolveInNodeIds(Tunnel tunnel) {
        List<Long> nodeIds = new ArrayList<>();
        if (tunnel == null) {
            return nodeIds;
        }
        if (tunnel.getInNodeIds() != null && !tunnel.getInNodeIds().trim().isEmpty()) {
            String[] parts = tunnel.getInNodeIds().split(",");
            for (String part : parts) {
                try {
                    nodeIds.add(Long.valueOf(part.trim()));
                } catch (NumberFormatException ignored) {
                    // ignore invalid entries
                }
            }
        } else if (tunnel.getInNodeId() != null) {
            nodeIds.add(tunnel.getInNodeId());
        }
        return nodeIds;
    }

    /**
     * 将比特率转换为兆字节每秒
     *
     * @param speedInBits 比特率速度
     * @return 兆字节每秒字符串
     */
    private String convertBitsToMBps(Integer speedInBits) {
        if (speedInBits == null) {
            return "0";
        }
        double mbs = speedInBits / BITS_TO_BYTES_RATIO;
        BigDecimal bd = new BigDecimal(mbs).setScale(1, RoundingMode.HALF_UP);
        return bd.doubleValue() + "";
    }

    /**
     * 检查Gost操作是否成功
     *
     * @param gostResult Gost操作结果
     * @return 是否成功
     */
    private boolean isGostOperationSuccess(GostDto gostResult) {
        return gostResult != null && Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }
}
