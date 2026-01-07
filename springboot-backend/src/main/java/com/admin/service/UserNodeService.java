package com.admin.service;

import com.admin.common.dto.UserNodeDto;
import com.admin.common.dto.UserNodeQueryDto;
import com.admin.common.lang.R;
import com.admin.entity.UserNode;
import com.baomidou.mybatisplus.extension.service.IService;

public interface UserNodeService extends IService<UserNode> {

    R assignUserNode(UserNodeDto userNodeDto);

    R getUserNodeList(UserNodeQueryDto queryDto);

    R removeUserNode(Integer id);
}
