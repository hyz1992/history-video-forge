import type { ArtStylePreset } from "./creative-preset.schema.js";

/**
 * S2-2B 画风 preset 注册表 v1（详细设计 §4.2）。
 *
 * 边界：
 * - 配置只引用 `preset_id`（稳定）；解析时冻结 `preset_version + resolved_params`。
 * - 所有文本为中文输入数据；**不含任何正式 prompt 指令文本**。
 * - 注册表是共享静态数据（与 voice-presets.ts 同模式）；后续若需管理员可维护，
 *   再按 ProviderModelCatalog 模式演进（不在 B 范围）。
 */
export const ART_STYLE_PRESET_REGISTRY_V1: ArtStylePreset[] = [
  {
    preset_id: "art_style_classical_ink",
    preset_version: "v1",
    display_name: "古典水墨",
    description:
      "水墨工笔、淡彩晕染与留白构图的历史画风，适合春秋战国至唐宋题材，强调线条与意境而非写实。",
    resolved_params: {
      visual_tone_hint: "水墨工笔，淡彩晕染，留白构图，线条疏朗，意境含蓄",
      global_prompt_prefix: "水墨风格，工笔勾线，淡彩晕染，留白构图",
      global_negative_prompts: ["油画质感", "3D渲染", "高饱和", "写实照片", "卡通"],
      style_keywords: ["ink wash painting", "traditional chinese painting"],
      era_style_hint: null,
    },
  },
  {
    preset_id: "art_style_historical_documentary",
    preset_version: "v1",
    display_name: "历史纪实",
    description:
      "偏真实史料质感的纪录片画风，强调服装、器物、建筑形制与自然光影的真实性，克制不夸张。",
    resolved_params: {
      visual_tone_hint: "纪实沉稳，史料质感，服饰器物细节准确，光线自然克制",
      global_prompt_prefix: "历史纪实质感，服饰器物细节准确，光线自然",
      global_negative_prompts: ["卡通", "动漫风", "现代元素", "夸张变形", "高饱和"],
      style_keywords: [],
      era_style_hint: "严格符合对应朝代服饰与建筑形制",
    },
  },
  {
    preset_id: "art_style_cinematic",
    preset_version: "v1",
    display_name: "电影质感",
    description:
      "电影级光影、低饱和与厚重氛围，适合冲突激烈、局势压迫的高风险叙事镜头。",
    resolved_params: {
      visual_tone_hint: "电影级光影，低饱和，氛围厚重，戏剧性强烈",
      global_prompt_prefix: "电影质感，戏剧性光影，浅景深，厚重氛围",
      global_negative_prompts: ["平面插画", "高饱和", "塑料感", "卡通"],
      style_keywords: ["cinematic lighting", "film still"],
      era_style_hint: null,
    },
  },
];
