/**
 * 浏览器验收环境前置声明。必须是主脚本的第一条 import：
 * backend 的 env.ts 在模块求值时加载项目根 .env（除非 VITEST=1），
 * 主脚本原本在运行时才设置 VITEST，导致 .env 的真实 LLM/媒体凭据
 * 泄漏进验收进程（topic 推荐曾因此走真实供应商调用）。
 * 这里在所有 backend 模块求值前显式声明 stub/隔离环境。
 */
process.env.VITEST = "1";
process.env.LLM_PROVIDER = "stub";
// fake 媒体凭据：让 generation-cost bootstrap 把媒体目录种为 active（run 解析要求
// image.generate 等槽位可报价）。验收主链不派发媒体任务，不会发生真实供应商调用。
process.env.ALIYUN_DASHSCOPE_API_KEY = "n11-acceptance-fake-key";
delete process.env.LLM_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.LLM_SMART_MODEL;
delete process.env.LLM_FLASH_MODEL;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("LLM_PROVIDER_") && key.endsWith("_API_KEY")) {
    delete process.env[key];
  }
}
