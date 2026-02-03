package com.admin.mapper;

import com.admin.entity.SystemLog;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface SystemLogMapper extends BaseMapper<SystemLog> {

    @Update("TRUNCATE TABLE system_log")
    void truncate();
}
