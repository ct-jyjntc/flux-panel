package com.admin.mapper;

import com.admin.common.dto.UserNodeWithDetailDto;
import com.admin.entity.UserNode;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

public interface UserNodeMapper extends BaseMapper<UserNode> {

    List<UserNodeWithDetailDto> getUserNodeWithDetails(@Param("userId") Integer userId);
}
