package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.dto.TunnelDto;
import com.admin.common.dto.TunnelUpdateDto;

import com.admin.common.lang.R;
import com.admin.service.TunnelService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * <p>
 * 隧道前端控制器
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
@RestController
@CrossOrigin
@RequestMapping("/api/v1/tunnel")
public class TunnelController extends BaseController {

    @Autowired
    private TunnelService tunnelService;
    
    @LogAnnotation
    @PostMapping("/create")
    public R create(@Validated @RequestBody TunnelDto tunnelDto) {
        return tunnelService.createTunnel(tunnelDto);
    }

    @LogAnnotation
    @PostMapping("/list")
    public R readAll() {
        return tunnelService.getAllTunnels();
    }

    @LogAnnotation
    @PostMapping("/update")
    public R update(@Validated @RequestBody TunnelUpdateDto tunnelUpdateDto) {
        return tunnelService.updateTunnel(tunnelUpdateDto);
    }

    @LogAnnotation
    @PostMapping("/delete")
    public R delete(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return tunnelService.deleteTunnel(id);
    }


    @LogAnnotation
    @PostMapping("/user/tunnel")
    public R userTunnel() {
        return tunnelService.userTunnel();
    }

    /**
     * 隧道诊断功能
     * @param params 包含tunnelId的参数
     * @return 诊断结果
     */
    @LogAnnotation
    @PostMapping("/diagnose")
    public R diagnoseTunnel(@RequestBody Map<String, Object> params) {
        Long tunnelId = Long.valueOf(params.get("tunnelId").toString());
        return tunnelService.diagnoseTunnel(tunnelId);
    }

}
