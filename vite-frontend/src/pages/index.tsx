import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from 'react-hot-toast';
import { title } from "@/components/primitives";
import DefaultLayout from "@/layouts/default";
import { login, LoginData } from "@/api";


interface LoginForm {
  username: string;
  password: string;
}

export default function IndexPage() {
  const [form, setForm] = useState<LoginForm>({
    username: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<LoginForm>>({});
  const navigate = useNavigate();

  // 验证表单
  const validateForm = (): boolean => {
    const newErrors: Partial<LoginForm> = {};

    if (!form.username.trim()) {
      newErrors.username = '请输入用户名';
    }

    if (!form.password.trim()) {
      newErrors.password = '请输入密码';
    } else if (form.password.length < 6) {
      newErrors.password = '密码长度至少6位';
    }


    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 处理输入变化
  const handleInputChange = (field: keyof LoginForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    // 清除该字段的错误
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // 执行登录请求
  const performLogin = async () => {


    try {
      const loginData: LoginData = {
        username: form.username.trim(),
        password: form.password,
      };

      const response = await login(loginData);
      
      if (response.code !== 0) {
        toast.error(response.msg || "登录失败");
        return;
      }

      // 检查是否需要强制修改密码
      if (response.data.requirePasswordChange) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem("role_id", response.data.role_id.toString());
        localStorage.setItem("name", response.data.name);
        localStorage.setItem("admin", (response.data.role_id === 0).toString());
        if (response.data.userId !== undefined && response.data.userId !== null) {
          localStorage.setItem("user_id", response.data.userId.toString());
        }
        const allowNodeCreate = response.data.allowNodeCreate ?? 0;
        localStorage.setItem("allow_node_create", allowNodeCreate.toString());
        toast.success('检测到默认密码，即将跳转到修改密码页面');
        navigate("/change-password");
        return;
      }

      // 保存登录信息
      localStorage.setItem('token', response.data.token);
      localStorage.setItem("role_id", response.data.role_id.toString());
      localStorage.setItem("name", response.data.name);
      localStorage.setItem("admin", (response.data.role_id === 0).toString());
      if (response.data.userId !== undefined && response.data.userId !== null) {
        localStorage.setItem("user_id", response.data.userId.toString());
      }
      const allowNodeCreate = response.data.allowNodeCreate ?? 0;
      localStorage.setItem("allow_node_create", allowNodeCreate.toString());

      // 登录成功
      toast.success('登录成功');
      navigate("/dashboard");

    } catch (error) {
      console.error('登录错误:', error);
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!validateForm()) return;

    setLoading(true);

    await performLogin();
  };


  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleLogin();
    }
  };

  const inputClassNames = {
    inputWrapper: "shadow-none",
  };

  return (
    <DefaultLayout>
      <section className="flex flex-col items-center justify-center gap-4 py-4 md:py-10 min-h-[100dvh] md-enter">
        <div className="w-full max-w-md px-4 sm:px-0">
          <div className="w-full md-card md-card-elevated relative overflow-hidden">
            <div className="px-6 py-6">
              <div className="flex flex-col gap-4">
                <div>
                  <h1 className={title({ size: "sm", color: "primary" })}>登录</h1>
                  <p className="text-small md-muted mt-2">请输入您的账号信息</p>
                </div>
                <Input
                  label="用户名"
                  placeholder="请输入用户名"
                  value={form.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  onKeyDown={handleKeyPress}
                  variant="bordered"
                  classNames={inputClassNames}
                  isDisabled={loading}
                  isInvalid={!!errors.username}
                  errorMessage={errors.username}
                />
                
                <Input
                  label="密码"
                  placeholder="请输入密码"
                  type="password"
                  value={form.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  onKeyDown={handleKeyPress}
                  variant="bordered"
                  classNames={inputClassNames}
                  isDisabled={loading}
                  isInvalid={!!errors.password}
                />

                
                <Button
                  color="primary"
                  size="lg"
                  onClick={handleLogin}
                  isLoading={loading}
                  disabled={loading}
                  className="mt-2 shadow-sm"
                >
                  {loading ? "登录中..." : "登录"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </DefaultLayout>
  );
}
