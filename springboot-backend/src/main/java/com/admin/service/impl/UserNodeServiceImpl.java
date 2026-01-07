package com.admin.service.impl;

import com.admin.common.dto.UserNodeDto;
import com.admin.common.dto.UserNodeQueryDto;
import com.admin.common.dto.UserNodeWithDetailDto;
import com.admin.common.lang.R;
import com.admin.entity.UserNode;
import com.admin.mapper.UserNodeMapper;
import com.admin.service.UserNodeService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserNodeServiceImpl extends ServiceImpl<UserNodeMapper, UserNode> implements UserNodeService {

    private static final String ERROR_PERMISSION_EXISTS = "该用户已拥有此节点权限";
    private static final String ERROR_PERMISSION_NOT_FOUND = "未找到对应的节点权限记录";
    private static final String ERROR_ACCESS_TYPE_INVALID = "节点权限类型不合法";

    private static final int ACCESS_TYPE_BOTH = 0;
    private static final int ACCESS_TYPE_IN = 1;
    private static final int ACCESS_TYPE_OUT = 2;

    @Override
    public R assignUserNode(UserNodeDto userNodeDto) {
        QueryWrapper<UserNode> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("user_id", userNodeDto.getUserId()).eq("node_id", userNodeDto.getNodeId());
        if (this.getOne(queryWrapper) != null) {
            return R.err(ERROR_PERMISSION_EXISTS);
        }

        Integer normalizedAccessType = normalizeAccessType(userNodeDto.getAccessType());
        if (normalizedAccessType == null) {
            return R.err(ERROR_ACCESS_TYPE_INVALID);
        }

        UserNode userNode = new UserNode();
        userNode.setUserId(userNodeDto.getUserId());
        userNode.setNodeId(userNodeDto.getNodeId());
        userNode.setAccessType(normalizedAccessType);
        userNode.setCreatedTime(System.currentTimeMillis());

        return this.save(userNode) ? R.ok("节点权限分配成功") : R.err("节点权限分配失败");
    }

    @Override
    public R getUserNodeList(UserNodeQueryDto queryDto) {
        List<UserNodeWithDetailDto> details = this.baseMapper.getUserNodeWithDetails(queryDto.getUserId());
        return R.ok(details);
    }

    @Override
    public R removeUserNode(Integer id) {
        boolean result = this.removeById(id);
        return result ? R.ok("节点权限删除成功") : R.err(ERROR_PERMISSION_NOT_FOUND);
    }

    private Integer normalizeAccessType(Integer accessType) {
        if (accessType == null) {
            return ACCESS_TYPE_BOTH;
        }
        if (accessType == ACCESS_TYPE_BOTH || accessType == ACCESS_TYPE_IN || accessType == ACCESS_TYPE_OUT) {
            return accessType;
        }
        return null;
    }
}
