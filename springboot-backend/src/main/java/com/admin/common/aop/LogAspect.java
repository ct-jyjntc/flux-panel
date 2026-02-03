package com.admin.common.aop;


import cn.hutool.core.util.ArrayUtil;
import com.admin.common.utils.JwtUtil;
import com.alibaba.fastjson.JSON;
import com.admin.common.lang.R;
import com.admin.entity.SystemLog;
import com.admin.service.SystemLogService;
import com.admin.common.utils.HttpContextUtils;
import com.admin.common.utils.IpUtils;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.JoinPoint;
import org.aspectj.lang.annotation.*;
import org.aspectj.lang.reflect.CodeSignature;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.stereotype.Component;

import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

@Component
@Aspect
@Slf4j
public class LogAspect {

    private static final int MAX_PARAM_LENGTH = 2000;
    private static final int MAX_MSG_LENGTH = 500;
    private static final String[] SKIP_PERSIST_URIS = {
            "/flow/upload",
            "/flow/config",
            "/flow/test",
            "/log/clear"
    };

    private static final Pattern SENSITIVE_JSON_PATTERN = Pattern.compile(
            "(?i)\\\"(password|pwd|newPassword|confirmPassword|token|authorization)\\\"\\s*:\\s*\\\".*?\\\""
    );
    private static final Pattern SENSITIVE_QUERY_PATTERN = Pattern.compile(
            "(?i)(password|pwd|newPassword|confirmPassword|token|authorization)=([^&\\s]+)"
    );

    private final SystemLogService systemLogService;

    public LogAspect(SystemLogService systemLogService) {
        this.systemLogService = systemLogService;
    }

    @Pointcut("@annotation(com.admin.common.aop.LogAnnotation)")
    public void pt() {

    }

    /**
     * 返回后通知（@AfterReturning）：在某连接点（joinpoint）
     * 正常完成后执行的通知：例如，一个方法没有抛出任何异常，正常返回
     * 方法执行完毕之后
     * 注意在这里不能使用ProceedingJoinPoint
     * 不然会报错ProceedingJoinPoint is only supported for around advice
     * crmAspect()指向需要控制的方法
     * returning  注解返回值
     *
     * @param joinPoint
     * @param returnValue 返回值
     * @throws Exception
     */
    @AfterReturning(value = "pt()", returning = "returnValue")
    public void log(JoinPoint joinPoint, Object returnValue) throws Throwable {
        // 获取请求信息
        HttpServletRequest request = HttpContextUtils.getHttpServletRequest();
        
        // 获取请求方法类型（POST/GET等）
        String requestMethod = request.getMethod();
        
        // 获取用户ID
        String authorization = request.getHeader("Authorization") + "";
        Object user_id = "未登录"; // 请求用户的id
        if (!authorization.equals("null")) {
            user_id = JwtUtil.getUserIdFromToken(authorization);
        }
        
        // 获取请求IP
        String ipAddr = IpUtils.getIpAddr(request);
        
        // 获取方法签名信息
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        
        // 获取控制器方法名
        String className = joinPoint.getTarget().getClass().getName();
        String methodName = signature.getName();
        String controllerMethod = className + "." + methodName;
        

        // 获取请求参数
        String requestParams = getRequestParams(joinPoint);
        
        // 获取返回参数
        String responseParams = returnValue != null ? JSON.toJSONString(returnValue) : "无返回值";

        // 合并为一条完整的日志信息
        String logMessage = String.format(
            "【请求日志】用户ID:[%s], IP地址:[%s], 请求方式:[%s], 控制器方法:[%s], 请求参数:[%s], 返回参数:[%s]", user_id, ipAddr, requestMethod, controllerMethod, requestParams, responseParams
        );
        
        // 打印单条完整日志
        log.info(logMessage);

        // 持久化操作日志
        if (!shouldSkipPersistence(request)) {
            try {
                SystemLog systemLog = buildSystemLog(request, controllerMethod, requestParams);
                systemLog.setLogType("OPERATION");
                if (returnValue instanceof R) {
                    R r = (R) returnValue;
                    systemLog.setResponseCode(r.getCode());
                    systemLog.setResponseMsg(truncate(r.getMsg(), MAX_MSG_LENGTH));
                }
                persistSystemLog(systemLog);
            } catch (Exception e) {
                log.warn("持久化操作日志失败: {}", e.getMessage());
            }
        }
    }


    /**
     * 抛出异常后通知（@AfterThrowing）：方法抛出异常退出时执行的通知
     * 注意在这里不能使用ProceedingJoinPoint
     * 不然会报错ProceedingJoinPoint is only supported for around advice
     * throwing注解为错误信息
     *
     * @param joinPoint
     * @param ex
     */
    @AfterThrowing(value = "pt()", throwing = "ex")
    public void recordLog(JoinPoint joinPoint, Exception ex) {
        try {
            // 获取请求信息
            HttpServletRequest request = HttpContextUtils.getHttpServletRequest();
            
            // 获取请求方法类型（POST/GET等）
            String requestMethod = request.getMethod();
            
            // 获取用户ID
            String authorization = request.getHeader("Authorization") + "";
            Object user_id = "未登录"; // 请求用户的id
            if (!authorization.equals("null")) {
                user_id = JwtUtil.getUserIdFromToken(authorization);
            }
            
            // 获取请求IP
            String ipAddr = IpUtils.getIpAddr(request);
            
            // 获取方法签名信息
            MethodSignature signature = (MethodSignature) joinPoint.getSignature();
            Method method = signature.getMethod();
            
            // 获取控制器方法名
            String className = joinPoint.getTarget().getClass().getName();
            String methodName = signature.getName();
            String controllerMethod = className + "." + methodName;
            

            
            // 获取请求参数
            String requestParams = getRequestParams(joinPoint);
            
            // 获取异常信息
            String exceptionMsg = ex != null ? ex.getMessage() : "未知异常";
            
            // 合并为一条完整的异常日志信息
            String errorMessage = String.format(
                "【异常日志】用户ID:[%s], IP地址:[%s], 请求方式:[%s], 控制器方法:[%s], 请求参数:[%s], 异常信息:[%s]", user_id, ipAddr, requestMethod, controllerMethod, requestParams, exceptionMsg
            );
            
            // 打印单条完整异常日志
            log.info(errorMessage, ex);

            // 持久化异常日志
            if (!shouldSkipPersistence(request)) {
                try {
                    SystemLog systemLog = buildSystemLog(request, controllerMethod, requestParams);
                    systemLog.setLogType("EXCEPTION");
                    systemLog.setResponseCode(-1);
                    systemLog.setResponseMsg("请求异常");
                    systemLog.setExceptionMsg(truncate(exceptionMsg, MAX_PARAM_LENGTH));
                    persistSystemLog(systemLog);
                } catch (Exception e) {
                    log.warn("持久化异常日志失败: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.info("记录异常日志时出错: {}", e.getMessage());
        }
    }
    
    /**
     * 获取请求参数
     */
    private String getRequestParams(JoinPoint joinPoint) {
        try {
            Object[] args = joinPoint.getArgs();
            if (args.length == 0) {
                return "无参数";
            } else if (args[0] != null && args[0].toString().contains("SecurityContextHolderAwareRequestWrapper")) {
                return JSON.toJSONString(Arrays.toString(ArrayUtil.remove(args, 0)));
            } else {
                // 检查是否只有一个参数且已经是JSON字符串格式
                if (args.length == 1 && args[0] != null) {
                    // 如果参数本身就是字符串且是JSON格式，直接返回
                    if (args[0] instanceof String && ((String) args[0]).startsWith("{") && ((String) args[0]).endsWith("}")) {
                        return (String) args[0];
                    }
                    
                    // 如果参数是普通对象，直接序列化
                    try {
                        return JSON.toJSONString(args[0]);
                    } catch (Exception e) {
                        // 如果序列化失败，再尝试使用参数名映射
                        Map<String, Object> map = new HashMap<>();
                        String[] names = ((CodeSignature) joinPoint.getSignature()).getParameterNames();
                        if (names != null) {
                            map.put(names[0], args[0]);
                            return JSON.toJSONString(map);
                        }
                        return JSON.toJSONString(args[0]);
                    }
                } else {
                    // 多个参数时，使用参数名映射
                    Map<String, Object> map = new HashMap<>();
                    String[] names = ((CodeSignature) joinPoint.getSignature()).getParameterNames();
                    if (names != null) {
                        for (int i = 0; i < names.length; i++) {
                            map.put(names[i], args[i]);
                        }
                    }
                    return JSON.toJSONString(map);
                }
            }
        } catch (Exception e) {
            return "获取参数失败: " + e.getMessage();
        }
    }

    private SystemLog buildSystemLog(HttpServletRequest request, String controllerMethod, String requestParams) {
        SystemLog systemLog = new SystemLog();
        systemLog.setRequestMethod(request.getMethod());
        systemLog.setRequestUri(request.getRequestURI());
        systemLog.setControllerMethod(controllerMethod);
        systemLog.setRequestParams(truncate(sanitize(requestParams), MAX_PARAM_LENGTH));

        String authorization = request.getHeader("Authorization");
        if (authorization != null && !"null".equals(authorization)) {
            try {
                systemLog.setUserId(JwtUtil.getUserIdFromToken(authorization).intValue());
                systemLog.setUserName(JwtUtil.getNameFromToken());
            } catch (Exception e) {
                systemLog.setUserName("未登录");
            }
        } else {
            systemLog.setUserName("未登录");
        }

        systemLog.setIp(IpUtils.getIpAddr(request));
        long now = System.currentTimeMillis();
        systemLog.setCreatedTime(now);
        systemLog.setUpdatedTime(now);
        systemLog.setStatus(0);
        return systemLog;
    }

    private void persistSystemLog(SystemLog systemLog) {
        if (systemLogService != null) {
            systemLogService.save(systemLog);
        }
    }

    private boolean shouldSkipPersistence(HttpServletRequest request) {
        if (request == null) return false;
        String uri = request.getRequestURI();
        if (uri == null) return false;
        for (String segment : SKIP_PERSIST_URIS) {
            if (uri.contains(segment)) {
                return true;
            }
        }
        return false;
    }

    private String sanitize(String input) {
        if (input == null) return null;
        Matcher jsonMatcher = SENSITIVE_JSON_PATTERN.matcher(input);
        String sanitized = jsonMatcher.replaceAll("\"$1\":\"***\"");
        Matcher queryMatcher = SENSITIVE_QUERY_PATTERN.matcher(sanitized);
        return queryMatcher.replaceAll("$1=***");
    }

    private String truncate(String input, int maxLength) {
        if (input == null) return null;
        if (input.length() <= maxLength) return input;
        return input.substring(0, maxLength) + "...";
    }
}
